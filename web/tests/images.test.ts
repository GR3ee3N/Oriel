import { beforeEach, expect, test, vi } from 'vitest';
import type { Server } from '../src/plex/client';
import type { Metadata } from '../src/plex/types';
import { imageUrl } from '../src/plex/images';

const server = vi.hoisted(() => ({
  url: (path: string, params: Record<string, string | number>) => `http://plex${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
}));
vi.mock('../src/session', () => ({ currentServer: () => server, session: { user: { uuid: 'test' } } }));
vi.mock('../src/prefs', () => ({ hidesUnwatched: () => true }));
vi.mock('../src/actions', () => ({ play: vi.fn() }));
vi.mock('../src/nav', () => ({ focusable: vi.fn() }));

import { tileImageUrl } from '../src/ui/components/Tile';
import { setRevealed } from '../src/ui/spoilers';

beforeEach(() => setRevealed(undefined));

test('asks Plex to blur protected images and leaves other image requests clear', () => {
  const clear = new URL(imageUrl(server as Server, '/thumb', 400, 225));
  const blurred = new URL(imageUrl(server as Server, '/thumb', 400, 225, true));
  expect(clear.searchParams.has('blur')).toBe(false);
  expect(blurred.searchParams.get('blur')).toBe('16');
  expect(blurred.searchParams.get('url')).toBe('/thumb');
  expect(blurred.searchParams.get('width')).toBe('400');
  expect(blurred.searchParams.get('height')).toBe('225');
});

test('blurs episode stills and poster fallbacks, keeping show posters and revealed episodes clear', () => {
  const episode = { ratingKey: '1', type: 'episode', thumb: '/still', grandparentThumb: '/poster' } as Metadata;
  const wide = new URL(tileImageUrl(episode, 'wide')!);
  expect(wide.searchParams.get('url')).toBe('/still');
  expect(wide.searchParams.get('blur')).toBe('16');
  const poster = new URL(tileImageUrl(episode, 'poster')!);
  expect(poster.searchParams.get('url')).toBe('/poster');
  expect(poster.searchParams.has('blur')).toBe(false);
  expect(new URL(tileImageUrl({ ...episode, grandparentThumb: undefined }, 'poster')!).searchParams.get('blur')).toBe('16');
  expect(new URL(tileImageUrl({ ...episode, viewCount: 1 }, 'wide')!).searchParams.has('blur')).toBe(false);
  setRevealed(episode.ratingKey);
  expect(new URL(tileImageUrl(episode, 'wide')!).searchParams.has('blur')).toBe(false);
});
