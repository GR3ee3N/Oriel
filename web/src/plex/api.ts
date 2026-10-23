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

/** Include only movie and show libraries. */
export async function sections(server: Server): Promise<Directory[]> {
  const mc = await cached(`${server.id}/sections`, () => server.get('/library/sections'));
  return (mc.Directory ?? []).filter((d) => d.type === 'movie' || d.type === 'show');
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
}

export function sectionItems(server: Server, section: string, query: SectionQuery = {}, page?: Page): Promise<MediaContainer> {
  const [field, value] = query.filter?.split('=') ?? [];
  const params = {
    sort: query.sort,
    unwatched: query.unwatched ? 1 : undefined,
    ...(field ? { [field]: value } : {}),
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

/** Paginated collection items. */
export function collectionItems(server: Server, ratingKey: string, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/collection/${ratingKey}/${page?.start}`, () =>
    server.get(`/library/collections/${ratingKey}/children`, paging(page)),
  );
}

/** Child items: seasons for a show, episodes for a season. */
export async function children(server: Server, ratingKey: string): Promise<Metadata[]> {
  const mc = await cached(`${server.id}/children/${ratingKey}`, () => server.get(`/library/metadata/${ratingKey}/children`));
  return mc.Metadata ?? [];
}

/** Counts by initial character for navigation through a title-sorted library. */
export async function firstCharacters(server: Server, section: string, unwatched: boolean): Promise<{ key: string; size: number }[]> {
  const mc = await cached(`${server.id}/first/${section}/${unwatched}`, () =>
    server.get<never>(`/library/sections/${section}/firstCharacter`, { unwatched: unwatched ? 1 : undefined }),
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
