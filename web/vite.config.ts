import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

const versions = readFileSync(new URL('../build/versions.env', import.meta.url), 'utf8');
const version = versions.match(/^VERSION=(.+)$/m)![1];

export default defineConfig({
  plugins: [solid()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  // Share one Solid reactive runtime between the app and @oriel/web.
  resolve: { dedupe: ['solid-js'] },
  // Target the WPE WebKit 2.52 runtime.
  build: { target: 'safari18', assetsInlineLimit: 0 },
  // Accept LAN connections from WebKit on the box.
  server: { host: true, port: 5173, strictPort: true },
  test: { environment: 'node' },
});
