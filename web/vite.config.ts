import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

const versions = readFileSync(new URL('../build/versions.env', import.meta.url), 'utf8');
const version = versions.match(/^VERSION=(.+)$/m)![1];
// The app to build: Oriel for Plex, or Dormer for Jellyfin (src/app.ts).
const server = process.env.VITE_SERVER === 'jellyfin' ? 'jellyfin' : 'plex';

export default defineConfig({
  plugins: [solid()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version), 'import.meta.env.VITE_SERVER': JSON.stringify(server) },
  // Target the WPE WebKit 2.52 runtime.
  build: { target: 'safari18', assetsInlineLimit: 0 },
  // Accept LAN connections from WebKit on the box. Each app has its own
  // port, so both can run at once.
  server: { host: true, port: server === 'jellyfin' ? 5174 : 5173, strictPort: true },
  test: { environment: 'node' },
});
