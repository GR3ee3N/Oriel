import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Metadata } from '../src/plex/types';

// Use a reactive player store so state changes trigger playback effects.
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
vi.mock('../src/plex/api', () => ({ metadata: vi.fn(async (_s, key) => episode(key)), children: vi.fn(async () => []), setWatched: vi.fn() }));
vi.mock('../src/data', () => ({ refresh: vi.fn() }));
vi.mock('../src/session', () => ({ currentServer: () => server }));
vi.mock('../src/prefs', () => ({ prefs }));
vi.mock('../src/notice', () => ({ notice: vi.fn() }));
vi.mock('../src/player/bif', () => ({ Bif: {} }));

const bridge = await import('../src/bridge');
const { dismiss, introIn, playback, prompt, startPlayback } = await import('../src/player/playback');
const send = vi.mocked(bridge.send);

/** Episode fixture with an intro marker from 10 s to 70 s. */
const episode = (ratingKey: string) =>
  ({
    ratingKey,
    type: 'episode',
    title: ratingKey,
    duration: 1_800_000,
    Marker: [{ type: 'intro', startTimeOffset: 10_000, endTimeOffset: 70_000 }],
    Media: [{ bitrate: 1000, Part: [{ id: 1, key: `/${ratingKey}`, Stream: [] }] }],
  }) as unknown as Metadata;

const player = bridge.state.player as { session: string | null; state: string; time: number; duration: number | null };
const seeks = () => send.mock.calls.map(([c]) => c).filter((c) => c.cmd === 'seek-to');

/** Fractional playback position; Kodi reports its whole-second value. */
let position = 0;
function seek(to: number): void {
  position = to;
  player.time = to;
}
/** Advance the clock by `seconds`; advance playback only while playing. */
function playFor(seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    vi.advanceTimersByTime(100);
    if (player.state === 'playing') {
      position += 0.1;
      player.time = Math.floor(position + 1e-6);
    }
  }
}

async function play(autoSkip: boolean): Promise<void> {
  prefs.autoSkipIntro = autoSkip;
  await startPlayback(episode('A'));
  vi.useFakeTimers();
  Object.assign(player, { session: playback()!.id, state: 'playing', time: 0, duration: 1800 });
  position = 0;
  send.mockClear();
}

beforeEach(() => Object.assign(player, { session: null, state: 'idle', time: 0 }));
afterEach(() => vi.useRealTimers());

test('manually, Skip intro shows in the intro and waits for the button', async () => {
  await play(false);
  seek(12);
  expect(prompt()).toBe('intro');
  expect(introIn()).toBeUndefined();
  playFor(20);
  expect(seeks()).toEqual([]);
  seek(68);
  expect(prompt()).toBe(null);
});

test('automatically, Skip intro skips after 5 s of playback, standing still while paused', async () => {
  await play(true);
  seek(12.6);
  expect(prompt()).toBe('intro');
  expect(introIn()).toBe(5);
  playFor(2);
  expect(introIn()).toBe(3);
  player.state = 'paused';
  playFor(4);
  expect(introIn()).toBe(3);
  player.state = 'playing';
  playFor(2.8);
  expect(seeks()).toEqual([]);
  expect(introIn()).toBe(1);
  playFor(0.2);
  expect(seeks()).toEqual([{ cmd: 'seek-to', seconds: 70 }]);
  expect(prompt()).toBe(null);
  seek(70);
  expect(prompt()).toBe(null);
  // Seeking back into the intro starts a new Skip intro countdown.
  seek(20);
  expect(prompt()).toBe('intro');
  expect(introIn()).toBe(5);
});

test('automatically, seeking in the intro neither runs the countdown down nor winds it back', async () => {
  await play(true);
  seek(30);
  playFor(2);
  seek(50);
  expect(introIn()).toBe(3);
  seek(20);
  expect(introIn()).toBe(3);
  playFor(2.9);
  expect(seeks()).toEqual([]);
  playFor(0.1);
  expect(seeks()).toEqual([{ cmd: 'seek-to', seconds: 70 }]);
});

test.each([120, 68, 5])('automatically, seeking out of the intro mid-countdown (to %i s) never skips', async (to) => {
  await play(true);
  seek(12);
  playFor(4.5);
  expect(introIn()).toBe(1);
  seek(to);
  playFor(3);
  expect(prompt()).toBe(null);
  expect(seeks()).toEqual([]);
});

test('automatically, the countdown running out just as the intro ends does not skip', async () => {
  await play(true);
  seek(62.5);
  expect(introIn()).toBe(5);
  // At 67 s, the final 3 s exclusion begins before the 5 s countdown expires.
  playFor(10);
  expect(seeks()).toEqual([]);
  expect(prompt()).toBe(null);
});

test('automatically, seeking into the last 3 s of the intro shows nothing and skips nothing', async () => {
  await play(true);
  seek(68);
  expect(prompt()).toBe(null);
  playFor(5);
  expect(seeks()).toEqual([]);
});

test.each([false, true])('Back hides Skip intro until playback is back in the intro (automatically: %s)', async (auto) => {
  await play(auto);
  seek(12);
  dismiss();
  playFor(8);
  expect(seeks()).toEqual([]);
  expect(prompt()).toBe(null);
  seek(90);
  seek(30);
  expect(prompt()).toBe('intro');
  expect(introIn()).toBe(auto ? 5 : undefined);
});
