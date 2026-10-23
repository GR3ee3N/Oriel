// Map Plex streams to Kodi track indexes. Embedded streams are grouped by
// kind and sorted by Plex's container `index`. Sidecar subtitles have a `key`
// and are loaded by URL.
//
// Kodi can list external subtitles before embedded ones. After playback starts,
// use a unique match in Kodi's reported list to confirm the subtitle index.
// Fall back to container order when the match is missing or ambiguous.

import type { SubtitleTrack } from '@oriel/web';
import type { Part, Stream } from '../plex/types';

export interface Track {
  /** Plex stream id; 0 disables subtitles. */
  id: number;
  label: string;
  detail: string;
  /** Index within Kodi's tracks of this kind; -1 for off or sidecar subtitles. */
  kodi: number;
  /** Server path for a sidecar subtitle file. */
  file?: string;
  selected: boolean;
  stream?: Stream;
}

const languages = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return undefined;
  }
})();

/** Localize language names, e.g. "de" to "German", to avoid track scripts
 * the interface font cannot display. */
function language(s: Stream): string {
  const tag = s.languageTag ?? s.languageCode;
  if (tag && languages) {
    try {
      const name = languages.of(tag);
      if (name && name !== tag) return name;
    } catch {
      // Invalid language tags fall through to the track title.
    }
  }
  return s.displayTitle?.replace(/\s*\(.*\)$/, '') || 'Unknown';
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function audioDetail(s: Stream): string {
  // Combine the format in Plex's display title with the track title, unless
  // the track title already contains it, e.g. "TrueHD 7.1 (Atmos)".
  const format = s.displayTitle?.match(/\(([^)]*)\)\s*$/)?.[1] ?? s.codec?.toUpperCase() ?? '';
  if (s.title && plain(s.title).startsWith(plain(format))) return s.title;
  return [format, s.title].filter(Boolean).join(' · ');
}

function subtitleDetail(s: Stream): string {
  return [s.forced ? 'Forced' : '', s.hearingImpaired ? 'SDH' : '', s.title, s.codec?.toUpperCase(), s.key ? 'File' : '']
    .filter(Boolean)
    .join(' · ');
}

/** Append file track numbers to otherwise identical labels. */
function distinct(tracks: Track[]): Track[] {
  const seen = new Map<string, number>();
  for (const t of tracks) seen.set(`${t.label}|${t.detail}`, (seen.get(`${t.label}|${t.detail}`) ?? 0) + 1);
  return tracks.map((t, i) =>
    (seen.get(`${t.label}|${t.detail}`) ?? 0) > 1
      ? { ...t, detail: [t.detail, `track ${i + 1}`].filter(Boolean).join(' · ') }
      : t,
  );
}

const byIndex = (a: Stream, b: Stream) => (a.index ?? 0) - (b.index ?? 0);

export function audioTracks(part: Part): Track[] {
  return distinct(
    (part.Stream ?? [])
      .filter((s) => s.streamType === 2)
      .sort(byIndex)
      .map((s, i) => ({ id: s.id, label: language(s), detail: audioDetail(s), kodi: i, selected: !!s.selected, stream: s })),
  );
}

export function subtitleTracks(part: Part): Track[] {
  const subs = (part.Stream ?? []).filter((s) => s.streamType === 3);
  const embedded = subs.filter((s) => !s.key).sort(byIndex);
  const files = subs.filter((s) => s.key);
  return distinct([
    ...embedded.map((s, i) => ({
      id: s.id,
      label: language(s),
      detail: subtitleDetail(s),
      kodi: i,
      selected: !!s.selected,
      stream: s,
    })),
    ...files.map((s) => ({
      id: s.id,
      label: language(s),
      detail: subtitleDetail(s),
      kodi: -1,
      file: s.key,
      selected: !!s.selected,
    })),
  ]);
}

export const SUBTITLES_OFF: Track = { id: 0, label: 'Off', detail: '', kodi: -1, selected: false };

/** Normalize Kodi and Plex language tags such as "de" and "pt-BR". */
const sameLanguage = (kodi: string, s: Stream) =>
  kodi.split('-')[0].toLowerCase() === (s.languageTag ?? '').split('-')[0].toLowerCase();

function only<T extends { index: number }>(matches: T[]): number | undefined {
  return matches.length === 1 ? matches[0].index : undefined;
}

/** Match an embedded subtitle to exactly one Kodi track. Kodi reports the
 * stream title as its name and does not report the codec. */
export function kodiSubtitle(track: Track, kodi: SubtitleTrack[]): number | undefined {
  const s = track.stream;
  if (!s || track.file) return undefined;
  return only(
    kodi.filter(
      (k) =>
        sameLanguage(k.language, s) &&
        k.forced === !!s.forced &&
        k.impaired === !!s.hearingImpaired &&
        k.name === (s.title ?? ''),
    ),
  );
}
