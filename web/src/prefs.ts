// Persist Settings screen preferences in the add-on's store.

import { createStore } from 'solid-js/store';
import { type Saved, save } from './store';

export interface Prefs {
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
};

const [prefs, setPrefs] = createStore<Prefs>({ ...DEFAULTS });
export { prefs };

export function loadPrefs(saved: Saved): void {
  const stored = Object.entries(saved).filter(([key, value]) => key in DEFAULTS && value != null);
  setPrefs({ ...DEFAULTS, ...(Object.fromEntries(stored) as Partial<Prefs>) });
  applyAccent(prefs.accent);
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  setPrefs(key, value);
  save({ [key]: value }).catch((e) => console.error(`prefs: ${e}`));
  if (key === 'accent') applyAccent(value as string);
}
