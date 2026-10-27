import { beforeEach, expect, test, vi } from 'vitest';
import type { Metadata } from '../src/plex/types';

vi.mock('../src/bridge', async () => {
  const { createMutable } = await import('solid-js/store');
  return {
    state: createMutable({
      mode: 'video',
      player: { session: null as string | null, state: 'idle', ended: undefined as string | undefined, time: 0, duration: null as number | null, subtitles: null },
      decoders: null,
    }),
    call: vi.fn(async () => null),
    send: vi.fn(),
  };
});
const server = { id: 'server', local: true, call: vi.fn(async () => undefined), get: vi.fn() };
const prefs = vi.hoisted(() => ({ qualityLocal: 4000, qualityRemote: 4000, autoSkipIntro: false, autoSkipCredits: false }));
vi.mock('../src/plex/api', () => ({ metadata: vi.fn(async (_s, key: string) => item(key)), setWatched: vi.fn() }));
vi.mock('../src/data', () => ({ refresh: vi.fn() }));
vi.mock('../src/session', () => ({ currentServer: () => server }));
vi.mock('../src/prefs', () => ({ prefs }));
vi.mock('../src/notice', () => ({ notice: vi.fn() }));
vi.mock('../src/player/bif', () => ({ Bif: {} }));
// Episodes A, B and C in one queue. Each is above the bitrate limit, so playing
// one starts a transcode, whose cleanup waits 2 s before the next entry starts.
const entries = ['A', 'B', 'C'].map((ratingKey, i) => ({ ...item(ratingKey), type: 'episode', playQueueItemID: i + 1 }) as Metadata);
vi.mock('../src/plex/playqueue', () => ({
  createQueue: vi.fn(async () => ({ queue: { id: 9, total: 3, shuffled: false, start: 0, items: entries }, selected: entries[0] })),
  loadQueue: vi.fn(async () => ({ id: 9, total: 3, shuffled: false, start: 0, items: entries })),
}));

const bridge = await import('../src/bridge');
const { playback, playEntry, startPlayback } = await import('../src/player/playback');

/** Episode file at 20 Mbps, above the 4 Mbps limit. */
function item(ratingKey: string) {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: 'episode',
    title: ratingKey,
    duration: 1_800_000,
    Media: [{ id: 1, bitrate: 20000, Part: [{ id: ratingKey.charCodeAt(0), key: `/${ratingKey}`, Stream: [] }] }],
  } as unknown as Metadata;
}

const player = bridge.state.player as { session: string | null; state: string; ended?: string; time: number; duration: number | null };
const played = () => vi.mocked(bridge.call).mock.calls.map(([c]) => c).filter((c) => c.cmd === 'play');
/** The library item of each transcode decision, in request order. */
const decided = () => server.get.mock.calls.filter(([path]) => path.endsWith('/decision')).map(([, params]) => params.path);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(bridge.call).mockClear();
  server.get.mockReset().mockResolvedValue({ generalDecisionCode: 1000, generalDecisionText: 'Transcode' });
  Object.assign(player, { session: null, state: 'idle', ended: undefined, time: 0 });
});

test('a delayed next entry does not start over an entry selected while cleanup waits', async () => {
  await startPlayback(entries[0]);
  Object.assign(player, { session: playback()!.id, state: 'playing', duration: 1800 });
  // Playback reaches the end: Kodi stops and the next entry, B, is queued behind cleanup.
  // `ended` is set first: the effect runs on the state write.
  Object.assign(player, { ended: 'ended', state: 'idle' });
  // The user picks C before the transcode cleanup has finished.
  playEntry(entries[2]);
  await vi.runAllTimersAsync();
  expect(playback()?.item.ratingKey).toBe('C');
  expect(decided()).toEqual(['/library/metadata/A', '/library/metadata/C']);
  expect(played()).toHaveLength(2);
});

test('with nothing selected meanwhile, the next entry starts once cleanup finishes', async () => {
  await startPlayback(entries[0]);
  Object.assign(player, { session: playback()!.id, state: 'playing', duration: 1800 });
  Object.assign(player, { ended: 'ended', state: 'idle' });
  await vi.runAllTimersAsync();
  expect(playback()?.item.ratingKey).toBe('B');
  expect(decided()).toEqual(['/library/metadata/A', '/library/metadata/B']);
});
