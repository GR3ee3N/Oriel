import { afterEach, expect, test, vi } from 'vitest';
import type { Server } from '../src/plex/client';
import type { Metadata } from '../src/plex/types';

const get = vi.fn(async (path: string): Promise<unknown> => {
  if (path === '/library/metadata/next') return { Metadata: [{ ratingKey: 'next', OnDeck: { Metadata: [{ parentRatingKey: 'season-2' }] } }] };
  if (path === '/library/metadata/next/children' || path === '/library/metadata/first/children')
    return { Metadata: [{ ratingKey: 'specials', index: 0 }, { ratingKey: 'season-1', index: 1 }] };
  if (path.startsWith('/library/metadata/')) return { Metadata: [{ ratingKey: path.split('/')[3] }] };
  return {};
});
const server = { id: 'prefetch-test', get } as unknown as Server;
vi.mock('../src/session', () => ({ currentServer: () => server }));
vi.mock('../src/router', () => ({ push: vi.fn() }));
vi.mock('../src/player/playback', () => ({ startPlayback: vi.fn(), startQueue: vi.fn() }));

const { prefetch } = await import('../src/actions');
const { invalidate } = await import('../src/plex/api');

afterEach(() => {
  invalidate();
  get.mockClear();
  vi.useRealTimers();
});

const show = (ratingKey: string) => ({ ratingKey, type: 'show' }) as Metadata;
const paths = () => get.mock.calls.map(([path]) => path);

test("a show settled on loads its details, its seasons and the next episode's season", async () => {
  vi.useFakeTimers();
  prefetch(show('next'));
  await vi.advanceTimersByTimeAsync(299);
  expect(get).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(paths()).toContain('/library/metadata/season-2/children'));
  expect(paths()).toEqual(['/library/metadata/next', '/library/metadata/next/children', '/library/metadata/season-2/children']);
});

test("a show with no next episode loads its first season that isn't Specials", async () => {
  vi.useFakeTimers();
  prefetch(show('first'));
  await vi.advanceTimersByTimeAsync(300);
  await vi.waitFor(() => expect(paths()).toContain('/library/metadata/season-1/children'));
});

test('an episode loads its show and its own season', async () => {
  vi.useFakeTimers();
  prefetch({ ratingKey: 'e', type: 'episode', grandparentRatingKey: 'first', parentRatingKey: 'season-3' } as Metadata);
  await vi.advanceTimersByTimeAsync(300);
  expect(paths()).toEqual(['/library/metadata/first', '/library/metadata/first/children', '/library/metadata/season-3/children']);
});

test('only the item focus settles on is loaded', async () => {
  vi.useFakeTimers();
  prefetch(show('passed'));
  await vi.advanceTimersByTimeAsync(100);
  prefetch({ ratingKey: 'movie', type: 'movie' } as Metadata);
  await vi.advanceTimersByTimeAsync(300);
  expect(paths()).toEqual(['/library/metadata/movie']);
});
