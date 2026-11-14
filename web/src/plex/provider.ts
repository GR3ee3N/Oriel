// Plex Media Server as a Provider, with the profile's plex.tv Watchlist.

import { ageRating as ratingLabel } from '../media/format';
import type { FilterField, Item, Sort, TitleQuery } from '../media/model';
import type { Provider, Watchlist } from '../media/provider';
import * as api from './api';
import type { Server } from './client';
import { ageRating, item, library, paged, row } from './convert';
import { imageUrl, logoUrl } from './images';
import { plexPlayback } from './playback';
import { discoverMetadata, isWatchlisted, localCopies, setWatchlisted, watchlist, watchlistVersion } from './watchlist';

const SORTS: Record<Sort, string> = {
  title: 'titleSort',
  added: 'addedAt:desc',
  released: 'originallyAvailableAt:desc',
  rating: 'audienceRating:desc',
  watched: 'lastViewedAt:desc',
  duration: 'duration:desc',
};

const FIELDS: Record<FilterField, string> = {
  genre: 'genre',
  year: 'decade',
  resolution: 'resolution',
  hdr: 'hdr',
  contentRating: 'contentRating',
};

function filters(q: TitleQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(q.filters) as [FilterField, string][]) out[FIELDS[field]] = field === 'hdr' ? '1' : value;
  if (q.person) out.actor = q.person;
  if (q.collection) out.collection = q.collection;
  return out;
}

export function plexProvider(server: Server): Provider {
  return {
    server: { id: server.id, name: server.name, local: server.local, address: server.uri },
    mediaSource: () => ({ base: server.uri, headers: { 'X-Plex-Token': server.token } }),
    features: { hdrFilter: true, savedTracks: true },
    libraries: async () => (await api.sections(server)).flatMap((d) => library(d) ?? []),
    invalidate: () => api.invalidate(),
    titles: async (library, q, page) =>
      paged(await api.sectionItems(server, library, { sort: SORTS[q.sort], unwatched: q.unwatched, filters: filters(q) }, page)),
    filterValues: async (library, field) => {
      const values = await api.filterValues(server, library, FIELDS[field]);
      // Plex lists ratings as "de/12"; the label reads "FSK 12".
      return field === 'contentRating' ? values.map((v) => ({ key: v.key, title: ratingLabel(ageRating(v.title)) })) : values;
    },
    letters: (library, q) => api.firstCharacters(server, library, q.unwatched, filters(q)),
    home: async () => (await api.homeHubs(server)).map(row),
    libraryRows: async (library) => (await api.sectionHubs(server, library)).map(row),
    collections: async (library, page) => paged(await api.sectionCollections(server, library, page)),
    collection: async (id, page) => paged(await api.collectionItems(server, id, page)),
    playlists: async (page) => paged(await api.playlists(server, page)),
    playlist: async (id, page) => paged(await api.playlistItems(server, id, page)),
    item: async (id) => {
      const m = await api.metadata(server, id);
      return m && item(m);
    },
    children: async (id) => (await api.children(server, id)).map(item),
    related: async (id) => (await api.related(server, id)).map(row),
    search: async (text) => (await api.search(server, text)).map(row),
    setWatched: (id, watched) => api.setWatched(server, id, watched),
    image: (ref, w, h, o) => (o?.logo ? logoUrl(server, ref, w, h) : imageUrl(server, ref, w, h, o?.blur)),
    playback: plexPlayback(server),
    watchlist: plexWatchlist(server),
  };
}

function plexWatchlist(server: Server): Watchlist {
  return {
    version: watchlistVersion,
    items: async () => (await watchlist()).map(item),
    copies: async (guids) => {
      const found = new Map<string, Item>();
      for (const [guid, m] of await localCopies(server, guids)) found.set(guid, item(m));
      return found;
    },
    accepts: (guid) => !!guid?.startsWith('plex://'),
    has: isWatchlisted,
    set: setWatchlisted,
    details: async (guid) => {
      const m = await discoverMetadata(guid);
      return m && item(m);
    },
  };
}
