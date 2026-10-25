import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Metadata } from '../src/plex/types';

vi.mock('../src/bridge', async () => {
  const { createMutable } = await import('solid-js/store');
  return {
    state: createMutable({
      mode: 'video',
      player: { session: null as string | null, state: 'idle', time: 0, duration: null as number | null, subtitles: null },
      decoders: null,
    }),
    call: vi.fn(async () => null),
    send: vi.fn(),
  };
});
const server = { id: 'server', local: true, call: vi.fn(async () => undefined), get: vi.fn() };
const prefs = vi.hoisted(() => ({ qualityLocal: 4000, qualityRemote: 4000, autoSkipIntro: false, autoSkipCredits: false }));
vi.mock('../src/plex/api', () => ({ metadata: vi.fn(async (_s, key) => episode(key)), setWatched: vi.fn() }));
vi.mock('../src/data', () => ({ refresh: vi.fn() }));
vi.mock('../src/session', () => ({ currentServer: () => server }));
vi.mock('../src/prefs', () => ({ prefs }));
vi.mock('../src/notice', () => ({ notice: vi.fn() }));
vi.mock('../src/player/bif', () => ({ Bif: {} }));
// A queue of A, B and A again, each entry with its own ID.
const entries = [1, 2, 3].map((id, i) => ({ ratingKey: 'ABA'[i], key: '', type: 'episode', title: 'ABA'[i], playQueueItemID: id }) as Metadata);
vi.mock('../src/plex/playqueue', () => ({
  createQueue: vi.fn(async () => ({ queue: { id: 9, total: 3, shuffled: false, start: 0, items: entries }, selected: entries[0] })),
  loadQueue: vi.fn(),
}));

const bridge = await import('../src/bridge');
const { dismiss, nextEntry, nextIn, playback, prompt, startPlayback } = await import('../src/player/playback');
const send = vi.mocked(bridge.send);

/** Episode with final credits from 1700 s to the end at 1800 s. */
const episode = (ratingKey: string) =>
  ({
    ratingKey,
    type: 'episode',
    title: ratingKey,
    duration: 1_800_000,
    Marker: [{ type: 'credits', final: true, startTimeOffset: 1_700_000, endTimeOffset: 1_800_000 }],
    Media: [{ id: 1, bitrate: 1000, Part: [{ id: 1, key: `/${ratingKey}`, Stream: [] }] }],
  }) as unknown as Metadata;

const player = bridge.state.player as { session: string | null; state: string; time: number; duration: number | null };
const stops = () => send.mock.calls.filter(([c]) => c.cmd === 'stop').length;
let position = 0;
function seek(to: number): void {
  position = to;
  player.time = to;
}
function playFor(seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    vi.advanceTimersByTime(100);
    if (player.state === 'playing') {
      position += 0.1;
      player.time = Math.floor(position + 1e-6);
    }
  }
}

beforeEach(async () => {
  Object.assign(player, { session: null, state: 'idle', time: 0 });
  await startPlayback(entries[0]);
  vi.useFakeTimers();
  Object.assign(player, { session: playback()!.id, state: 'playing', time: 0, duration: 1800 });
  position = 0;
  send.mockClear();
});
afterEach(() => vi.useRealTimers());

test('Up next names the entry after the playing one in the queue', () => {
  expect(playback()?.entry).toBe(1);
  expect(nextEntry()?.playQueueItemID).toBe(2);
});

test('the countdown counts playback, not the position, so a seek back in the credits keeps it', () => {
  seek(1702);
  expect(prompt()).toBe('next');
  playFor(4);
  expect(nextIn()).toBe(6);
  seek(1701);
  playFor(5.9);
  expect(stops()).toBe(0);
  playFor(0.2);
  expect(stops()).toBe(1);
});

test('a seek forward in the credits does not start the next entry at once', () => {
  seek(1702);
  playFor(2);
  seek(1790);
  playFor(1);
  expect(stops()).toBe(0);
  expect(nextIn()).toBe(7);
});

test('paused, the countdown stands still', () => {
  seek(1702);
  playFor(3);
  player.state = 'paused';
  playFor(20);
  expect(nextIn()).toBe(7);
  expect(stops()).toBe(0);
  player.state = 'playing';
  playFor(7.1);
  expect(stops()).toBe(1);
});

test('Back holds only until playback leaves the credits', () => {
  seek(1702);
  dismiss();
  expect(prompt()).toBeNull();
  playFor(15);
  expect(stops()).toBe(0);
  seek(1600);
  playFor(1);
  seek(1705);
  playFor(0.1);
  expect(prompt()).toBe('next');
  expect(nextIn()).toBe(10);
});
