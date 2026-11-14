import { beforeEach, expect, test, vi } from 'vitest';
import type { Item } from '../src/media/model';
import type { Server } from '../src/plex/client';
import { plexProvider } from '../src/plex/provider';

const server = vi.hoisted(() => ({
  url: (path: string, params: Record<string, string | number>) => `http://plex${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
}));
vi.mock('../src/session', () => ({ session: { user: { id: 'test' } } }));
vi.mock('../src/media/servers', async () => {
  const { plexProvider } = await import('../src/plex/provider');
  const p = plexProvider(server as never);
  return { provider: () => p };
});
vi.mock('../src/prefs', () => ({ hidesUnwatched: () => true }));
vi.mock('../src/actions', () => ({ play: vi.fn() }));
vi.mock('../src/nav', () => ({ focusable: vi.fn() }));

import { tileImageUrl } from '../src/ui/components/Tile';
import { setRevealed } from '../src/spoilers';

beforeEach(() => setRevealed(undefined));

test('asks Plex to blur protected images and leaves other image requests clear', () => {
  const plex = plexProvider(server as Server);
  const clear = new URL(plex.image('/thumb', 400, 225));
  const blurred = new URL(plex.image('/thumb', 400, 225, { blur: true }));
  expect(clear.searchParams.has('blur')).toBe(false);
  expect(blurred.searchParams.get('blur')).toBe('16');
  expect(blurred.searchParams.get('url')).toBe('/thumb');
  expect(blurred.searchParams.get('width')).toBe('400');
  expect(blurred.searchParams.get('height')).toBe('225');
});

test('asks Plex for title logos as transparent PNGs that fit the size', () => {
  const logo = new URL(plexProvider(server as Server).image('/logo', 720, 240, { logo: true }));
  expect(logo.searchParams.get('format')).toBe('png');
  expect(logo.searchParams.has('upscale')).toBe(false);
});

test('blurs episode stills and poster fallbacks, keeping show posters and revealed episodes clear', () => {
  const episode: Item = { id: '1', kind: 'episode', title: 'A', art: { image: '/still', showImage: '/poster' } };
  const wide = new URL(tileImageUrl(episode, 'wide')!);
  expect(wide.searchParams.get('url')).toBe('/still');
  expect(wide.searchParams.get('blur')).toBe('16');
  const poster = new URL(tileImageUrl(episode, 'poster')!);
  expect(poster.searchParams.get('url')).toBe('/poster');
  expect(poster.searchParams.has('blur')).toBe(false);
  expect(new URL(tileImageUrl({ ...episode, art: { ...episode.art, showImage: undefined } }, 'poster')!).searchParams.get('blur')).toBe('16');
  expect(new URL(tileImageUrl({ ...episode, plays: 1 }, 'wide')!).searchParams.has('blur')).toBe(false);
  setRevealed(episode.id);
  expect(new URL(tileImageUrl(episode, 'wide')!).searchParams.has('blur')).toBe(false);
});
