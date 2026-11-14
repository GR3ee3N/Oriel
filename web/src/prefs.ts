// Persist Settings screen preferences in the add-on's store.

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Sort } from './media/model';
import { type LibraryState, type Saved, save } from './store';

interface Prefs {
  /** Local and remote bitrate limits in kbps; 0 requests the original file
   * (player/quality.ts). */
  qualityLocal: number;
  qualityRemote: number;
  /** Reuse the last Plex Home profile at startup without asking for its PIN
   * (session.ts). */
  autoSignIn: boolean;
  /** Skip intros after the countdown unless dismissed (player/playback.ts). */
  autoSkipIntro: boolean;
  /** Skip credits automatically, including credits followed by another scene. */
  autoSkipCredits: boolean;
  /** ACCENTS id used for focus rings and highlights. */
  accent: string;
  /** Drop zoom and slides from focus movement (theme.css). */
  reduceMotion: boolean;
}

/** Colours for --accent in theme.css, chosen for contrast with --accent-text.
 * The first entry is the default. */
export const ACCENTS = [
  { id: 'periwinkle', label: 'Periwinkle', color: '#8c9eff' },
  { id: 'sky', label: 'Sky', color: '#6ec6ff' },
  { id: 'teal', label: 'Teal', color: '#4fd1c5' },
  { id: 'green', label: 'Green', color: '#8bd17c' },
  { id: 'amber', label: 'Amber', color: '#f5b841' },
  { id: 'coral', label: 'Coral', color: '#ff8a73' },
  { id: 'pink', label: 'Pink', color: '#ff8fc6' },
  { id: 'violet', label: 'Violet', color: '#b69cff' },
];

export function accent(id: string) {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

function applyAccent(id: string): void {
  document.documentElement.style.setProperty('--accent', accent(id).color);
}

const DEFAULTS: Prefs = {
  qualityLocal: 0,
  qualityRemote: 0,
  autoSignIn: false,
  autoSkipIntro: false,
  autoSkipCredits: false,
  accent: ACCENTS[0].id,
  reduceMotion: false,
};

const [prefs, setPrefs] = createStore<Prefs>({ ...DEFAULTS });
export { prefs };

export function loadPrefs(saved: Saved): void {
  const stored = Object.entries(saved).filter(([key, value]) => key in DEFAULTS && value != null);
  setPrefs({ ...DEFAULTS, ...(Object.fromEntries(stored) as Partial<Prefs>) });
  applyAccent(prefs.accent);
  applyMotion(prefs.reduceMotion);
  libraries = Object.fromEntries(Object.entries(saved.libraries ?? {}).map(([key, state]) => [key, currentLibrary(state)]));
  spoilers = saved.hideUnwatched ?? {};
}

let libraries: Record<string, LibraryState> = {};

const LIBRARY_DEFAULT: LibraryState = { view: 'library', sort: 'title', unwatched: false, filters: {} };

// Oriel 0.4 saved library sorts and filter fields under Plex's names.
const PLEX_SORTS: Record<string, Sort> = {
  titleSort: 'title',
  'addedAt:desc': 'added',
  'originallyAvailableAt:desc': 'released',
  'audienceRating:desc': 'rating',
  'lastViewedAt:desc': 'watched',
  'duration:desc': 'duration',
};
const SORTS = new Set<string>(Object.values(PLEX_SORTS));

function currentLibrary(saved: LibraryState): LibraryState {
  const sort = PLEX_SORTS[saved.sort] ?? (SORTS.has(saved.sort) ? saved.sort : 'title');
  const filters: LibraryState['filters'] = {};
  for (const [field, value] of Object.entries(saved.filters ?? {}) as [string, string][]) {
    if (field === 'decade') filters.year = value;
    else if (field === 'hdr') filters.hdr = 'on';
    else filters[field as keyof LibraryState['filters']] = value;
  }
  return { ...saved, sort, filters };
}

/** Saved view, sort and filters for a library; `key` is profile/server/section. */
export function libraryState(key: string): LibraryState {
  return { ...LIBRARY_DEFAULT, ...libraries[key] };
}

export function saveLibraryState(key: string, state: LibraryState): void {
  libraries = { ...libraries, [key]: state };
  save({ libraries }).catch((e) => console.error(`prefs: ${e}`));
}

let spoilers: Record<string, boolean> = {};
const [spoilerVersion, setSpoilerVersion] = createSignal(0);

/** Hide unwatched episode titles and summaries and blur their stills for this profile. Off by default. */
export function hidesUnwatched(profile: string | undefined): boolean {
  spoilerVersion();
  return !!profile && !!spoilers[profile];
}

export function setHidesUnwatched(profile: string, on: boolean): void {
  spoilers = { ...spoilers, [profile]: on };
  setSpoilerVersion((v) => v + 1);
  save({ hideUnwatched: spoilers }).catch((e) => console.error(`prefs: ${e}`));
}

function applyMotion(reduced: boolean): void {
  if (reduced) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  setPrefs(key, value);
  save({ [key]: value }).catch((e) => console.error(`prefs: ${e}`));
  if (key === 'accent') applyAccent(value as string);
  if (key === 'reduceMotion') applyMotion(value as boolean);
}
