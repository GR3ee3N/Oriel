// Convert Jellyfin replies into the server-neutral model in media/model.ts.
// Times arrive in ticks, 10,000 per millisecond. Images are referred to as
// "itemId/Type/tag", or "itemId/Chapter/index/tag" for chapter images.

import type {
  AudioStream,
  Chapter as MediaChapter,
  Item,
  Kind,
  Person as MediaPerson,
  Range,
  SubtitleStream,
  Version,
  VideoStream,
} from '../media/model';
import { channelLayout, compact } from '../media/convert';
import { corners } from './blurhash';
import type { BaseItem, MediaSource, MediaStream } from './types';

const KINDS: Record<string, Kind> = {
  Movie: 'movie',
  Series: 'show',
  Season: 'season',
  Episode: 'episode',
  BoxSet: 'collection',
  Playlist: 'playlist',
  Trailer: 'clip',
  Video: 'clip',
};

const ms = (ticks: number | undefined) => (ticks ? Math.round(ticks / 10_000) : undefined);
const ref = (id: string | undefined, type: string, tag: string | undefined) => (id && tag ? `${id}/${type}/${tag}` : undefined);

/** A release date in the box's own time zone: Jellyfin sends midnight local
 * time of the server as UTC, e.g. "2003-06-04T22:00:00Z" for 5 June. */
function date(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** "FSK-16" and "DE-16" are German ratings; others, such as "PG-13" or
 * "TV-14", stay as they are. */
export function ageRating(rating: string | undefined): Item['ageRating'] {
  if (!rating) return undefined;
  const de = rating.match(/^(?:FSK|DE)-?(\d+)$/i);
  return de ? { country: 'de', value: de[1] } : { value: rating };
}

export function item(j: BaseItem, library?: string): Item {
  const kind = KINDS[j.Type] ?? 'other';
  const out: Item = { id: j.Id, kind, title: j.Name, art: artwork(j) };
  if (kind === 'episode') {
    if (j.SeriesId) out.show = { id: j.SeriesId, title: j.SeriesName ?? '' };
    if (j.SeasonId) out.season = { id: j.SeasonId, title: j.SeasonName, number: j.ParentIndexNumber };
  } else if (kind === 'season' && j.SeriesId) {
    out.show = { id: j.SeriesId, title: j.SeriesName ?? '' };
  }
  out.number = j.IndexNumber;
  out.year = j.ProductionYear;
  out.released = date(j.PremiereDate);
  out.summary = j.Overview;
  out.tagline = j.Taglines?.[0];
  out.studio = j.Studios?.[0]?.Name;
  out.ageRating = ageRating(j.OfficialRating);
  if (j.CommunityRating) out.audienceRating = Math.round(j.CommunityRating * 10) / 10;
  out.duration = ms(j.RunTimeTicks);
  const user = j.UserData;
  out.position = ms(user?.PlaybackPositionTicks);
  if (user) out.plays = user.Played ? Math.max(1, user.PlayCount ?? 0) : 0;
  if (kind === 'show' || kind === 'season') {
    const total = j.RecursiveItemCount ?? (kind === 'season' ? j.ChildCount : undefined);
    if (total !== undefined) out.episodes = { total, watched: Math.max(0, total - (user?.UnplayedItemCount ?? total)) };
  }
  if (kind === 'show' || kind === 'collection' || kind === 'playlist') out.count = j.ChildCount;
  out.library = library;
  out.genres = j.Genres;
  if (j.People) {
    out.directors = j.People.filter((p) => p.Type === 'Director').map((p) => p.Name);
    out.cast = j.People.filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar').map(
      (p): MediaPerson => ({ id: p.Id, name: p.Name, role: p.Role || undefined, photo: ref(p.Id, 'Primary', p.PrimaryImageTag) }),
    );
  }
  out.versions = j.MediaSources?.map((s) => version(j, s));
  out.chapters = j.Chapters?.map(
    (c, i): MediaChapter => ({ title: c.Name, start: ms(c.StartPositionTicks) ?? 0, image: c.ImageTag ? `${j.Id}/Chapter/${i}/${c.ImageTag}` : undefined }),
  );
  return compact(out);
}

function artwork(j: BaseItem): Item['art'] {
  const tags = j.ImageTags ?? {};
  const backdropTag = j.BackdropImageTags?.[0];
  const parentBackdrop = j.ParentBackdropImageTags?.[0];
  const art: Item['art'] = {
    image: ref(j.Id, 'Primary', tags.Primary),
    backdrop: ref(j.Id, 'Backdrop', backdropTag) ?? ref(j.ParentBackdropItemId, 'Backdrop', parentBackdrop),
    logo: ref(j.Id, 'Logo', tags.Logo) ?? ref(j.ParentLogoItemId, 'Logo', j.ParentLogoImageTag),
  };
  if (j.Type === 'Episode' || j.Type === 'Season') {
    art.showImage = ref(j.SeriesId, 'Primary', j.SeriesPrimaryImageTag);
    art.showBackdrop = ref(j.ParentBackdropItemId, 'Backdrop', parentBackdrop);
  }
  if (j.Type === 'Episode') art.seasonImage = ref(j.ParentPrimaryImageItemId, 'Primary', j.ParentPrimaryImageTag);
  const hash = j.ImageBlurHashes?.Backdrop?.[backdropTag ?? parentBackdrop ?? ''];
  art.colors = corners(hash);
  return compact(art);
}

/** Jellyfin's codec names where they differ from FFmpeg's, as the rest of
 * the interface uses them. */
const CODECS: Record<string, string> = { subrip: 'srt', pgssub: 'pgs', dvdsub: 'vobsub', dvbsub: 'dvb' };
const codec = (c: string | undefined) => (c ? (CODECS[c.toLowerCase()] ?? c.toLowerCase()) : undefined);

/** ISO 639-2 codes, both forms, as the two-letter tags Kodi and the
 * interface use; other codes stay as they are. */
const LANGUAGES: Record<string, string> = Object.fromEntries(
  (
    'ara ar,bul bg,cat ca,ces cs,cze cs,chi zh,zho zh,dan da,deu de,ger de,ell el,gre el,eng en,est et,eus eu,baq eu,fas fa,per fa,' +
    'fin fi,fra fr,fre fr,glg gl,heb he,hin hi,hrv hr,hun hu,ind id,isl is,ice is,ita it,jpn ja,kor ko,lav lv,lit lt,msa ms,may ms,' +
    'nld nl,dut nl,nob nb,nno nn,nor no,pol pl,por pt,ron ro,rum ro,rus ru,slk sk,slo sk,slv sl,spa es,srp sr,swe sv,tam ta,tel te,' +
    'tha th,tur tr,ukr uk,vie vi,ben bn'
  )
    .split(',')
    .map((pair) => pair.split(' ')),
);
/** No language: Jellyfin's "und" means undetermined. */
const language = (code: string | undefined) => (!code || code === 'und' ? undefined : (LANGUAGES[code.toLowerCase()] ?? code));

function version(j: BaseItem, s: MediaSource): Version {
  const streams = s.MediaStreams ?? [];
  const v: Version = {
    id: s.Id,
    thumbs: Object.keys(j.Trickplay?.[s.Id] ?? {}).length > 0,
    file: { id: s.Id, path: `/Videos/${j.Id}/stream?static=true&mediaSourceId=${s.Id}` },
  };
  if (s.Container) v.container = s.Container.split(',')[0];
  if (s.Bitrate) v.bitrate = Math.round(s.Bitrate / 1000);
  if (s.Size) v.size = s.Size;
  const duration = ms(s.RunTimeTicks);
  if (duration) v.duration = duration;
  const video = streams.find((x) => x.Type === 'Video');
  if (video) {
    v.video = videoStream(video);
    if (video.Codec) v.videoCodec = video.Codec;
    const res = resolution(video.Width, video.Height);
    if (res) v.resolution = res;
  }
  v.audio = streams.filter((x) => x.Type === 'Audio').map((x) => audioStream(x, s.DefaultAudioStreamIndex));
  v.subtitles = streams.filter((x) => x.Type === 'Subtitle').map((x) => subtitleStream(x, s.DefaultSubtitleStreamIndex, `/Videos/${j.Id}/${s.Id}/Subtitles`));
  return v;
}

/** Wide films are short, so width decides first: 3840×1608 is 4K. */
function resolution(w = 0, h = 0): string | undefined {
  if (w >= 3200 || h >= 2000) return '4k';
  if (w >= 1800 || h >= 1000) return '1080';
  if (w >= 1200 || h >= 700) return '720';
  return w || h ? 'sd' : undefined;
}

function range(type: string | undefined): Range {
  if (type?.startsWith('DOVI')) return 'DV';
  if (type === 'HDR10Plus') return 'HDR10+';
  if (type === 'HLG') return 'HLG';
  if (type === 'HDR10') return 'HDR10';
  return 'SDR';
}

function videoStream(s: MediaStream): VideoStream {
  const v: VideoStream = { range: range(s.VideoRangeType) };
  if (s.Codec) v.codec = s.Codec;
  if (v.range === 'DV') {
    if (s.DvProfile) v.dvProfile = s.DvProfile;
    if (s.DvBlSignalCompatibilityId !== undefined) v.dvCompat = s.DvBlSignalCompatibilityId;
  }
  return v;
}

const LAYOUTS: Record<string, string> = { mono: '1.0', stereo: '2.0' };

function channels(s: MediaStream): string | undefined {
  const layout = s.ChannelLayout?.toLowerCase().replace(/\(.*\)$/, '');
  if (layout && LAYOUTS[layout]) return LAYOUTS[layout];
  if (layout && /^\d\.\d$/.test(layout)) return layout;
  return channelLayout(s.Channels);
}

function audioStream(s: MediaStream, preferred: number | undefined): AudioStream {
  // The profile names extensions, e.g. "DTS-HD MA + DTS:X" or
  // "Dolby TrueHD + Dolby Atmos"; the file's own title sometimes does instead.
  const named = `${s.Profile ?? ''} ${s.Title ?? ''}`;
  const a: AudioStream = { id: s.Index, index: s.Index, atmos: /atmos/i.test(named), dtsx: /dts:x/i.test(named), selected: s.Index === preferred };
  const c = codec(s.Codec);
  if (c) a.codec = c;
  const layout = channels(s);
  if (layout) a.channels = layout;
  if (c === 'dts' && /\bMA\b/.test(s.Profile ?? '')) a.dtsHd = 'ma';
  else if (c === 'dts' && /\bHRA\b/.test(s.Profile ?? '')) a.dtsHd = 'hra';
  const lang = language(s.Language);
  if (lang) a.language = lang;
  if (s.Title) a.title = s.Title;
  if (c) a.format = [c.toUpperCase(), layout].filter(Boolean).join(' ');
  return a;
}

/** `files` is where the version's subtitle files are served; Kodi loads a
 * file of the track's own format. */
function subtitleStream(s: MediaStream, preferred: number | undefined, files: string): SubtitleStream {
  const t: SubtitleStream = { id: s.Index, index: s.Index, forced: !!s.IsForced, hearingImpaired: !!s.IsHearingImpaired, selected: s.Index === preferred };
  const lang = language(s.Language);
  if (lang) t.language = lang;
  if (s.Title) t.title = s.Title;
  const c = codec(s.Codec);
  if (c) t.codec = c;
  if (s.IsExternal) t.file = `${files}/${s.Index}/0/Stream.${c ?? 'srt'}`;
  return t;
}
