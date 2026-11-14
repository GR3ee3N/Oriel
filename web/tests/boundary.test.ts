// Screens, the player and the session reach a media server only through
// media/: each server's adapter folder is imported by media/servers.ts alone.

import { expect, test } from 'vitest';

const ADAPTERS = ['plex', 'jellyfin'];
const ALLOWED = ['media/servers.ts'];

/** Every source file's text, by its path under src/. */
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [
    path.slice('../src/'.length),
    text,
  ]),
);

/** Modules a file imports: static, side-effect, re-export and dynamic imports. */
function imports(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** `spec` imported from `file`, as a path under src/; undefined for packages. */
function resolve(file: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const parts = file.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** The adapter folder a path under src/ lies in, if any. */
const adapterOf = (path: string) => ADAPTERS.find((a) => path.split('/')[0] === a);

test('only media/servers.ts imports an adapter from outside the adapters', () => {
  expect(Object.keys(SOURCES)).toContain('media/servers.ts');
  const crossings: string[] = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    if (adapterOf(file) || ALLOWED.includes(file)) continue;
    for (const spec of imports(text)) {
      const target = resolve(file, spec);
      if (target && adapterOf(target)) crossings.push(`${file} imports ${spec}`);
    }
  }
  expect(crossings).toEqual([]);
});

test('the check sees every kind of import that crosses into an adapter', () => {
  const text = `import { a } from '../plex/api';\nimport type { B } from "./x";\nimport '../../jellyfin/style';\nconst c = await import('../jellyfin/c');`;
  expect(imports(text)).toEqual(['../plex/api', './x', '../../jellyfin/style', '../jellyfin/c']);
  expect(resolve('ui/screens/Home.tsx', '../../plex/api')).toBe('plex/api');
  expect(resolve('ui/screens/Home.tsx', './Row')).toBe('ui/screens/Row');
  expect(resolve('ui/screens/Home.tsx', 'solid-js')).toBeUndefined();
  expect(adapterOf('plex/api')).toBe('plex');
  expect(adapterOf('plexus/api')).toBeUndefined();
});
