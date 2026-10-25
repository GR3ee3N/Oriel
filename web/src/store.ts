// Persist app settings through @oriel/web's add-on store.

import { load as loadStore, save as saveStore } from '@oriel/web';

export interface Saved {
  clientId?: string;
  /** Account token used to switch Plex Home profiles. */
  accountToken?: string;
  userUuid?: string;
  userToken?: string;
  /** Add-on run id in which the profile was selected. */
  userRun?: string;
  /** Last selected server for each user UUID. */
  servers?: Record<string, string>;
  /** Persisted preferences from prefs.ts. */
  qualityLocal?: number;
  qualityRemote?: number;
  autoSignIn?: boolean;
  autoSkipIntro?: boolean;
  autoSkipCredits?: boolean;
  /** Accent colour id from prefs.ts. */
  accent?: string;
  reduceMotion?: boolean;
  /** Spoiler protection by profile UUID (prefs.ts). */
  hideUnwatched?: Record<string, boolean>;
  /** Library view, sort and filters by `profile/server/section`. */
  libraries?: Record<string, LibraryState>;
  /** Oriel has offered the optional fonts (fonts.ts). */
  fontsAsked?: boolean;
}

export interface LibraryState {
  view: 'recommended' | 'library' | 'collections';
  sort: string;
  unwatched: boolean;
  filters: Record<string, string>;
}

export const load = () => loadStore<Saved>();
export const save = (changes: { [K in keyof Saved]?: Saved[K] | null }) => saveStore<Saved>(changes);
