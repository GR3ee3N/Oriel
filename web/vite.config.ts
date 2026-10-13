import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

const versions = readFileSync(new URL('../build/versions.env', import.meta.url), 'utf8');
const version = versions.match(/^VERSION=(.+)$/m)![1];

export default defineConfig({
  plugins: [solid()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  // The app and @oriel/web must share Solid's reactive runtime.
  resolve: { dedupe: ['solid-js'] },
  // WPE WebKit 2.52 on the box.
  build: { target: 'safari18', assetsInlineLimit: 0 },
  // WebKit on the box connects to this server over the LAN.
  server: { host: true, port: 5173, strictPort: true },
  test: { environment: 'node' },
});
