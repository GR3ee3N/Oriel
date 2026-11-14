interface ImportMetaEnv {
  /** Add-on version injected by vite.config.ts from build/versions.env. */
  readonly VITE_APP_VERSION: string;
  /** The app this build is; see app.ts. */
  readonly VITE_SERVER: 'plex' | 'jellyfin';
}
