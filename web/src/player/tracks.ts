// Plex's audio and subtitle streams as tracks Kodi can select.
//
// Kodi lists a file's streams of each kind in container order, which is
// Plex's `index`; so a track's Kodi index is its position among the
// embedded streams of its kind sorted by `index`. Sidecar subtitle files
// (they have a `key`) are not in the file: Kodi loads them by URL.
//
// Kodi's audio list is in that order too. Its subtitle list can differ (Kodi
// lists external subtitles first), so once the file plays, Kodi's own list
// (the player state) confirms a subtitle's index: a track that matches
// exactly one of Kodi's is that one; with no match or several, container
// order stands.

import type { SubtitleTrack } from '@oriel/web';
import type { Part, Stream } from '../plex/types';

export interface Track {
  /** Plex's stream id (0: subtitles off). */
  id: number;
  label: string;
  detail: string;
  /** Kodi's index among its streams of this kind; -1 for none or a file. */
  kodi: number;
  /** A sidecar subtitle file's path on the server. */
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

/** "German" from "de"; language names in the UI's language rather than
 * Plex's titles in the track's own script, which the UI font may lack. */
function language(s: Stream): string {
  const tag = s.languageTag ?? s.languageCode;
  if (tag && languages) {
    try {
      const name = languages.of(tag);
      if (name && name !== tag) return name;
    } catch {
      // not a valid tag
    }
  }
  return s.displayTitle?.replace(/\s*\(.*\)$/, '') || 'Unknown';
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function audioDetail(s: Stream): string {
  // Plex's "Deutsch (EAC3 5.1 + Atmos)": the part in brackets, and the
  // stream's own title; only the title when it says the format again
  // ("E-AC3 5.1 @ 640 kbps", "TrueHD 7.1 (Atmos)").
  const format = s.displayTitle?.match(/\(([^)]*)\)\s*$/)?.[1] ?? s.codec?.toUpperCase() ?? '';
  if (s.title && plain(s.title).startsWith(plain(format))) return s.title;
  return [format, s.title].filter(Boolean).join(' · ');
}

function subtitleDetail(s: Stream): string {
  return [s.forced ? 'Forced' : '', s.hearingImpaired ? 'SDH' : '', s.title, s.codec?.toUpperCase(), s.key ? 'File' : '']
    .filter(Boolean)
    .join(' · ');
}

/** Tracks that would read the same ("English · PGS" twice) get their
 * number in the file, so they can be told apart. */
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

/** Kodi's and Plex's language tags: "de", "pt-BR". */
const sameLanguage = (kodi: string, s: Stream) =>
  kodi.split('-')[0].toLowerCase() === (s.languageTag ?? '').split('-')[0].toLowerCase();

function only<T extends { index: number }>(matches: T[]): number | undefined {
  return matches.length === 1 ? matches[0].index : undefined;
}

/** Kodi's index for an embedded subtitle track, if exactly one of Kodi's
 * matches. Kodi doesn't say the codec; its name is the stream's title. */
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
