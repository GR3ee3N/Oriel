import { beforeEach, expect, test, vi } from 'vitest';
import type { Command } from '../src/bridge';
import type { Metadata } from '../src/plex/types';

const server = { id: 'server', local: true, call: vi.fn(), get: vi.fn() };
const bridge = vi.hoisted(() => ({
  state: { player: { session: null, state: 'idle', time: 0, duration: null, subtitles: null }, decoders: null as string[] | null },
  call: vi.fn(async (_command: Command) => null),
  send: vi.fn(),
}));
const api = vi.hoisted(() => ({ metadata: vi.fn(), children: vi.fn(async () => []), setWatched: vi.fn() }));
const prefs = vi.hoisted(() => ({ qualityLocal: 4000, qualityRemote: 4000 }));
const notice = vi.hoisted(() => vi.fn());

vi.mock('../src/bridge', () => bridge);
vi.mock('../src/plex/api', () => api);
vi.mock('../src/data', () => ({ refresh: vi.fn() }));
vi.mock('../src/media/servers', async () => {
  const { plexProvider } = await import('../src/plex/provider');
  const p = plexProvider(server as never);
  return { provider: () => p, invalidate: vi.fn() };
});
vi.mock('../src/prefs', () => ({ prefs }));
vi.mock('../src/notice', () => ({ notice }));
vi.mock('../src/plex/bif', () => ({ Bif: {} }));
// Without a play queue each item plays on its own.
vi.mock('../src/plex/playqueue', () => ({ createQueue: vi.fn(async () => Promise.reject(new Error('no queue'))), loadQueue: vi.fn() }));

const { adoptPlayback, chooseAudio, playback, startPlayback } = await import('../src/player/playback');
/** What Play hands the player. */
const ref = (id: string) => ({ id, kind: 'movie' as const });
const { createQueue } = await import('../src/plex/playqueue');

/** Movie fixture with bitrate `kbps`; values above the 4000 kbps limit require transcoding. */
const movie = (ratingKey: string, kbps: number) =>
  ({
    ratingKey,
    type: 'movie',
    title: ratingKey,
    Media: [
      {
        bitrate: kbps,
        Part: [
          {
            id: Number(ratingKey.charCodeAt(0)),
            key: `/${ratingKey}`,
            Stream: [
              { id: 1, streamType: 2, index: 1, languageCode: 'eng', codec: 'aac', channels: 2, selected: true },
              { id: 2, streamType: 2, index: 2, languageCode: 'ger', codec: 'aac', channels: 2 },
            ],
          },
        ],
      },
    ],
  }) as unknown as Metadata;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const played = () => bridge.call.mock.calls.map(([c]) => c).filter((c) => c.cmd === 'play');
/** Played paths with session query parameters removed. */
const paths = () => played().map((c) => c.path.split('?')[0]);

beforeEach(() => {
  bridge.call.mockClear();
  api.metadata.mockReset();
  server.get.mockReset().mockResolvedValue({ generalDecisionCode: 1000, generalDecisionText: 'Transcode' });
  server.call.mockReset().mockResolvedValue(undefined);
  bridge.state.decoders = null;
  prefs.qualityLocal = prefs.qualityRemote = 4000;
  notice.mockClear();
});

test('an older choice whose metadata comes late does not replace the newer playback', async () => {
  const slow = deferred<Metadata>();
  api.metadata.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(movie('B', 1000));
  const first = startPlayback(ref('A'));
  await vi.waitFor(() => expect(api.metadata).toHaveBeenCalledTimes(1));
  await startPlayback(ref('B'));
  slow.resolve(movie('A', 1000));
  await first;
  expect(playback()?.item.id).toBe('B');
  expect(paths()).toEqual(['/B']);
});

test('an older choice whose play queue comes late does not replace the newer playback', async () => {
  const queue = deferred<Awaited<ReturnType<typeof createQueue>>>();
  vi.mocked(createQueue).mockReturnValueOnce(queue.promise);
  api.metadata.mockResolvedValue(movie('B', 1000));
  const first = startPlayback(ref('A'));
  await startPlayback(ref('B'));
  queue.resolve({ queue: {} as never, first: { entry: '1', item: { id: 'A', kind: 'movie', title: 'A', art: {} } } });
  await first;
  expect(playback()?.item.id).toBe('B');
  expect(paths()).toEqual(['/B']);
});

test('an older choice whose transcode decision returns while a newer one loads does not start', async () => {
  const decision = deferred<{ generalDecisionCode: number }>();
  const later = deferred<Metadata>();
  api.metadata.mockResolvedValueOnce(movie('A', 20000)).mockReturnValueOnce(later.promise);
  server.get.mockReturnValueOnce(decision.promise);
  const first = startPlayback(ref('A'));
  await vi.waitFor(() => expect(server.get).toHaveBeenCalled());
  const second = startPlayback(ref('B'));
  await vi.waitFor(() => expect(api.metadata).toHaveBeenCalledTimes(2));
  decision.resolve({ generalDecisionCode: 1000 });
  await first;
  expect(played()).toEqual([]);
  later.resolve(movie('B', 1000));
  await second;
  expect(paths()).toEqual(['/B']);
});

test("a track saved after another item started doesn't restart that item", async () => {
  api.metadata.mockResolvedValueOnce(movie('A', 20000));
  await startPlayback(ref('A'));
  expect(playback()?.transcoded).toBe(true);
  const saved = deferred<void>();
  server.call.mockReturnValueOnce(saved.promise);
  chooseAudio(playback()!.audio[1]);

  api.metadata.mockResolvedValueOnce(movie('B', 1000));
  await startPlayback(ref('B'));
  bridge.call.mockClear();
  saved.resolve();
  await settle();
  expect(played()).toEqual([]);
});

test.each([1000, 20000])('resuming a %i kbps item starts at the saved movie position', async (kbps) => {
  const item = { ...movie('A', kbps), viewOffset: 600_000, duration: 5_400_000 };
  api.metadata.mockResolvedValue(item);
  await startPlayback(ref('A'));
  const command = played()[0];
  expect(command).toMatchObject({ position: 600, subtitle: -1 });
  if (kbps === 1000) {
    expect(paths()).toEqual(['/A']);
    expect(command).not.toHaveProperty('streamOffset');
  } else {
    const stream = new URL(command.path, 'http://plex.example');
    expect(stream.pathname).toBe('/video/:/transcode/universal/start.mkv');
    expect(stream.searchParams.get('offset')).toBe('600');
    expect(stream.searchParams.get('maxVideoBitrate')).toBe('4000');
    expect(stream.searchParams.get('session')).toBe(command.session);
    expect(stream.searchParams.has('X-Plex-Token')).toBe(false);
    expect(command).toMatchObject({ streamOffset: 600, duration: 5400 });
  }
});

test('a direct play is declared to Plex, and Kodi plays the file in its session', async () => {
  const item = movie('A', 1000);
  Object.assign(item.Media![0], { container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' });
  api.metadata.mockResolvedValue(item);
  await startPlayback(ref('A'));
  const [path, params] = server.get.mock.calls[0];
  expect(path).toBe('/video/:/transcode/universal/decision');
  expect(params).toMatchObject({ path: '/library/metadata/A', directPlay: '1', 'X-Plex-Session-Identifier': playback()!.id });
  expect(params['X-Plex-Client-Profile-Extra']).toMatch(/^add-settings\(DirectPlayStreamSelection=true\)\+add-direct-play-profile\(type=videoProfile&container=mkv&videoCodec=hevc&audioCodec=[^&]*eac3/);
  const command = played()[0];
  const stream = new URL(command.path, 'http://plex.example');
  expect(stream.pathname).toBe('/A');
  expect(stream.searchParams.get('X-Plex-Session-Identifier')).toBe(command.session);
  expect(stream.searchParams.has('X-Plex-Client-Identifier')).toBe(true);
  expect(stream.searchParams.has('X-Plex-Token')).toBe(false);
});

test.each([
  ['declined', () => server.get.mockResolvedValueOnce({ generalDecisionCode: 2000, generalDecisionText: 'No' })],
  ['failed', () => server.get.mockRejectedValueOnce(new Error('HTTP 400'))],
])('a direct play Plex %s still plays the file', async (_, decide) => {
  const item = movie('A', 1000);
  api.metadata.mockResolvedValue(item);
  decide();
  await startPlayback(ref('A'));
  expect(paths()).toEqual(['/A']);
  expect(playback()?.transcoded).toBe(false);
});

test('a Plex transcode refusal leaves nothing playing and the user can retry', async () => {
  const item = movie('A', 20000);
  api.metadata.mockResolvedValue(item);
  server.get.mockResolvedValueOnce({ generalDecisionCode: 2000, generalDecisionText: 'Transcoder unavailable' });
  await expect(startPlayback(ref('A'))).rejects.toThrow('Transcoder unavailable');
  expect(notice).toHaveBeenCalledWith('Plex can’t convert this item: Transcoder unavailable');
  expect(played()).toEqual([]);
  expect(playback()).toBeUndefined();
  await startPlayback(ref('A'));
  expect(played()).toHaveLength(1);
  expect(playback()?.transcoded).toBe(true);
});

test('a codec the box cannot decode is transcoded even at Original quality', async () => {
  const item = movie('A', 1000);
  item.Media![0].videoCodec = 'av1';
  prefs.qualityLocal = 0;
  bridge.state.decoders = ['h264', 'hevc'];
  api.metadata.mockResolvedValue(item);
  await startPlayback(ref('A'));
  const stream = new URL(played()[0].path, 'http://plex.example');
  expect(stream.searchParams.get('maxVideoBitrate')).toBe('20000');
  expect(stream.searchParams.get('X-Plex-Client-Profile-Extra')).toContain('videoCodec=h264,hevc&');
  expect(playback()?.transcoded).toBe(true);
});

test('a late transcode decision cannot replace a newer item', async () => {
  const decision = deferred<{ generalDecisionCode: number }>();
  api.metadata.mockResolvedValueOnce(movie('A', 20000)).mockResolvedValueOnce(movie('B', 1000));
  server.get.mockReturnValueOnce(decision.promise);
  const first = startPlayback(ref('A'));
  await vi.waitFor(() => expect(server.get).toHaveBeenCalled());
  await startPlayback(ref('B'));
  decision.resolve({ generalDecisionCode: 1000 });
  await first;
  expect(playback()?.item.id).toBe('B');
  expect(paths()).toEqual(['/B']);
});

test('after a page reload, playback is picked up from its note, and a note from an older Oriel is dropped', async () => {
  api.metadata.mockResolvedValue(movie('A', 1000));
  await adoptPlayback({ id: 'A', quality: 4000, transcoded: false }, 'session-1');
  expect(playback()).toMatchObject({ id: 'session-1', item: { id: 'A' } });
  api.metadata.mockClear();
  await adoptPlayback({ ratingKey: 'B', quality: 4000, transcoded: false } as never, 'session-2');
  expect(api.metadata).not.toHaveBeenCalled();
  expect(playback()?.id).toBe('session-1');
});
