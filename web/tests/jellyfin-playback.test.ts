import { describe, expect, test, vi } from 'vitest';
import type { Server } from '../src/jellyfin/client';
import { applyChoices, jellyfinPlayback } from '../src/jellyfin/playback';
import { trickplay } from '../src/jellyfin/trickplay';
import type { Item } from '../src/media/model';
import { QUALITIES } from '../src/player/quality';

type Params = Record<string, unknown>;

const EPISODES = Array.from({ length: 60 }, (_, i) => `e${i}`);

function fake(answers: Record<string, unknown> = {}) {
  const get = vi.fn(async (path: string, params: Params = {}) => {
    if (path in answers) return answers[path];
    if (path === '/Items/e30') return { Id: 'e30', Type: 'Episode', SeriesId: 's' };
    if (path === '/Shows/s/Episodes') return { Items: EPISODES.map((Id) => ({ Id })) };
    if (path === '/Items' && params.Ids) return { Items: String(params.Ids).split(',').map((Id) => ({ Id, Name: Id, Type: 'Episode' })) };
    throw new Error(`unexpected GET ${path}`);
  });
  const send = vi.fn(async (method: string, path: string, _body?: unknown, _params?: Params) => answers[`${method} ${path}`] as never);
  const server = {
    id: 'srv',
    address: 'https://jf',
    userId: 'u',
    deviceId: 'dev',
    get,
    send,
    url: (path: string, params: Params = {}) => `https://jf${path}?${new URLSearchParams(params as Record<string, string>)}&ApiKey=k`,
  };
  return { get, send, server: server as unknown as Server };
}

const movie: Item = {
  id: 'm',
  kind: 'movie',
  title: 'M',
  duration: 6_000_000,
  art: {},
  versions: [
    {
      id: 'src',
      thumbs: false,
      file: { id: 'src', path: '/Videos/m/stream?static=true&mediaSourceId=src' },
      audio: [
        { id: 1, index: 1, selected: true },
        { id: 2, index: 2, selected: false },
      ],
      subtitles: [{ id: 3, index: 3, selected: false }],
    },
  ],
} as Item;

const want = { item: movie, version: 0, session: 'sess', at: 61_500, quality: QUALITIES[3], decoders: ['hevc', 'h264'], audio: 2, subtitle: 3 };

describe('play queues', () => {
  test('an episode plays on through its show, from its own place', async () => {
    const { server } = fake();
    const { queue, first } = await jellyfinPlayback(server).queue({ item: 'e30', continuous: true });
    expect(queue).toMatchObject({ id: 'show:s', total: 60, shuffled: false, start: 5 });
    expect(first).toMatchObject({ entry: '30', item: { id: 'e30' } });
    expect(queue.entries.map((e) => e.entry)).toEqual(Array.from({ length: 51 }, (_, i) => String(i + 5)));
  });

  test('a reloaded page rebuilds a queue from its id', async () => {
    const { server } = fake();
    const w = await jellyfinPlayback(server).around('show:s', '59');
    expect(w.start).toBe(34);
    expect(w.entries.at(-1)).toMatchObject({ entry: '59', item: { id: 'e59' } });
  });

  test('a shuffled collection keeps every title once', async () => {
    const { server } = fake({ '/Items': { Items: ['a', 'b', 'c'].map((Id) => ({ Id })) } });
    const answers = server.get as ReturnType<typeof vi.fn>;
    answers.mockImplementation(async (_: string, params: Params = {}) =>
      params.Ids ? { Items: String(params.Ids).split(',').map((Id) => ({ Id, Name: Id, Type: 'Movie' })) } : { Items: ['a', 'b', 'c'].map((Id) => ({ Id })) },
    );
    const { queue } = await jellyfinPlayback(server).queue({ collection: 'col', shuffle: true });
    expect(queue.shuffled).toBe(true);
    expect(queue.entries.map((e) => e.item.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('streams', () => {
  test('direct play names the session', async () => {
    const { server } = fake();
    const s = await jellyfinPlayback(server).stream({ ...want, direct: true });
    expect(s).toEqual({ path: '/Videos/m/stream?static=true&mediaSourceId=src&PlaySessionId=sess', burnt: false, note: '' });
  });

  test('a conversion asks for the chosen tracks and starts on a whole second', async () => {
    const url =
      '/videos/m/stream.mkv?DeviceId=dev&MediaSourceId=src&AudioStreamIndex=2&SubtitleStreamIndex=3&StartTimeTicks=615000000&PlaySessionId=theirs&ApiKey=secret&SubtitleMethod=Encode&TranscodeReasons=ContainerBitrateExceedsLimit';
    const { send, server } = fake({ 'POST /Items/m/PlaybackInfo': { MediaSources: [{ Id: 'src', TranscodingUrl: url }] } });
    const s = await jellyfinPlayback(server).stream({ ...want, direct: false });
    const [, , body, params] = send.mock.calls[0];
    expect(params).toMatchObject({ MediaSourceId: 'src', AudioStreamIndex: 2, SubtitleStreamIndex: 3, MaxStreamingBitrate: 8_000_000 });
    // A conversion's URL repeats its codec lists, and Jellyfin refuses ones over 40 characters.
    const convert = (body as { DeviceProfile: { TranscodingProfiles: { VideoCodec: string; AudioCodec: string }[] } }).DeviceProfile.TranscodingProfiles[0];
    expect(convert.VideoCodec).toBe('h264,hevc');
    expect(convert.AudioCodec.length).toBeLessThanOrEqual(40);
    const out = new URL(s.path, 'https://jf');
    expect(out.searchParams.has('ApiKey')).toBe(false);
    expect(out.searchParams.get('PlaySessionId')).toBe('sess');
    expect(out.searchParams.get('StartTimeTicks')).toBe('610000000');
    expect(out.searchParams.get('MaxWidth')).toBe('1920');
    expect(s.burnt).toBe(true);
    expect(s.note).toBe('ContainerBitrateExceedsLimit');
  });

  test('subtitles off ask for none, and nothing is burnt', async () => {
    const { send, server } = fake({ 'POST /Items/m/PlaybackInfo': { MediaSources: [{ Id: 'src', TranscodingUrl: '/videos/m/stream.mkv?SubtitleMethod=Encode' }] } });
    const s = await jellyfinPlayback(server).stream({ ...want, direct: false, subtitle: 0 });
    expect(send.mock.calls[0][3]).toMatchObject({ SubtitleStreamIndex: -1 });
    expect(s.burnt).toBe(false);
  });
});

test('reports start, progress and stop a session, in ticks', async () => {
  const { send, server } = fake();
  const p = jellyfinPlayback(server);
  await p.stream({ ...want, direct: true });
  await p.report({ item: movie, session: 'sess', state: 'playing', time: 1000, duration: 6_000_000 });
  await p.report({ item: movie, session: 'sess', state: 'paused', time: 2000, duration: 6_000_000 });
  await p.report({ item: movie, session: 'sess', state: 'stopped', time: 7_000_000, duration: 6_000_000 });
  expect(send.mock.calls.map((c) => c[1])).toEqual(['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped']);
  expect(send.mock.calls[1][2]).toMatchObject({ ItemId: 'm', MediaSourceId: 'src', PlaySessionId: 'sess', PositionTicks: 20_000_000, IsPaused: true, PlayMethod: 'DirectPlay', AudioStreamIndex: 2 });
  expect(send.mock.calls[2][2]).toMatchObject({ PositionTicks: 60_000_000_000 });
});

test('a track chosen on this box is selected next time', async () => {
  const { server } = fake();
  await jellyfinPlayback(server).saveTrack(movie, 0, 'audio', 2);
  const again = applyChoices(structuredClone(movie));
  expect(again.versions![0].audio!.map((a) => a.selected)).toEqual([false, true]);
  expect(again.versions![0].subtitles![0].selected).toBe(false);
});

test('a play the server missed is marked watched', async () => {
  const { send, server } = fake({ '/Items/m': { Id: 'm', UserData: { Played: false } } });
  expect(await jellyfinPlayback(server).ensureWatched(movie)).toBe(true);
  expect(send).toHaveBeenCalledWith('POST', '/UserPlayedItems/m', undefined, { userId: 'u' });
});

test('a trickplay frame is a tile of its sheet', async () => {
  const info = { Width: 320, Height: 134, TileWidth: 10, TileHeight: 10, ThumbnailCount: 700, Interval: 10_000 };
  const { server } = fake({ '/Items/m': { Id: 'm', Trickplay: { src: { 160: { ...info, Width: 160 }, 320: info } } } });
  const thumbs = await trickplay(server, 'm', 'src');
  // Frame 123 is the 23rd of sheet 1: row 2, column 3.
  expect(thumbs!.frameAt(1234)).toEqual({
    url: 'https://jf/Videos/m/Trickplay/320/1.jpg?MediaSourceId=src&ApiKey=k',
    tile: { column: 3, row: 2, columns: 10, width: 320, height: 134 },
  });
  expect(thumbs!.frameAt(99_999)!.url).toContain('/6.jpg');
});
