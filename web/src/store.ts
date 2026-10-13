// The app's saved settings, kept by the add-on (@oriel/web's store.ts).

import { type BaseSaved, load as loadStore, save as saveStore } from '@oriel/web';

export interface Saved extends BaseSaved {
  clientId?: string;
  /** The plex.tv account that signed in; switches between Home users. */
  accountToken?: string;
  userUuid?: string;
  userToken?: string;
  /** The add-on start (`run`) in which that user was chosen. */
  userRun?: string;
  /** The server each user chose last, by user uuid. */
  servers?: Record<string, string>;
  /** Settings (prefs.ts). */
  qualityLocal?: number;
  qualityRemote?: number;
  autoSignIn?: boolean;
  autoSkipIntro?: boolean;
  autoSkipCredits?: boolean;
  /** An ACCENTS id (prefs.ts). */
  accent?: string;
}

export const load = () => loadStore<Saved>();
export const save = (changes: { [K in keyof Saved]?: Saved[K] | null }) => saveStore<Saved>(changes);
