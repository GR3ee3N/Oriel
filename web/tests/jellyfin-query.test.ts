import { expect, test, vi } from 'vitest';
import type { Server } from '../src/jellyfin/client';

const { jellyfinProvider } = await import('../src/jellyfin/provider');

type Params = Record<string, unknown>;

function server(answer: (path: string, params: Params) => unknown) {
  const get = vi.fn(async (path: string, params: Params) => answer(path, params));
  const views = { Items: [{ Id: 'films', Name: 'Filme', CollectionType: 'movies' }] };
  const s = { id: `query-${Math.random()}`, userId: 'u', address: 'https://jf', get: async (p: string, q: Params) => (p === '/UserViews' ? views : get(p, q)) };
  return { get, provider: jellyfinProvider(s as unknown as Server) };
}

test('a library listing asks Jellyfin for its sort, filters and page', async () => {
  const { get, provider } = server(() => ({ Items: [], TotalRecordCount: 0 }));
  await provider.titles('films', { sort: 'released', unwatched: true, filters: { year: '1990', resolution: 'sd', genre: 'Drama', contentRating: 'FSK-12' } }, { start: 50, size: 50 });
  expect(get).toHaveBeenCalledWith('/Items', expect.objectContaining({
    ParentId: 'films',
    Recursive: true,
    IncludeItemTypes: 'Movie',
    SortBy: 'PremiereDate,ProductionYear,SortName',
    SortOrder: 'Descending',
    Filters: 'IsUnplayed',
    Genres: 'Drama',
    Years: '1990,1991,1992,1993,1994,1995,1996,1997,1998,1999',
    OfficialRatings: 'FSK-12',
    IsHD: false,
    StartIndex: 50,
    Limit: 50,
  }));
});

test('a person’s titles span the whole server, and a count asks for one item', async () => {
  const { get, provider } = server(() => ({ Items: [{ Id: 'm', Name: 'M', Type: 'Movie' }], TotalRecordCount: 7 }));
  const page = await provider.titles('', { sort: 'released', unwatched: false, filters: {}, person: 'p1' }, { start: 0, size: 0 });
  expect(page).toEqual({ total: 7, items: [] });
  const [, params] = get.mock.calls[0];
  expect(params).toMatchObject({ IncludeItemTypes: 'Movie,Series', PersonIds: 'p1', Limit: 1 });
  expect(params).not.toHaveProperty('ParentId', expect.anything());
});

test('letters count titles before A and under each letter, leaving out empty ones', async () => {
  const { provider } = server((_, p) => ({ Items: [], TotalRecordCount: p.NameLessThan === 'A' ? 2 : p.NameStartsWith === 'B' ? 5 : 0 }));
  expect(await provider.letters('films', { sort: 'title', unwatched: false, filters: {} })).toEqual([
    { key: '#', size: 2 },
    { key: 'B', size: 5 },
  ]);
});

test('filter values: decades from years, readable age ratings, fixed resolutions', async () => {
  const { provider } = server(() => ({ Genres: ['Drama'], Years: [1994, 1999, 2003], OfficialRatings: ['FSK-12', 'PG-13'] }));
  expect(await provider.filterValues('films', 'year')).toEqual([
    { key: '2000', title: '2000s' },
    { key: '1990', title: '1990s' },
  ]);
  expect(await provider.filterValues('films', 'contentRating')).toEqual([
    { key: 'FSK-12', title: 'FSK 12' },
    { key: 'PG-13', title: 'PG-13' },
  ]);
  expect((await provider.filterValues('films', 'resolution')).map((c) => c.key)).toEqual(['4k', 'hd', 'sd']);
});

test('media segments mark the intro and credits; credits at the end are final', async () => {
  const { provider } = server((path) =>
    path === '/MediaSegments/m'
      ? { Items: [{ Type: 'Intro', StartTicks: 2_200_000_000, EndTicks: 2_660_000_000 }, { Type: 'Outro', StartTicks: 55_000_000_000, EndTicks: 59_980_000_000 }, { Type: 'Recap', StartTicks: 0, EndTicks: 1 }] }
      : { Id: 'm', Name: 'M', Type: 'Movie', RunTimeTicks: 60_000_000_000 },
  );
  expect((await provider.item('m'))?.markers).toEqual([
    { kind: 'intro', start: 220_000, end: 266_000, final: false },
    { kind: 'credits', start: 5_500_000, end: 5_998_000, final: true },
  ]);
});
