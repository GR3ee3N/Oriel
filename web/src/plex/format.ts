// Format Plex metadata for the interface.

import { type Key, t } from '../i18n';
import { en } from '../i18n/en';
import type { Media, Metadata, Stream } from './types';

// Strip invisible characters used by tools such as Kometa to distinguish
// collection titles, including zero-width and bidirectional marks. Emoji
// variation selectors go too: the monochrome emoji font draws them as boxes.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufe0e\ufe0f\ufeff]/g;

export function clean(text: string | undefined): string {
  return (text ?? '').replace(INVISIBLE, '').trim();
}

/** Oriel's title for a hub it knows, such as "Up Next" for On Deck;
 * other hubs, including Kometa collections, keep the server's title. */
export function hubTitle(hub: { hubIdentifier: string; title: string }): string {
  const key = `hub.${hub.hubIdentifier}` as Key;
  return key in en ? t(key) : clean(hub.title);
}

/** Format milliseconds as hours and minutes, e.g. "1 h 52 min" or "48 min". */
export function duration(ms: number | undefined): string {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return t('time.m', { m: min });
  return min % 60 ? t('time.hm', { h: Math.floor(min / 60), m: min % 60 }) : t('time.h', { h: min / 60 });
}

/** Remaining duration, e.g. "41 min left"; blank for items without progress. */
export function remaining(m: Metadata): string {
  if (!m.viewOffset || !m.duration) return '';
  return t('time.left', { time: duration(Math.max(60000, m.duration - m.viewOffset)) });
}

/** Season count with singular or plural wording, e.g. "3 seasons". */
export function seasonCount(m: Metadata): string {
  return m.childCount ? t('count.seasons', { n: m.childCount }) : '';
}

/** Age rating without Plex's country prefix: "de/12" becomes "FSK 12",
 * other countries show the bare value such as "PG-13". */
export function ageRating(rating: string | undefined): string {
  if (!rating) return '';
  const [country, value] = rating.includes('/') ? rating.split('/', 2) : ['', rating];
  return country === 'de' ? `FSK ${value}` : value;
}

/** Local time in 24-hour HH:MM format. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Season and episode code, e.g. "S2 · E5". */
export function episodeCode(m: Metadata): string {
  return m.parentIndex !== undefined && m.index !== undefined ? t('episode.code', { season: m.parentIndex, episode: m.index }) : '';
}

/** Compact code for button labels, e.g. "S2·E5". */
export function shortCode(m: Metadata): string {
  return m.parentIndex !== undefined && m.index !== undefined ? t('episode.codeShort', { season: m.parentIndex, episode: m.index }) : '';
}

/** Use the show title for episodes and seasons, otherwise the item title. */
export function tileTitle(m: Metadata): string {
  return clean(m.type === 'episode' ? m.grandparentTitle : m.type === 'season' ? m.parentTitle : m.title);
}

/** Tile caption: episode code with remaining time or title, season title,
 * season or item count, or year with remaining time or duration. */
export function tileSubtitle(m: Metadata, wide = false): string {
  const left = remaining(m);
  if (m.type === 'episode') return [episodeCode(m), left || clean(m.title)].filter(Boolean).join(' · ');
  if (m.type === 'season') return clean(m.title);
  if (m.type === 'show') return seasonCount(m);
  if (m.type === 'collection' || m.type === 'playlist') return m.childCount || m.leafCount ? t('count.items', { n: m.childCount ?? m.leafCount ?? 0 }) : '';
  return [m.year, left || (wide || m.duration ? duration(m.duration) : '')].filter(Boolean).join(' · ');
}

export function isWatched(m: Metadata): boolean {
  if (m.type === 'show' || m.type === 'season') return !!m.leafCount && m.viewedLeafCount === m.leafCount;
  return (m.viewCount ?? 0) > 0 && !m.viewOffset;
}

export function progress(m: Metadata): number {
  return m.viewOffset && m.duration ? Math.min(1, m.viewOffset / m.duration) : 0;
}

/** Count unwatched episodes for a show or season. */
export function unwatched(m: Metadata): number {
  if (m.type !== 'show' && m.type !== 'season') return 0;
  return Math.max(0, (m.leafCount ?? 0) - (m.viewedLeafCount ?? 0));
}

/** Badges for the first media version: resolution, dynamic range, then audio
 * codec, spatial format and channels, e.g. 4K · Dolby Vision P8.1 · TrueHD Atmos 7.1.
 * Dynamic range requires stream metadata and is omitted from summary-only lists.
 * `playing` overrides Plex's selected audio flag, which does not track Kodi changes. */
export function badges(m: Metadata | undefined, playing?: Stream): string[] {
  const media = m?.Media?.[0];
  if (!media) return [];
  const streams = media.Part?.[0]?.Stream;
  const video = streams?.find((s) => s.streamType === 1);
  // Prefer the active track, then Plex's selection, then the first audio stream.
  const audio =
    playing ?? streams?.find((s) => s.streamType === 2 && s.selected) ?? streams?.find((s) => s.streamType === 2);
  const out: string[] = [];
  const res = media.videoResolution;
  if (res === '4k') out.push('4K');
  else if (res === '1080' || res === '720') out.push('HD');
  else if (res) out.push('SD');
  if (video) out.push(dynamicRange(video));
  const sound = audio
    ? soundOf(audio.codec, audio.profile, audio.displayTitle, channelsOf(audio))
    : streams
      ? ''
      : soundOf(media.audioCodec, media.audioProfile, undefined, channelLabel(media.audioChannels));
  if (sound) out.push(sound);
  return out;
}

/** A media version for the Version choice: "4K · Dolby Vision" with
 * "HEVC · 44 Mbps · MKV · 52.1 GB" as its detail. */
export function versionLabel(media: Media): { label: string; detail: string } {
  const video = media.Part?.[0]?.Stream?.find((s) => s.streamType === 1);
  const res = media.videoResolution;
  const size = media.Part?.[0]?.size;
  return {
    label: [res === '4k' ? '4K' : res === 'sd' ? 'SD' : res ? `${res}p` : '', video ? dynamicRange(video) : ''].filter(Boolean).join(' · '),
    detail: [
      media.videoCodec?.toUpperCase(),
      media.bitrate ? `${Math.round(media.bitrate / 1000)} Mbps` : '',
      media.container?.toUpperCase(),
      size ? `${(size / 1e9).toFixed(1)} GB` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** Dolby Vision with its profile, e.g. "Dolby Vision P8.1". Profiles 8 and
 * 10 name their base layer's compatibility as a sub-profile. */
function dolbyVision(video: Stream): string {
  const p = video.DOVIProfile;
  if (!p) return 'Dolby Vision';
  const id = video.DOVIBLCompatID;
  return `Dolby Vision P${p}${(p === 8 || p === 10) && id !== undefined ? `.${id}` : ''}`;
}

function dynamicRange(video: Stream): string {
  const title = video.displayTitle ?? '';
  if (video.DOVIPresent || /dovi|dolby vision/i.test(title)) return dolbyVision(video);
  if (/hdr10\+/i.test(title)) return 'HDR10+';
  if (video.colorTrc === 'arib-std-b67' || /hlg/i.test(title)) return 'HLG';
  if (video.colorTrc === 'smpte2084' || /hdr/i.test(title)) return 'HDR10';
  return 'SDR';
}

/** Format audio as "TrueHD Atmos 7.1", "DD+ 5.1" or "AAC 2.0".
 * `profile` is Plex's codec profile, e.g. "ma + dts:x" or "lc"; `title` is
 * Plex's displayTitle, e.g. "Deutsch (EAC3 5.1 + Atmos)", not the file's track name. */
function soundOf(codec?: string, profile?: string | null, title?: string, channels?: string): string {
  if (!codec) return '';
  const p = (profile ?? '').toLowerCase();
  const atmos = p.includes('atmos') || /\batmos\b/i.test(title ?? '');
  const dtsx = p.includes('dts:x') || /dts:x/i.test(title ?? '');
  let name: string;
  switch (codec.toLowerCase()) {
    case 'truehd':
      name = atmos ? 'TrueHD Atmos' : 'TrueHD';
      break;
    case 'eac3':
      name = atmos ? 'DD+ Atmos' : 'DD+';
      break;
    case 'ac3':
      name = 'DD';
      break;
    case 'dca':
    case 'dca-ma':
    case 'dts':
      name = dtsx ? 'DTS:X' : p.includes('ma') || codec === 'dca-ma' ? 'DTS-HD MA' : p.includes('hra') ? 'DTS-HD HRA' : 'DTS';
      break;
    case 'pcm':
    case 'lpcm':
      name = 'PCM';
      break;
    case 'opus':
      name = 'Opus';
      break;
    case 'vorbis':
      name = 'Vorbis';
      break;
    default:
      name = codec.toUpperCase();
  }
  return channels ? `${name} ${channels}` : name;
}

/** Prefer the layout in Plex's display title, such as "Stereo" or "5.1";
 * the numeric channel count can be missing for DTS. */
function channelsOf(audio: Stream): string {
  const named = audio.displayTitle?.match(/\b(Mono|Stereo|\d\.\d)\b/)?.[1];
  if (named === 'Mono') return '1.0';
  if (named === 'Stereo') return '2.0';
  return named ?? channelLabel(audio.channels);
}

function channelLabel(channels: number | undefined): string {
  if (!channels) return '';
  return { 1: '1.0', 2: '2.0', 6: '5.1', 7: '6.1', 8: '7.1' }[channels] ?? `${channels} ch`;
}
