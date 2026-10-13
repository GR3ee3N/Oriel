// Text for the UI, mostly from Plex metadata.

import type { Metadata, Stream } from './types';

// Zero-width and bidi marks: tools such as Kometa hide them in collection
// titles to keep them unique.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;

export function clean(text: string | undefined): string {
  return (text ?? '').replace(INVISIBLE, '').trim();
}

/** 1 h 52 min, 48 min. */
export function duration(ms: number | undefined): string {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

/** 41 min left, 1 h 52 min left */
export function remaining(m: Metadata): string {
  if (!m.viewOffset || !m.duration) return '';
  return `${duration(Math.max(60000, m.duration - m.viewOffset))} left`;
}

/** 3 seasons */
export function seasonCount(m: Metadata): string {
  return m.childCount ? `${m.childCount} season${m.childCount === 1 ? '' : 's'}` : '';
}

/** 21:05 */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** S2 · E5 */
export function episodeCode(m: Metadata): string {
  return m.parentIndex !== undefined && m.index !== undefined ? `S${m.parentIndex} · E${m.index}` : '';
}

/** The title a tile shows: the show for an episode, else the item. */
export function tileTitle(m: Metadata): string {
  return clean(m.type === 'episode' ? m.grandparentTitle : m.type === 'season' ? m.parentTitle : m.title);
}

/** The line under a tile's title. */
export function tileSubtitle(m: Metadata): string {
  if (m.type === 'episode') return [episodeCode(m), clean(m.title)].filter(Boolean).join(' · ');
  if (m.type === 'season') return clean(m.title);
  if (m.type === 'show' && m.childCount) return seasonCount(m);
  return m.year ? String(m.year) : '';
}

export function isWatched(m: Metadata): boolean {
  if (m.type === 'show' || m.type === 'season') return !!m.leafCount && m.viewedLeafCount === m.leafCount;
  return (m.viewCount ?? 0) > 0 && !m.viewOffset;
}

export function progress(m: Metadata): number {
  return m.viewOffset && m.duration ? Math.min(1, m.viewOffset / m.duration) : 0;
}

/** Unwatched episodes of a show or season. */
export function unwatched(m: Metadata): number {
  if (m.type !== 'show' && m.type !== 'season') return 0;
  return Math.max(0, (m.leafCount ?? 0) - (m.viewedLeafCount ?? 0));
}

/** The picture and sound of an item's first version, always in this
 * order: resolution (4K, HD, SD), dynamic range (Dolby Vision, HDR10+,
 * HDR10, HLG, SDR) and the sound (codec, Atmos or DTS:X, channels), e.g.
 * 4K · Dolby Vision · TrueHD Atmos 7.1. The range needs the streams (full
 * metadata); lists only have the media's summary, so it is left out there
 * rather than guessed. */
export function badges(m: Metadata | undefined): string[] {
  const media = m?.Media?.[0];
  if (!media) return [];
  const streams = media.Part?.[0]?.Stream;
  const video = streams?.find((s) => s.streamType === 1);
  // The track that plays: the user's (or Plex's) choice, else the first.
  const audio = streams?.find((s) => s.streamType === 2 && s.selected) ?? streams?.find((s) => s.streamType === 2);
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

function dynamicRange(video: Stream): string {
  const title = video.displayTitle ?? '';
  if (video.DOVIPresent || /dovi|dolby vision/i.test(title)) return 'Dolby Vision';
  if (/hdr10\+/i.test(title)) return 'HDR10+';
  if (video.colorTrc === 'arib-std-b67' || /hlg/i.test(title)) return 'HLG';
  if (video.colorTrc === 'smpte2084' || /hdr/i.test(title)) return 'HDR10';
  return 'SDR';
}

/** "TrueHD Atmos 7.1", "DD+ 5.1", "AAC 2.0". `profile` is Plex's: "dolby
 * truehd + dolby atmos", "ma + dts:x", "hra", "lc"; `title` its own
 * display title ("Deutsch (EAC3 5.1 + Atmos)"), not the file's track name. */
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

/** The channel layout as Plex's display title has it ("Stereo", "5.1"),
 * which is right more often than the bare count (DTS reports none). */
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
