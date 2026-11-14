// A Jellyfin server as a Provider, for its signed-in user. Rows reuse Plex's
// hub ids where they mean the same thing, so they share their titles.

import { ageRating as ratingLabel } from '../media/format';
import { t } from '../i18n';
import type { Choice, Item, Library, Marker, Page, Paged, Row, Sort, TitleQuery } from '../media/model';
import type { Provider } from '../media/provider';
import { DETAIL, get, imageUrl, invalidate, LIST } from './api';
import { authorization, type Server } from './client';
import { ageRating, item } from './convert';
import { applyChoices, jellyfinPlayback } from './playback';
import type { BaseItem, Items } from './types';

interface View {
  Id: string;
  Name: string;
  CollectionType?: string;
}

const KINDS: Record<string, Library['kind']> = { movies: 'movie', tvshows: 'show' };

const SORTS: Record<Sort, { SortBy: string; SortOrder: 'Ascending' | 'Descending' }> = {
  title: { SortBy: 'SortName', SortOrder: 'Ascending' },
  added: { SortBy: 'DateCreated,SortName', SortOrder: 'Descending' },
  released: { SortBy: 'PremiereDate,ProductionYear,SortName', SortOrder: 'Descending' },
  rating: { SortBy: 'CommunityRating,SortName', SortOrder: 'Descending' },
  watched: { SortBy: 'DatePlayed,SortName', SortOrder: 'Descending' },
  duration: { SortBy: 'Runtime,SortName', SortOrder: 'Descending' },
};

/** Jellyfin tells HD from SD by the picture's size, so resolution has three values. */
const RESOLUTIONS: Choice[] = [
  { key: '4k', title: '4K' },
  { key: 'hd', title: 'HD' },
  { key: 'sd', title: 'SD' },
];

/** A decade's years, which Jellyfin filters by: '1990' is 1990–1999. */
const decade = (start: string) => Array.from({ length: 10 }, (_, i) => Number(start) + i).join(',');

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** Media segments that mean an intro or credits; Jellyfin's Outro is the credits. */
const SEGMENTS: Record<string, Marker['kind']> = { Intro: 'intro', Outro: 'credits' };

/** One kind, or 'mixed', as rows name what they hold. */
const typeOf = (items: Item[]) => (items.length && items.every((i) => i.kind === items[0].kind) ? items[0].kind : 'mixed');
const row = (id: string, title: string, items: Item[]): Row => ({ id, title, type: typeOf(items), items });

/** A page of a listing. Jellyfin reads Limit=0 as no limit, so a count asks
 * for one item. */
const paging = (page?: Page) => (page ? { StartIndex: page.start, Limit: Math.max(1, page.size) } : {});
const paged = (r: Items, page?: Page, library?: string): Paged<Item> => ({
  total: r.TotalRecordCount ?? r.Items.length,
  items: (page?.size === 0 ? [] : r.Items).map((i) => item(i, library)),
});

export function jellyfinProvider(server: Server): Provider {
  const list = (path: string, params: Record<string, string | number | boolean | undefined> = {}) =>
    get<Items>(server, path, { Fields: LIST, ...params });
  const details = (id: string) => get<BaseItem>(server, `/Items/${id}`, { Fields: DETAIL });
  const views = async (): Promise<Library[]> => {
    const r = await get<{ Items: View[] }>(server, '/UserViews');
    return r.Items.flatMap((v) => (v.CollectionType && KINDS[v.CollectionType] ? [{ id: v.Id, title: v.Name, kind: KINDS[v.CollectionType] }] : []));
  };
  const latest = async (library: string) => (await get<BaseItem[]>(server, '/Items/Latest', { ParentId: library, Limit: 24, Fields: LIST })).map((i) => item(i, library));
  const resume = async (library?: string) => (await list('/UserItems/Resume', { ParentId: library, Limit: 24, MediaTypes: 'Video' })).Items.map((i) => item(i, library));
  const nextUp = async (library?: string) =>
    (await list('/Shows/NextUp', { ParentId: library, Limit: 24, EnableResumable: false })).Items.map((i) => item(i, library));
  /** What a library listing asks for; no library means the whole server,
   * as a person's titles do. */
  const query = async (library: string, q: TitleQuery) => {
    const kind = library ? (await views()).find((l) => l.id === library)?.kind : undefined;
    const f = q.filters;
    return {
      ParentId: q.collection ?? (library || undefined),
      Recursive: true,
      IncludeItemTypes: kind === 'show' ? 'Series' : kind === 'movie' ? 'Movie' : 'Movie,Series',
      ...SORTS[q.sort],
      Filters: q.unwatched ? 'IsUnplayed' : undefined,
      Genres: f.genre,
      Years: f.year ? decade(f.year) : undefined,
      OfficialRatings: f.contentRating,
      Is4K: f.resolution === '4k' ? true : undefined,
      IsHD: f.resolution === 'hd' ? true : f.resolution === 'sd' ? false : undefined,
      PersonIds: q.person,
    };
  };
  /** Intro and credits from the server's media segments; none when it has none. */
  const markers = async (id: string, duration = 0): Promise<Marker[]> => {
    const r = await get<{ Items: { Type: string; StartTicks: number; EndTicks: number }[] }>(server, `/MediaSegments/${id}`).catch(() => ({ Items: [] }));
    return r.Items.flatMap((s) => {
      const kind = SEGMENTS[s.Type];
      if (!kind) return [];
      const start = Math.round(s.StartTicks / 10_000);
      const end = Math.round(s.EndTicks / 10_000);
      return [{ kind, start, end, final: kind === 'credits' && duration > 0 && end >= duration - 5000 }];
    });
  };
  const count = async (params: Record<string, string | number | boolean | undefined>) =>
    (await list('/Items', { ...params, Limit: 1, Fields: undefined })).TotalRecordCount ?? 0;

  return {
    server: { id: server.id, name: server.name, local: server.local, address: server.address },
    mediaSource: () => ({ base: server.address, headers: { Authorization: authorization(server.token) } }),
    // Box sets span the server, Jellyfin has no HDR filter, and track choices
    // stay on this box.
    features: { collectionsPerLibrary: false, hdrFilter: false, savedTracks: false },
    libraries: views,
    invalidate,
    home: async () => {
      const libraries = await views();
      const rows = await Promise.all([
        resume().then((items) => row('home.continue', t('hub.home.continue'), items)),
        nextUp().then((items) => row('home.ondeck', t('hub.home.ondeck'), items)),
        ...libraries.map(async (l) => row(`latest.${l.id}`, t('rows.latestIn', { library: l.title }), await latest(l.id))),
      ]);
      return rows.filter((r) => r.items.length);
    },
    libraryRows: async (library) => {
      const shows = (await views()).find((l) => l.id === library)?.kind === 'show';
      const top = list('/Items', {
        ParentId: library,
        Recursive: true,
        IncludeItemTypes: shows ? 'Series' : 'Movie',
        Filters: 'IsUnplayed',
        SortBy: 'CommunityRating',
        SortOrder: 'Descending',
        Limit: 24,
      });
      const rows = await Promise.all([
        shows
          ? nextUp(library).then((items) => row('home.ondeck', t('hub.home.ondeck'), items))
          : resume(library).then((items) => row('inprogress', t('hub.inprogress'), items)),
        latest(library).then((items) => row('recentlyadded', t('hub.recentlyadded'), items)),
        top.then((r) => row('topunwatched', t('hub.topunwatched'), r.Items.map((i) => item(i, library)))),
      ]);
      return rows.filter((r) => r.items.length);
    },
    titles: async (library, q, page) => paged(await list('/Items', { ...(await query(library, q)), ...paging(page) }), page, library || undefined),
    filterValues: async (library, field) => {
      if (field === 'resolution') return RESOLUTIONS;
      const { ParentId, IncludeItemTypes } = await query(library, { sort: 'title', unwatched: false, filters: {} });
      const v = await get<{ Genres?: string[]; Years?: number[]; OfficialRatings?: string[] }>(server, '/Items/Filters', { ParentId, IncludeItemTypes });
      if (field === 'genre') return (v.Genres ?? []).map((g) => ({ key: g, title: g }));
      // Jellyfin sorts ratings as text, so "FSK-6" would follow "FSK-18".
      if (field === 'contentRating')
        return (v.OfficialRatings ?? []).map((r) => ({ key: r, title: ratingLabel(ageRating(r)) })).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      const decades = [...new Set((v.Years ?? []).map((y) => String(Math.floor(y / 10) * 10)))].sort().reverse();
      return decades.map((d) => ({ key: d, title: `${d}s` }));
    },
    // Jellyfin has no count per first letter, so each one is counted: titles
    // sorting before A, then each letter.
    letters: async (library, q) => {
      const base = await query(library, { ...q, sort: 'title' });
      const sizes = await Promise.all([count({ ...base, NameLessThan: 'A' }), ...LETTERS.map((l) => count({ ...base, NameStartsWith: l }))]);
      return ['#', ...LETTERS].map((key, i) => ({ key, size: sizes[i] })).filter((l) => l.size > 0);
    },
    collections: async (library, page) => paged(await list('/Items', { IncludeItemTypes: 'BoxSet', Recursive: true, SortBy: 'SortName', ...paging(page) }), page, library),
    collection: async (id, page) => paged(await list('/Items', { ParentId: id, SortBy: 'PremiereDate,SortName', ...paging(page) }), page),
    playlists: async (page) => paged(await list('/Items', { IncludeItemTypes: 'Playlist', Recursive: true, MediaTypes: 'Video', SortBy: 'SortName', ...paging(page) }), page),
    playlist: async (id, page) => paged(await list(`/Playlists/${id}/Items`, paging(page)), page),
    item: async (id) => {
      const j = await details(id).catch(() => undefined);
      if (!j) return undefined;
      const out = applyChoices(item(j));
      if (out.kind === 'movie' || out.kind === 'episode') {
        const found = await markers(id, out.duration);
        if (found.length) out.markers = found;
      }
      if (out.kind === 'show') {
        const next = (await list('/Shows/NextUp', { SeriesId: id, Limit: 1 }).catch(() => undefined))?.Items[0];
        if (next) out.next = item(next);
      }
      return out;
    },
    children: async (id) => {
      const parent = await details(id);
      if (parent.Type === 'Series') return (await list(`/Shows/${id}/Seasons`)).Items.map((i) => item(i));
      if (parent.Type === 'Season' && parent.SeriesId) return (await list(`/Shows/${parent.SeriesId}/Episodes`, { SeasonId: id })).Items.map((i) => item(i));
      return (await list('/Items', { ParentId: id })).Items.map((i) => item(i));
    },
    related: async (id) => {
      const r = await list(`/Items/${id}/Similar`, { Limit: 24 });
      return r.Items.length ? [row('similar', t('hub.similar'), r.Items.map((i) => item(i)))] : [];
    },
    search: async (text) => {
      const r = await list('/Items', { searchTerm: text, Recursive: true, IncludeItemTypes: 'Movie,Series,Episode,BoxSet', Limit: 60 });
      const groups = new Map<string, Item[]>();
      for (const i of r.Items.map((x) => item(x))) groups.set(i.kind, [...(groups.get(i.kind) ?? []), i]);
      return [...groups].map(([kind, items]) => row(`search.${kind}`, kind, items));
    },
    setWatched: async (id, watched) => {
      await server.send(watched ? 'POST' : 'DELETE', `/UserPlayedItems/${id}`, undefined, { userId: server.userId });
      invalidate();
    },
    image: (ref, w, h, o) => imageUrl(server, ref, w, h, o),
    playback: jellyfinPlayback(server),
  };
}
