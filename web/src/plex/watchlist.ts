// The profile's Plex Watchlist on plex.tv. Items are plex.tv metadata; a
// copy in the current server's libraries is found by guid.

import { createSignal } from 'solid-js';
import { profileToken } from '../session';
import { request, type Server } from './client';
import type { MediaContainer, Metadata } from './types';

const DISCOVER = 'https://discover.provider.plex.tv';
const MAX_AGE = 60_000;
// plex.tv refuses pages larger than 100.
const PAGE = 100;

let cached: { at: number; items: Promise<Metadata[]> } | undefined;
const [version, setVersion] = createSignal(0);

/** Read in a resource source to reload it when the Watchlist changes. */
export const watchlistVersion = version;

/** Watchlist items, most recently added first. */
export function watchlist(): Promise<Metadata[]> {
  if (cached && Date.now() - cached.at < MAX_AGE) return cached.items;
  const token = profileToken();
  const page = (start: number) =>
    request<{ MediaContainer: MediaContainer }>(`${DISCOVER}/library/sections/watchlist/all`, {
      token,
      params: { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': PAGE, sort: 'watchlistedAt:desc' },
    }).then((body) => body.MediaContainer);
  const items = (async () => {
    const all: Metadata[] = [];
    for (let start = 0; ; start += PAGE) {
      const mc = await page(start);
      all.push(...(mc.Metadata ?? []));
      if (!mc.Metadata?.length || all.length >= (mc.totalSize ?? 0)) return all;
    }
  })();
  cached = { at: Date.now(), items };
  items.catch(() => (cached = undefined));
  return items;
}

/** plex.tv's key for an item is the last part of its guid. */
const discoverKey = (guid: string) => guid.split('/').pop()!;

export async function isWatchlisted(guid: string | undefined): Promise<boolean> {
  if (!guid?.startsWith('plex://')) return false;
  return (await watchlist()).some((m) => m.guid === guid);
}

/** Add or remove a title; throws when plex.tv refuses. */
export async function setWatchlisted(guid: string, on: boolean): Promise<void> {
  await request(`${DISCOVER}/actions/${on ? 'addToWatchlist' : 'removeFromWatchlist'}`, {
    method: 'PUT',
    token: profileToken(),
    params: { ratingKey: discoverKey(guid) },
  });
  cached = undefined;
  setVersion((v) => v + 1);
}

// Guids per lookup; the server accepts a comma-separated list.
const BATCH = 50;

/** The server's copies of Watchlist items by guid; titles no library has
 * are missing from the map. */
export async function localCopies(server: Server, guids: string[]): Promise<Map<string, Metadata>> {
  const found = new Map<string, Metadata>();
  const batches = [];
  for (let i = 0; i < guids.length; i += BATCH) batches.push(guids.slice(i, i + BATCH));
  await Promise.all(
    batches.map(async (batch) => {
      const mc = await server.get<Metadata>('/library/all', { guid: batch.join(',') });
      for (const m of mc.Metadata ?? []) if (m.guid) found.set(m.guid, m);
    }),
  );
  return found;
}

/** plex.tv's full metadata for a title the server doesn't have. */
export async function discoverMetadata(guid: string): Promise<Metadata | undefined> {
  const body = await request<{ MediaContainer: MediaContainer }>(`${DISCOVER}/library/metadata/${discoverKey(guid)}`, {
    token: profileToken(),
  });
  return body.MediaContainer.Metadata?.[0];
}

/** Clear the cached list, e.g. after a profile switch. */
export function forgetWatchlist(): void {
  cached = undefined;
  setVersion((v) => v + 1);
}
