// Map a version's streams to Kodi track indexes. Embedded streams are grouped
// by kind and sorted by their container `index`. Sidecar subtitles have a
// `file` and are loaded by URL.
//
// Kodi can list external subtitles before embedded ones. After playback starts,
// use a unique match in Kodi's reported list to confirm the subtitle index.
// Fall back to container order when the match is missing or ambiguous.

import type { SubtitleTrack } from '@oriel/web';
import { t } from '../i18n';
import type { AudioStream, SubtitleStream, Version } from '../media/model';

export interface Track<S extends AudioStream | SubtitleStream = AudioStream | SubtitleStream> {
  /** The server's stream id; 0 disables subtitles. */
  id: number;
  label: string;
  detail: string;
  /** Index within Kodi's tracks of this kind; -1 for off or sidecar subtitles. */
  kodi: number;
  /** Server path for a sidecar subtitle file. */
  file?: string;
  selected: boolean;
  stream?: S;
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
function language(s: AudioStream | SubtitleStream): string {
  const tag = s.language;
  if (tag && languages) {
    try {
      const name = languages.of(tag);
      if (name && name !== tag) return name;
    } catch {
      // Invalid language tags fall through to the track title.
    }
  }
  return s.name || t('track.unknown');
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function audioDetail(s: AudioStream): string {
  // Combine the server's format summary with the track title, unless the
  // track title already contains it, e.g. "TrueHD 7.1 (Atmos)".
  const format = s.format ?? '';
  if (s.title && plain(s.title).startsWith(plain(format))) return s.title;
  return [format, s.title].filter(Boolean).join(' · ');
}

function subtitleDetail(s: SubtitleStream): string {
  return [s.forced ? t('track.forced') : '', s.hearingImpaired ? t('track.sdh') : '', s.title, s.codec?.toUpperCase(), s.file ? t('track.file') : '']
    .filter(Boolean)
    .join(' · ');
}

/** Append file track numbers to otherwise identical labels. */
function distinct<T extends Track>(tracks: T[]): T[] {
  const key = (x: T) => `${x.label}|${x.detail}`;
  const seen = new Map<string, number>();
  for (const x of tracks) seen.set(key(x), (seen.get(key(x)) ?? 0) + 1);
  return tracks.map((x, i) =>
    (seen.get(key(x)) ?? 0) > 1 ? { ...x, detail: [x.detail, t('track.number', { n: i + 1 })].filter(Boolean).join(' · ') } : x,
  );
}

const byIndex = (a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0);

export function audioTracks(version: Version): Track<AudioStream>[] {
  return distinct(
    [...(version.audio ?? [])]
      .sort(byIndex)
      .map((s, i) => ({ id: s.id, label: language(s), detail: audioDetail(s), kodi: i, selected: !!s.selected, stream: s })),
  );
}

export function subtitleTracks(version: Version): Track<SubtitleStream>[] {
  const subs = version.subtitles ?? [];
  const embedded = subs.filter((s) => !s.file).sort(byIndex);
  const files = subs.filter((s) => s.file);
  return distinct<Track<SubtitleStream>>([
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
      file: s.file,
      selected: !!s.selected,
    })),
  ]);
}

export const SUBTITLES_OFF: Track<SubtitleStream> = { id: 0, label: t('details.subtitlesOff'), detail: '', kodi: -1, selected: false };

/** Compare Kodi's and the server's language tags such as "de" and "pt-BR". */
const sameLanguage = (kodi: string, s: SubtitleStream) =>
  kodi.split('-')[0].toLowerCase() === (s.language ?? '').split('-')[0].toLowerCase();

function only<T extends { index: number }>(matches: T[]): number | undefined {
  return matches.length === 1 ? matches[0].index : undefined;
}

/** Match an embedded subtitle to exactly one Kodi track. Kodi reports the
 * stream title as its name and does not report the codec. */
export function kodiSubtitle(track: Track<SubtitleStream>, kodi: SubtitleTrack[]): number | undefined {
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
