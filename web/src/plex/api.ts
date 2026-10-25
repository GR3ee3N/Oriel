// Typed Plex endpoints. Keep X-Plex-Container-Start/Size in the query string
// to avoid CORS preflights, as with client identity in client.ts.

import type { Server } from './client';
import type { Directory, Hub, MediaContainer, Metadata } from './types';

export interface Page {
  start: number;
  size: number;
}

// Cache browse responses for one minute to reuse them on return navigation.
// Invalidate after playback changes watched state or progress.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_AGE = 60_000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < MAX_AGE) return hit.value as Promise<T>;
  // Deleting expired entries before reinsertion keeps the map in age order.
  for (const [k, entry] of cache) {
    if (now - entry.at < MAX_AGE) break;
    cache.delete(k);
  }
  const value = load();
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Clear browse responses after changes such as playback or watched-state updates. */
export function invalidate(): void {
  cache.clear();
}

const paging = (page?: Page) =>
  page ? { 'X-Plex-Container-Start': page.start, 'X-Plex-Container-Size': page.size } : {};
// Key pages by start and size, so a size-0 count request never stands in
// for the first page.
const pageKey = (page?: Page) => (page ? `${page.start}+${page.size}` : 'all');

/** Include only movie and show libraries. */
export async function sections(server: Server): Promise<Directory[]> {
  const mc = await cached(`${server.id}/sections`, () => server.get('/library/sections'));
  return (mc.Directory ?? []).filter((d) => d.type === 'movie' || d.type === 'show');
}

/** Number of video playlists for the current profile. */
export async function playlistCount(server: Server): Promise<number> {
  const mc = await server.get('/playlists', { playlistType: 'video', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 });
  return mc.totalSize ?? mc.size ?? 0;
}

/** Home hubs such as Continue Watching and Recently Added. */
export async function homeHubs(server: Server): Promise<Hub[]> {
  const mc = await cached(`${server.id}/hubs`, () => server.get('/hubs', { count: 24, includeEmpty: 0, includeImages: 1 }));
  return mc.Hub ?? [];
}

export interface SectionQuery {
  /** Plex sort expression, e.g. 'titleSort' or 'addedAt:desc'. */
  sort?: string;
  unwatched?: boolean;
  /** One Plex filter expressed as 'field=value', e.g. 'actor=123'. */
  filter?: string;
  /** Library filters by field, e.g. { genre: '189', decade: '1990', hdr: '1' }. */
  filters?: Record<string, string>;
}

export function sectionItems(server: Server, section: string, query: SectionQuery = {}, page?: Page): Promise<MediaContainer> {
  const [field, value] = query.filter?.split('=') ?? [];
  const params = {
    sort: query.sort,
    unwatched: query.unwatched ? 1 : undefined,
    ...(field ? { [field]: value } : {}),
    ...query.filters,
    ...paging(page),
  };
  return cached(`${server.id}/all/${section}/${JSON.stringify(params)}`, () =>
    server.get(`/library/sections/${section}/all`, params),
  );
}

export interface Details extends Metadata {
  /** Next episode supplied by includeOnDeck. */
  OnDeck?: { Metadata?: Metadata[] };
}

/** Item metadata including media versions, parts, streams, markers and images. */
export async function metadata(server: Server, ratingKey: string): Promise<Details | undefined> {
  const mc = await cached(`${server.id}/meta/${ratingKey}`, () =>
    server.get<Details>(`/library/metadata/${ratingKey}`, {
      includeMarkers: 1,
      includeOnDeck: 1,
      includeImages: 1,
      includeExtras: 1,
    }),
  );
  return mc.Metadata?.[0];
}

/** Nonempty recommendation hubs for an item. */
export async function related(server: Server, ratingKey: string): Promise<Hub[]> {
  const mc = await cached(`${server.id}/related/${ratingKey}`, () =>
    server.get(`/library/metadata/${ratingKey}/related`, { count: 20 }),
  );
  return (mc.Hub ?? []).filter((h) => h.Metadata?.length);
}

/** Values for a library filter field such as 'genre' or 'decade', in the
 * server's order. Keys are decoded, e.g. 'de/12' rather than 'de%2F12'. */
export async function filterValues(server: Server, section: string, field: string): Promise<{ key: string; title: string }[]> {
  const mc = await cached(`${server.id}/values/${section}/${field}`, () => server.get(`/library/sections/${section}/${field}`));
  return (mc.Directory ?? []).map((d) => ({ key: decodeURIComponent(d.key), title: d.title }));
}

/** Recommendation hubs for one library, such as Recently Added and Top Unwatched. */
export async function sectionHubs(server: Server, section: string): Promise<Hub[]> {
  const mc = await cached(`${server.id}/hubs/${section}`, () =>
    server.get(`/hubs/sections/${section}`, { count: 20, includeImages: 1 }),
  );
  return (mc.Hub ?? []).filter((h) => h.Metadata?.length);
}

/** Paginated collections of a library, in the server's order. */
export function sectionCollections(server: Server, section: string, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/collections/${section}/${pageKey(page)}`, () =>
    server.get(`/library/sections/${section}/collections`, paging(page)),
  );
}

/** The profile's video playlists. */
export function playlists(server: Server, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/playlists/${pageKey(page)}`, () => server.get('/playlists', { playlistType: 'video', ...paging(page) }));
}

/** Paginated playlist items in playlist order. */
export function playlistItems(server: Server, ratingKey: string, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/playlist/${ratingKey}/${pageKey(page)}`, () => server.get(`/playlists/${ratingKey}/items`, paging(page)));
}

/** Paginated collection items. */
export function collectionItems(server: Server, ratingKey: string, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/collection/${ratingKey}/${pageKey(page)}`, () =>
    server.get(`/library/collections/${ratingKey}/children`, paging(page)),
  );
}

/** Child items: seasons for a show, episodes for a season. */
export async function children(server: Server, ratingKey: string): Promise<Metadata[]> {
  const mc = await cached(`${server.id}/children/${ratingKey}`, () => server.get(`/library/metadata/${ratingKey}/children`));
  return mc.Metadata ?? [];
}

/** Counts by initial character for navigation through a title-sorted library. */
export async function firstCharacters(
  server: Server,
  section: string,
  unwatched: boolean,
  filters: Record<string, string> = {},
): Promise<{ key: string; size: number }[]> {
  const mc = await cached(`${server.id}/first/${section}/${unwatched}/${JSON.stringify(filters)}`, () =>
    server.get<never>(`/library/sections/${section}/firstCharacter`, { unwatched: unwatched ? 1 : undefined, ...filters }),
  );
  // Use the literal title; Plex URL-encodes the key, e.g. '%23' for '#'.
  return (mc.Directory ?? []).map((d) => ({ key: d.title, size: (d as unknown as { size: number }).size }));
}

/** Set watched state for a movie, episode, show or season and clear browse caches. */
export async function setWatched(server: Server, ratingKey: string, watched: boolean): Promise<void> {
  await server.call(watched ? '/:/scrobble' : '/:/unscrobble', { key: ratingKey, identifier: 'com.plexapp.plugins.library' });
  invalidate();
}

export async function search(server: Server, query: string): Promise<Hub[]> {
  const mc = await server.get('/hubs/search', { query, limit: 20, includeCollections: 1 });
  return (mc.Hub ?? []).filter((h) => h.size > 0 && ['movie', 'show', 'episode', 'collection'].includes(h.type));
}
