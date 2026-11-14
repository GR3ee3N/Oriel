// The player's requests to a Jellyfin server: play queues, streams, reports
// of how far playback got, track choices and trickplay scrub previews.
//
// Jellyfin keeps no play queue, so the order of what plays lives here: a
// queue's id says what it was built from, so a reloaded page rebuilds it.
// The player's session id doubles as Jellyfin's PlaySessionId, which ties
// reports and conversions to one playback.

import { AUDIO_CODECS, HARDWARE_CODECS, SUBTITLE_CODECS } from '../media/codecs';
import type { Item } from '../media/model';
import type { PlaybackBackend, Queue, QueueSource } from '../media/provider';
import { ORIGINAL } from '../player/quality';
import { uuid } from '../uuid';
import { LIST } from './api';
import type { Server } from './client';
import { item as convert } from './convert';
import { trickplay } from './trickplay';
import type { BaseItem, Items, MediaSource } from './types';

const TICKS = 10_000;
/** Entries each side of the centre in a window. */
const WINDOW = 25;
/** Jellyfin reads no limit as a low one, so Original asks for this much. */
const UNLIMITED = 200_000_000;

/** Jellyfin's names for what the box plays, where they differ from FFmpeg's. */
const AUDIO = AUDIO_CODECS.map((c) => (c === 'dca' ? 'dts' : c === 'pcm' ? 'pcm_s16le,pcm_s24le' : c)).join(',');
const SUBTITLES = [...new Set(SUBTITLE_CODECS.flatMap((c) => ({ srt: ['srt', 'subrip'], pgs: ['pgssub'], vobsub: ['dvdsub'], dvd_subtitle: ['dvdsub'], webvtt: ['vtt'] })[c] ?? [c]))];

/** What a conversion may hold, first choice first: Jellyfin converts to
 * the first codec and keeps tracks in the others. A conversion's URL
 * repeats these lists, and Jellyfin refuses lists over 40 characters. */
const CONVERT_VIDEO = ['h264', 'hevc', 'av1', 'vp9'];
const CONVERT_AUDIO = 'eac3,ac3,aac,dts,truehd,flac,opus,mp3';

/** What the box plays, for conversions into Matroska over HTTP. */
function deviceProfile(video: string[]) {
  return {
    Name: 'Kodi',
    DirectPlayProfiles: [{ Type: 'Video', VideoCodec: video.join(','), AudioCodec: AUDIO }],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Container: 'mkv',
        Protocol: 'http',
        Context: 'Streaming',
        VideoCodec: CONVERT_VIDEO.filter((c) => video.includes(c)).join(','),
        AudioCodec: CONVERT_AUDIO,
      },
    ],
    SubtitleProfiles: SUBTITLES.map((Format) => ({ Format, Method: 'Embed' })),
    CodecProfiles: [],
    ContainerProfiles: [],
  };
}

interface PlaybackInfo {
  MediaSources: MediaSource[];
}

/** Track choices made on this box, by item and version, for the next playback. */
const choices = new Map<string, { audio?: number; subtitle?: number }>();

/** Select the tracks chosen on this box in a freshly converted item. */
export function applyChoices(item: Item): Item {
  for (const v of item.versions ?? []) {
    const chosen = choices.get(`${item.id}/${v.id}`);
    if (chosen?.audio !== undefined) for (const a of v.audio ?? []) a.selected = a.id === chosen.audio;
    if (chosen?.subtitle !== undefined) for (const s of v.subtitles ?? []) s.selected = s.id === chosen.subtitle;
  }
  return item;
}

/** A queue's whole order, as item ids. */
interface Order {
  ids: string[];
  shuffled: boolean;
}

export function jellyfinPlayback(server: Server): PlaybackBackend {
  const user = { userId: server.userId };
  const orders = new Map<string, Order>();
  /** What each session plays, for its reports. */
  const playing = new Map<string, { source: string; method: 'DirectPlay' | 'Transcode'; audio: number; subtitle: number; started: boolean }>();

  const ids = async (path: string, params: Record<string, string | number | boolean | undefined> = {}) =>
    (await server.get<Items>(path, { ...user, ...params, Fields: 'Id', EnableImages: false, EnableUserData: false })).Items.map((i) => i.Id);

  /** The order a queue id names: `item:`, `show:`, `collection:` or `playlist:`. */
  async function order(id: string): Promise<Order> {
    const known = orders.get(id);
    if (known) return known;
    const [kind, ref] = id.split(':');
    let list: string[];
    if (kind === 'item') list = [ref];
    else if (kind === 'show') list = await ids(`/Shows/${ref}/Episodes`);
    else if (kind === 'collection') list = await ids('/Items', { ParentId: ref, SortBy: 'PremiereDate,SortName' });
    else if (kind === 'playlist') list = await ids(`/Playlists/${ref}/Items`);
    else throw new Error(`unknown play queue ${id}`);
    const built = { ids: list, shuffled: false };
    orders.set(id, built);
    return built;
  }

  /** Entries are positions in the order, so a title can appear twice. */
  async function window(id: string, order: Order, at: number): Promise<Queue> {
    const start = Math.max(0, at - WINDOW);
    const slice = order.ids.slice(start, at + WINDOW + 1);
    const r = slice.length ? await server.get<Items>('/Items', { ...user, Ids: [...new Set(slice)].join(','), Fields: LIST }) : { Items: [] };
    const byId = new Map(r.Items.map((i) => [i.Id, i]));
    return {
      id,
      total: order.ids.length,
      shuffled: order.shuffled,
      start,
      entries: slice.flatMap((itemId, i) => {
        const j = byId.get(itemId);
        return j ? [{ entry: String(start + i), item: convert(j) }] : [];
      }),
    };
  }

  async function queue(source: QueueSource) {
    let id: string;
    let first = 0;
    if ('item' in source) {
      const j = await server.get<BaseItem>(`/Items/${source.item}`, { ...user, Fields: 'Id' });
      id = source.continuous && j.Type === 'Episode' && j.SeriesId ? `show:${j.SeriesId}` : `item:${source.item}`;
      first = Math.max(0, (await order(id)).ids.indexOf(source.item));
    } else {
      id = 'collection' in source ? `collection:${source.collection}` : `playlist:${source.playlist}`;
      if (source.shuffle) {
        const ids = [...(await order(id)).ids];
        for (let i = ids.length - 1; i > 0; i--) {
          const k = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[k]] = [ids[k], ids[i]];
        }
        // A shuffled order exists only on this page.
        id = `shuffle:${uuid()}`;
        orders.set(id, { ids, shuffled: true });
      }
    }
    const o = await order(id);
    if (!o.ids.length) throw new Error('the play queue is empty');
    const q = await window(id, o, first);
    const entry = q.entries.find((e) => e.entry === String(first)) ?? q.entries[0];
    if (!entry) throw new Error('the play queue is empty');
    return { queue: q, first: entry };
  }

  const sourceOf = (item: Item, version: number) => {
    const v = item.versions?.[version];
    if (!v?.file) throw new Error(`${item.id} has no version ${version}`);
    return v;
  };

  return {
    queue,
    around: async (id, entry) => window(id, await order(id), entry === undefined ? 0 : Number(entry)),
    stream: async ({ item, version, session, at, direct, quality, decoders, audio, subtitle }) => {
      const v = sourceOf(item, version);
      if (direct) {
        playing.set(session, { source: v.id, method: 'DirectPlay', audio, subtitle, started: false });
        return { path: `${v.file!.path}&PlaySessionId=${session}`, burnt: false, note: '' };
      }
      const video = decoders ? HARDWARE_CODECS.filter((c) => decoders.includes(c)) : HARDWARE_CODECS;
      const bitrate = quality.kbps === ORIGINAL ? UNLIMITED : quality.kbps * 1000;
      const info = await server.send<PlaybackInfo>(
        'POST',
        `/Items/${item.id}/PlaybackInfo`,
        { DeviceProfile: deviceProfile(video), EnableDirectPlay: false, EnableDirectStream: true, EnableTranscoding: true, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true, AutoOpenLiveStream: false },
        { ...user, MediaSourceId: v.id, AudioStreamIndex: audio, SubtitleStreamIndex: subtitle || -1, MaxStreamingBitrate: bitrate, StartTimeTicks: Math.floor(at) * TICKS },
      );
      const s = info.MediaSources.find((m) => m.Id === v.id) ?? info.MediaSources[0];
      if (!s?.TranscodingUrl) throw new Error('Jellyfin can’t convert this item');
      const url = new URL(s.TranscodingUrl, server.address);
      // The proxy authorises Kodi's requests; the start is whole seconds, as
      // the player offsets Kodi's clock by.
      url.searchParams.delete('ApiKey');
      url.searchParams.set('PlaySessionId', session);
      url.searchParams.set('StartTimeTicks', String(Math.floor(at / 1000) * 1000 * TICKS));
      const [w, h] = quality.resolution.split('x');
      if (w && h) {
        url.searchParams.set('MaxWidth', w);
        url.searchParams.set('MaxHeight', h);
      }
      playing.set(session, { source: v.id, method: 'Transcode', audio, subtitle, started: false });
      return {
        path: url.pathname + url.search,
        burnt: !!subtitle && url.searchParams.get('SubtitleMethod') === 'Encode',
        note: url.searchParams.get('TranscodeReasons') ?? '',
      };
    },
    sessionPath: (path) => path,
    stopStream: (session) => server.send('DELETE', '/Videos/ActiveEncodings', undefined, { DeviceId: server.deviceId, PlaySessionId: session }).catch(() => {}),
    report: async ({ item, session, state, time, duration }) => {
      const p = playing.get(session) ?? { source: item.versions?.[0]?.id ?? item.id, method: 'DirectPlay' as const, audio: 0, subtitle: 0, started: false };
      playing.set(session, p);
      const at = duration ? Math.min(time, duration) : time;
      const body = {
        ItemId: item.id,
        MediaSourceId: p.source,
        PlaySessionId: session,
        PositionTicks: Math.round(at) * TICKS,
        IsPaused: state === 'paused',
        PlayMethod: p.method,
        CanSeek: true,
        AudioStreamIndex: p.audio || undefined,
        SubtitleStreamIndex: p.subtitle || -1,
      };
      if (state === 'stopped') {
        playing.delete(session);
        return server.send('POST', '/Sessions/Playing/Stopped', body);
      }
      const path = p.started ? '/Sessions/Playing/Progress' : '/Sessions/Playing';
      p.started = true;
      await server.send('POST', path, body);
    },
    saveTrack: async (item, version, kind, id) => {
      const key = `${item.id}/${sourceOf(item, version).id}`;
      choices.set(key, { ...choices.get(key), [kind]: id });
    },
    thumbs: async (item, version) => trickplay(server, item.id, sourceOf(item, version).id),
    ensureWatched: async (item) => {
      const j = await server.get<BaseItem>(`/Items/${item.id}`, { ...user, Fields: 'Id' });
      if (j.UserData?.Played) return false;
      await server.send('POST', `/UserPlayedItems/${item.id}`, undefined, user);
      return true;
    },
  };
}
