// Convert Plex replies into the server-neutral model in media/model.ts.
// Plex's own strings, such as audio profiles and display titles, are read
// here, so the interface works on what they mean.

import type {
  AudioStream,
  Chapter as MediaChapter,
  Item,
  Kind,
  Library,
  Marker as MediaMarker,
  Paged,
  Person,
  Range,
  Row,
  Sound,
  SubtitleStream,
  Tag as MediaTag,
  Version,
  VideoStream,
} from '../media/model';
import { channelLayout, compact } from '../media/convert';
import type { Details } from './api';
import type { Chapter, Directory, Hub, Marker, Media, MediaContainer, Metadata, Role, Stream, Tag } from './types';

const KINDS: readonly string[] = ['movie', 'show', 'season', 'episode', 'collection', 'playlist', 'clip'];

export function item(m: Details): Item {
  const kind = (KINDS.includes(m.type) ? m.type : 'other') as Kind;
  const out: Item = { id: m.ratingKey, kind, title: m.title, art: artwork(m) };
  if (kind === 'episode') {
    if (m.grandparentRatingKey) out.show = { id: m.grandparentRatingKey, title: m.grandparentTitle ?? '' };
    if (m.parentRatingKey) out.season = { id: m.parentRatingKey, title: m.parentTitle, number: m.parentIndex };
  } else if (kind === 'season') {
    if (m.parentRatingKey) out.show = { id: m.parentRatingKey, title: m.parentTitle ?? '' };
    out.showYear = m.parentYear;
  }
  out.number = m.index;
  out.year = m.year;
  out.released = m.originallyAvailableAt;
  out.summary = m.summary;
  out.tagline = m.tagline;
  out.studio = m.studio;
  out.ageRating = ageRating(m.contentRating);
  out.audienceRating = m.audienceRating;
  out.duration = m.duration;
  out.position = m.viewOffset;
  out.plays = m.viewCount;
  if ((kind === 'show' || kind === 'season') && m.leafCount !== undefined) {
    out.episodes = { total: m.leafCount, watched: m.viewedLeafCount ?? 0 };
  }
  if (kind === 'show') out.count = m.childCount;
  else if (kind === 'collection' || kind === 'playlist') out.count = m.childCount ?? m.leafCount;
  if (m.librarySectionID !== undefined) out.library = String(m.librarySectionID);
  out.genres = m.Genre?.map((g) => g.tag);
  out.directors = m.Director?.map((d) => d.tag);
  out.cast = m.Role?.map(person);
  out.collections = m.Collection?.map(tag);
  out.guid = m.guid;
  out.versions = m.Media?.map(version);
  out.markers = m.Marker?.flatMap(marker);
  out.chapters = m.Chapter?.map(chapter);
  out.extras = m.Extras?.Metadata?.map(item);
  if (m.OnDeck?.Metadata) out.next = item(m.OnDeck.Metadata);
  return compact(out);
}

export function row(hub: Hub): Row {
  return { id: hub.hubIdentifier, title: hub.title, type: hub.type, items: (hub.Metadata ?? []).map(item) };
}

/** A page of a library listing. */
export function paged(mc: MediaContainer<Metadata>): Paged<Item> {
  return { total: mc.totalSize ?? mc.size, items: (mc.Metadata ?? []).map(item) };
}

/** Movie and show libraries; other kinds such as music give undefined. */
export function library(d: Directory): Library | undefined {
  if (d.type !== 'movie' && d.type !== 'show') return undefined;
  return { id: d.key, title: d.title, kind: d.type === 'movie' ? 'movie' : 'show' };
}

function artwork(m: Metadata): Item['art'] {
  const art: Item['art'] = { image: m.thumb, backdrop: m.art };
  if (m.type === 'episode') {
    art.showImage = m.grandparentThumb;
    art.showBackdrop = m.grandparentArt;
    art.seasonImage = m.parentThumb;
  } else if (m.type === 'season') {
    art.showImage = m.parentThumb;
  }
  art.logo = m.Image?.find((i) => i.type === 'clearLogo')?.url;
  art.colors = m.UltraBlurColors;
  return compact(art);
}

/** "de/12" is Plex's German FSK 12; ratings without a country stay as they are. */
export function ageRating(rating: string | undefined): Item['ageRating'] {
  if (!rating) return undefined;
  if (!rating.includes('/')) return { value: rating };
  const [country, value] = rating.split('/', 2);
  return { country, value };
}

/** A tag's id is the value of its library filter, e.g. 1234 in 'collection=1234'. */
const filterId = (t: Tag) => t.filter?.split('=')[1] ?? (t.id !== undefined ? String(t.id) : undefined);

function tag(t: Tag): MediaTag {
  const out: MediaTag = { title: t.tag };
  const id = filterId(t);
  if (id) out.id = id;
  return out;
}

function person(r: Role): Person {
  const p: Person = { name: r.tag };
  const id = filterId(r);
  if (id) p.id = id;
  if (r.role) p.role = r.role;
  if (r.thumb) p.photo = r.thumb;
  return p;
}

function marker(m: Marker): MediaMarker[] {
  if (m.type !== 'intro' && m.type !== 'credits') return [];
  return [{ kind: m.type === 'intro' ? 'intro' : 'credits', start: m.startTimeOffset, end: m.endTimeOffset, final: !!m.final }];
}

/** Chapter images name the version the times belong to:
 * '/library/media/<mediaId>/chapterImages/<n>'. */
function chapter(c: Chapter): MediaChapter {
  const out: MediaChapter = { start: c.startTimeOffset };
  if (c.tag) out.title = c.tag;
  if (c.endTimeOffset !== undefined) out.end = c.endTimeOffset;
  if (c.thumb) out.image = c.thumb;
  const media = c.thumb?.match(/^\/library\/media\/(\d+)\//)?.[1];
  if (media) out.version = media;
  return out;
}

function version(media: Media): Version {
  const part = media.Part?.[0];
  const v: Version = { id: String(media.id), thumbs: part?.indexes === 'sd' };
  if (part?.key) v.file = { id: String(part.id), path: part.key };
  if (media.container) v.container = media.container;
  if (media.bitrate) v.bitrate = media.bitrate;
  if (media.videoResolution) v.resolution = media.videoResolution;
  if (media.videoCodec) v.videoCodec = media.videoCodec;
  if (part?.size) v.size = part.size;
  if (media.duration) v.duration = media.duration;
  if (media.audioCodec) v.sound = sound(media.audioCodec, media.audioProfile, undefined, channelLabel(media.audioChannels));
  const streams = part?.Stream;
  if (streams) {
    const video = streams.find((s) => s.streamType === 1);
    if (video) v.video = videoStream(video);
    v.audio = streams.filter((s) => s.streamType === 2).map(audioStream);
    v.subtitles = streams.filter((s) => s.streamType === 3).map(subtitleStream);
  }
  return v;
}

function videoStream(s: Stream): VideoStream {
  const v: VideoStream = { range: range(s) };
  if (s.codec) v.codec = s.codec;
  if (v.range === 'DV') {
    if (s.DOVIProfile) v.dvProfile = s.DOVIProfile;
    if (s.DOVIBLCompatID !== undefined) v.dvCompat = s.DOVIBLCompatID;
  }
  return v;
}

/** Plex flags Dolby Vision & names HDR10+ only in the display title, e.g.
 * "4K DoVi/HDR10+"; the transfer function tells HLG from HDR10. */
function range(video: Stream): Range {
  const title = video.displayTitle ?? '';
  if (video.DOVIPresent || /dovi|dolby vision/i.test(title)) return 'DV';
  if (/hdr10\+/i.test(title)) return 'HDR10+';
  if (video.colorTrc === 'arib-std-b67' || /hlg/i.test(title)) return 'HLG';
  if (video.colorTrc === 'smpte2084' || /hdr/i.test(title)) return 'HDR10';
  return 'SDR';
}

/** `profile` is Plex's codec profile, e.g. "ma + dts:x", "lc" or "dolby truehd
 * + dolby atmos"; `title` is Plex's display title, e.g. "Deutsch (EAC3 5.1 +
 * Atmos)", which names Atmos when the profile doesn't. */
function sound(codec: string | undefined, profile: string | null | undefined, title: string | undefined, channels: string): Sound {
  const p = (profile ?? '').toLowerCase();
  const s: Sound = {
    atmos: p.includes('atmos') || /\batmos\b/i.test(title ?? ''),
    dtsx: p.includes('dts:x') || /dts:x/i.test(title ?? ''),
  };
  if (codec) s.codec = codec;
  if (channels) s.channels = channels;
  const dts = codec === 'dca' || codec === 'dca-ma' || codec === 'dts';
  if (dts && (p.includes('ma') || codec === 'dca-ma')) s.dtsHd = 'ma';
  else if (dts && p.includes('hra')) s.dtsHd = 'hra';
  return s;
}

/** Plex's display title names the layout, such as "Stereo" or "5.1"; the
 * channel count can be missing for DTS. */
function channelsOf(s: Stream): string {
  const named = s.displayTitle?.match(/\b(Mono|Stereo|\d\.\d)\b/)?.[1];
  if (named === 'Mono') return '1.0';
  if (named === 'Stereo') return '2.0';
  return named ?? channelLabel(s.channels);
}

const channelLabel = (channels: number | undefined) => channelLayout(channels) ?? '';

/** "Deutsch (EAC3 5.1)" names the language, then the format in brackets. */
const nameOf = (s: Stream) => s.displayTitle?.replace(/\s*\(.*\)$/, '') || undefined;
const formatOf = (s: Stream) => s.displayTitle?.match(/\(([^)]*)\)\s*$/)?.[1] ?? s.codec?.toUpperCase();

function audioStream(s: Stream): AudioStream {
  const a: AudioStream = { id: s.id, ...sound(s.codec, s.profile, s.displayTitle, channelsOf(s)), selected: !!s.selected };
  if (s.index !== undefined) a.index = s.index;
  const language = s.languageTag ?? s.languageCode;
  if (language) a.language = language;
  const name = nameOf(s);
  if (name) a.name = name;
  if (s.title) a.title = s.title;
  const format = formatOf(s);
  if (format) a.format = format;
  return a;
}

function subtitleStream(s: Stream): SubtitleStream {
  const t: SubtitleStream = { id: s.id, forced: !!s.forced, hearingImpaired: !!s.hearingImpaired, selected: !!s.selected };
  if (s.index !== undefined) t.index = s.index;
  const language = s.languageTag ?? s.languageCode;
  if (language) t.language = language;
  const name = nameOf(s);
  if (name) t.name = name;
  if (s.title) t.title = s.title;
  if (s.codec) t.codec = s.codec;
  if (s.key) t.file = s.key;
  return t;
}
