// The server endpoints the UI uses, typed. Paging goes in the query string
// (X-Plex-Container-Start/Size) for the same no-preflight reason as the
// identity (client.ts).

import type { Server } from './client';
import type { Directory, Hub, MediaContainer, Metadata } from './types';

export interface Page {
  start: number;
  size: number;
}

// Browse data is reused for a minute, so going back to a tab or a page is
// instant. Playback state changes go through `invalidate`.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_AGE = 60_000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < MAX_AGE) return hit.value as Promise<T>;
  // Entries are in age order (an expired key is dropped here before it is
  // set again), so the expired ones are at the front.
  for (const [k, entry] of cache) {
    if (now - entry.at < MAX_AGE) break;
    cache.delete(k);
  }
  const value = load();
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Forget cached browse data, e.g. after playback changed watch state. */
export function invalidate(): void {
  cache.clear();
}

const paging = (page?: Page) =>
  page ? { 'X-Plex-Container-Start': page.start, 'X-Plex-Container-Size': page.size } : {};

/** Movie and show libraries; music and photo ones are out of scope. */
export async function sections(server: Server): Promise<Directory[]> {
  const mc = await cached(`${server.id}/sections`, () => server.get('/library/sections'));
  return (mc.Directory ?? []).filter((d) => d.type === 'movie' || d.type === 'show');
}

/** Home screen hubs (Continue Watching, Recently Added, …). */
export async function homeHubs(server: Server): Promise<Hub[]> {
  const mc = await cached(`${server.id}/hubs`, () => server.get('/hubs', { count: 24, includeEmpty: 0, includeImages: 1 }));
  return mc.Hub ?? [];
}

export interface SectionQuery {
  /** e.g. 'titleSort', 'addedAt:desc', 'year:desc'. */
  sort?: string;
  unwatched?: boolean;
  /** One field's value, as Plex writes it: 'actor=123'. */
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
  /** A show's next episode to watch (includeOnDeck). */
  OnDeck?: { Metadata?: Metadata[] };
}

/** Full metadata, with media, parts and streams. */
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

/** "More like this". */
export async function related(server: Server, ratingKey: string): Promise<Hub[]> {
  const mc = await cached(`${server.id}/related/${ratingKey}`, () =>
    server.get(`/library/metadata/${ratingKey}/related`, { count: 20 }),
  );
  return (mc.Hub ?? []).filter((h) => h.Metadata?.length);
}

/** A collection's items, a page at a time. */
export function collectionItems(server: Server, ratingKey: string, page?: Page): Promise<MediaContainer> {
  return cached(`${server.id}/collection/${ratingKey}/${page?.start}`, () =>
    server.get(`/library/collections/${ratingKey}/children`, paging(page)),
  );
}

/** Seasons of a show, episodes of a season. */
export async function children(server: Server, ratingKey: string): Promise<Metadata[]> {
  const mc = await cached(`${server.id}/children/${ratingKey}`, () => server.get(`/library/metadata/${ratingKey}/children`));
  return mc.Metadata ?? [];
}

/** Library items per first letter (sorted by title), for jumping. */
export async function firstCharacters(server: Server, section: string, unwatched: boolean): Promise<{ key: string; size: number }[]> {
  const mc = await cached(`${server.id}/first/${section}/${unwatched}`, () =>
    server.get<never>(`/library/sections/${section}/firstCharacter`, { unwatched: unwatched ? 1 : undefined }),
  );
  // The key is URL-encoded ('%23' for '#'); the title is the character.
  return (mc.Directory ?? []).map((d) => ({ key: d.title, size: (d as unknown as { size: number }).size }));
}

/** Marks an item (a movie, an episode, a whole show or season) watched or
 * not, as Plex's own apps do. */
export async function setWatched(server: Server, ratingKey: string, watched: boolean): Promise<void> {
  await server.call(watched ? '/:/scrobble' : '/:/unscrobble', { key: ratingKey, identifier: 'com.plexapp.plugins.library' });
  invalidate();
}

export async function search(server: Server, query: string): Promise<Hub[]> {
  const mc = await server.get('/hubs/search', { query, limit: 20, includeCollections: 1 });
  return (mc.Hub ?? []).filter((h) => h.size > 0 && ['movie', 'show', 'episode', 'collection'].includes(h.type));
}
