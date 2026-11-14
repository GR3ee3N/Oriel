// Which app this build is: Oriel for Plex Media Server, or Dormer for
// Jellyfin. `VITE_SERVER` picks it when Vite runs; Plex when unset.

export const SERVER: 'plex' | 'jellyfin' = import.meta.env.VITE_SERVER;

/** The app's name, as the splash, Settings and servers see it. */
export const PRODUCT = SERVER === 'jellyfin' ? 'Dormer' : 'Oriel';
export const VERSION: string = import.meta.env.VITE_APP_VERSION;
