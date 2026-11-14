import { expect, test, vi } from 'vitest';
import type { Server } from '../src/plex/client';
import type { LibraryState } from '../src/store';

vi.mock('../src/store', () => ({ save: vi.fn(async () => {}) }));
vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() }, dataset: {} } });

const { libraryState, loadPrefs } = await import('../src/prefs');
const { invalidate } = await import('../src/plex/api');
const { plexProvider } = await import('../src/plex/provider');

test('library state saved with Plex sort strings and field names loads with neutral ids', () => {
  const plex = { view: 'library', sort: 'addedAt:desc', unwatched: true, filters: { decade: '1990', hdr: '1', genre: '5' } };
  const odd = { view: 'library', sort: 'year:desc', unwatched: false, filters: {} };
  const current: LibraryState = { view: 'collections', sort: 'rating', unwatched: false, filters: { year: '2000', hdr: 'on' } };
  loadPrefs({ libraries: { a: plex, b: odd, c: current } as unknown as Record<string, LibraryState> });
  expect(libraryState('a')).toEqual({ view: 'library', sort: 'added', unwatched: true, filters: { year: '1990', hdr: 'on', genre: '5' } });
  expect(libraryState('b').sort).toBe('title');
  expect(libraryState('c')).toEqual(current);
});

test('Plex gets its own sort and filter names, and content ratings get readable labels', async () => {
  invalidate();
  const get = vi.fn(async (path: string, _params?: Record<string, unknown>): Promise<unknown> =>
    path.endsWith('/contentRating') ? { Directory: [{ key: 'de%2F12', title: 'de/12' }, { key: 'PG-13', title: 'PG-13' }] } : { size: 0, totalSize: 0 },
  );
  const plex = plexProvider({ id: 'query-test', get } as unknown as Server);
  await plex.titles('3', { sort: 'released', unwatched: true, filters: { year: '1990', hdr: 'on' } }, { start: 0, size: 50 });
  expect(get).toHaveBeenCalledWith('/library/sections/3/all', {
    sort: 'originallyAvailableAt:desc',
    unwatched: 1,
    decade: '1990',
    hdr: '1',
    'X-Plex-Container-Start': 0,
    'X-Plex-Container-Size': 50,
  });
  expect(await plex.filterValues('3', 'contentRating')).toEqual([
    { key: 'de/12', title: 'FSK 12' },
    { key: 'PG-13', title: 'PG-13' },
  ]);
  await plex.titles('3', { sort: 'released', unwatched: false, filters: {}, person: '77' });
  expect(get).toHaveBeenLastCalledWith('/library/sections/3/all', { sort: 'originallyAvailableAt:desc', actor: '77' });
  await plex.titles('3', { sort: 'released', unwatched: false, filters: {}, collection: '88' });
  expect(get).toHaveBeenLastCalledWith('/library/sections/3/all', { sort: 'originallyAvailableAt:desc', collection: '88' });
});
