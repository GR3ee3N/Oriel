// Format items from the server-neutral model (media/model.ts) for the
// interface. Server strings are read into the model by each server's
// adapter (plex/convert.ts); this file only chooses the wording.

import { type Key, t } from '../i18n';
import { en } from '../i18n/en';
import type { AudioStream, Item, Row, Sound, Version, VideoStream } from './model';

// Strip invisible characters used by tools such as Kometa to distinguish
// collection titles, including zero-width and bidirectional marks. Emoji
// variation selectors go too: the monochrome emoji font draws them as boxes.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufe0e\ufe0f\ufeff]/g;

export function clean(text: string | undefined): string {
  return (text ?? '').replace(INVISIBLE, '').trim();
}

/** Oriel's title for a row it knows, such as "Up Next" for On Deck;
 * other rows, including Kometa collections, keep the server's title. */
export function hubTitle(row: Pick<Row, 'id' | 'title'>): string {
  const key = `hub.${row.id}` as Key;
  return key in en ? t(key) : clean(row.title);
}

/** Format milliseconds as hours and minutes, e.g. "1 h 52 min" or "48 min". */
export function duration(ms: number | undefined): string {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return t('time.m', { m: min });
  return min % 60 ? t('time.hm', { h: Math.floor(min / 60), m: min % 60 }) : t('time.h', { h: min / 60 });
}

/** Remaining duration, e.g. "41 min left"; blank for items without progress. */
export function remaining(item: Item): string {
  if (!item.position || !item.duration) return '';
  return t('time.left', { time: duration(Math.max(60000, item.duration - item.position)) });
}

/** Season count with singular or plural wording, e.g. "3 seasons". */
export function seasonCount(item: Item): string {
  return item.count ? t('count.seasons', { n: item.count }) : '';
}

/** Age rating without a country prefix: { country: 'de', value: '12' }
 * becomes "FSK 12", other countries show the bare value such as "PG-13". */
export function ageRating(rating: Item['ageRating']): string {
  if (!rating) return '';
  return rating.country === 'de' ? `FSK ${rating.value}` : rating.value;
}

/** A YYYY-MM-DD date as "6 Nov 2021"; blank when absent or malformed. */
export function airDate(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const month = m && t('date.months').split(' ')[Number(m[2]) - 1];
  return m && month ? t('date.day', { day: Number(m[3]), month, year: m[1] }) : '';
}

/** A season's name: Specials for season 0, else the server's title. */
export function seasonName(item: Item): string {
  return item.number === 0 ? t('details.specials') : clean(item.title);
}

/** Local time in 24-hour HH:MM format. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A position in playback as H:MM:SS, or M:SS under an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return (hms[0] ? hms : hms.slice(1)).map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':');
}

/** Season and episode code, e.g. "S2 · E5". */
export function episodeCode(item: Item): string {
  return item.season?.number !== undefined && item.number !== undefined
    ? t('episode.code', { season: item.season.number, episode: item.number })
    : '';
}

/** Compact code for button labels, e.g. "S2·E5". */
export function shortCode(item: Item): string {
  return item.season?.number !== undefined && item.number !== undefined
    ? t('episode.codeShort', { season: item.season.number, episode: item.number })
    : '';
}

/** Use the show title for episodes and seasons, otherwise the item title. */
export function tileTitle(item: Item): string {
  return clean(item.kind === 'episode' || item.kind === 'season' ? item.show?.title : item.title);
}

/** Tile caption: episode code with remaining time or title, season title,
 * season or item count, or year with remaining time or duration. */
export function tileSubtitle(item: Item, wide = false): string {
  const left = remaining(item);
  if (item.kind === 'episode') return [episodeCode(item), left || clean(item.title)].filter(Boolean).join(' · ');
  if (item.kind === 'season') return clean(item.title);
  if (item.kind === 'show') return seasonCount(item);
  if (item.kind === 'collection' || item.kind === 'playlist') return item.count ? t('count.items', { n: item.count }) : '';
  return [item.year, left || (wide || item.duration ? duration(item.duration) : '')].filter(Boolean).join(' · ');
}

/** A playlist's play count says it was played, not that its titles were watched. */
export function isWatched(item: Item): boolean {
  if (item.kind === 'playlist') return false;
  if (item.kind === 'show' || item.kind === 'season') return !!item.episodes?.total && item.episodes.watched === item.episodes.total;
  return (item.plays ?? 0) > 0 && !item.position;
}

export function progress(item: Item): number {
  return item.position && item.duration ? Math.min(1, item.position / item.duration) : 0;
}

/** Count unwatched episodes for a show or season. */
export function unwatched(item: Item): number {
  if (item.kind !== 'show' && item.kind !== 'season') return 0;
  return Math.max(0, (item.episodes?.total ?? 0) - (item.episodes?.watched ?? 0));
}

/** Badges for the first version: resolution, dynamic range, then audio
 * codec, spatial format and channels, e.g. 4K · Dolby Vision P8.1 · TrueHD Atmos 7.1.
 * Dynamic range requires stream metadata and is omitted from summary-only lists.
 * `playing` overrides the server's selected audio flag, which does not track Kodi changes. */
export function badges(item: Item | undefined, playing?: AudioStream): string[] {
  const version = item?.versions?.[0];
  if (!version) return [];
  // Prefer the active track, then the server's selection, then the first audio stream.
  const audio = playing ?? version.audio?.find((a) => a.selected) ?? version.audio?.[0];
  const out: string[] = [];
  const res = version.resolution;
  if (res === '4k') out.push('4K');
  else if (res === '1080' || res === '720') out.push('HD');
  else if (res) out.push('SD');
  if (version.video) out.push(rangeLabel(version.video));
  const sound = audio ? soundLabel(audio) : version.audio ? '' : version.sound ? soundLabel(version.sound) : '';
  if (sound) out.push(sound);
  return out;
}

/** A version for the Version choice: "4K · Dolby Vision" with
 * "HEVC · 44 Mbps · MKV · 52.1 GB" as its detail. */
export function versionLabel(version: Version): { label: string; detail: string } {
  const res = version.resolution;
  return {
    label: [res === '4k' ? '4K' : res === 'sd' ? 'SD' : res ? `${res}p` : '', version.video ? rangeLabel(version.video) : '']
      .filter(Boolean)
      .join(' · '),
    detail: [
      version.videoCodec?.toUpperCase(),
      version.bitrate ? `${Math.round(version.bitrate / 1000)} Mbps` : '',
      version.container?.toUpperCase(),
      version.size ? `${(version.size / 1e9).toFixed(1)} GB` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** Dolby Vision with its profile, e.g. "Dolby Vision P8.1". Profiles 8 and
 * 10 name their base layer's compatibility as a sub-profile. */
function dolbyVision(video: VideoStream): string {
  const p = video.dvProfile;
  if (!p) return 'Dolby Vision';
  const id = video.dvCompat;
  return `Dolby Vision P${p}${(p === 8 || p === 10) && id !== undefined ? `.${id}` : ''}`;
}

function rangeLabel(video: VideoStream): string {
  switch (video.range) {
    case 'DV':
      return dolbyVision(video);
    case 'HDR10+':
      return 'HDR10+';
    case 'HLG':
      return 'HLG';
    case 'HDR10':
      return 'HDR10';
    default:
      return 'SDR';
  }
}

/** Format audio as "TrueHD Atmos 7.1", "DD+ 5.1" or "AAC 2.0". */
function soundLabel(s: Sound): string {
  if (!s.codec) return '';
  let name: string;
  switch (s.codec.toLowerCase()) {
    case 'truehd':
      name = s.atmos ? 'TrueHD Atmos' : 'TrueHD';
      break;
    case 'eac3':
      name = s.atmos ? 'DD+ Atmos' : 'DD+';
      break;
    case 'ac3':
      name = 'DD';
      break;
    case 'dca':
    case 'dca-ma':
    case 'dts':
      name = s.dtsx ? 'DTS:X' : s.dtsHd === 'ma' ? 'DTS-HD MA' : s.dtsHd === 'hra' ? 'DTS-HD HRA' : 'DTS';
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
      name = s.codec.toUpperCase();
  }
  return s.channels ? `${name} ${s.channels}` : name;
}
