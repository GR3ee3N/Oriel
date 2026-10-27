// Shared item actions for Select and Play on every screen.

import { createSignal } from 'solid-js';
import { push } from './router';
import { children, metadata } from './plex/api';
import { clean } from './plex/format';
import type { Metadata, Role } from './plex/types';
import type { QueueSource } from './plex/playqueue';
import { startPlayback, startQueue } from './player/playback';
import { currentServer } from './session';

export function open(item: Metadata): void {
  switch (item.type) {
    case 'movie':
      return push({ screen: 'movie', ratingKey: item.ratingKey });
    case 'show':
      return push({ screen: 'show', ratingKey: item.ratingKey });
    case 'season':
      return push({ screen: 'show', ratingKey: item.parentRatingKey!, season: item.ratingKey });
    case 'episode':
      return push({
        screen: 'show',
        ratingKey: item.grandparentRatingKey!,
        season: item.parentRatingKey,
        episode: item.ratingKey,
      });
    case 'collection':
      return push({ screen: 'collection', ratingKey: item.ratingKey, title: clean(item.title) });
    case 'playlist':
      return push({ screen: 'playlist', ratingKey: item.ratingKey, title: clean(item.title) });
    default:
      console.error(`open: no page for a ${item.type}`);
  }
}

/** The season a show page opens on: the next episode's, else the first
 * season that isn't Specials. */
export function firstSeason(seasons: Metadata[] | undefined, next?: Metadata): string | undefined {
  return next?.parentRatingKey ?? (seasons?.find((s) => s.index !== 0) ?? seasons?.[0])?.ratingKey;
}

/** List titles featuring `person` in the item's library. */
export function openPerson(item: Metadata, person: Role): void {
  const filter = person.filter ?? (person.id !== undefined ? `actor=${person.id}` : undefined);
  if (item.librarySectionID === undefined || !filter) return;
  push({ screen: 'person', section: String(item.librarySectionID), filter, title: person.tag });
}

// Version chosen per title on its detail page, for this run of Oriel.
const [versions, setVersions] = createSignal<Record<string, number>>({});

/** Index in item.Media of the version Play starts. */
export const chosenVersion = (ratingKey: string): number => versions()[ratingKey] ?? 0;

export function chooseVersion(ratingKey: string, index: number): void {
  setVersions((v) => ({ ...v, [ratingKey]: index }));
}

/** Resume movies and episodes unless `fromStart` is set; an episode plays
 * on through the rest of its show. For shows, play the next episode; for
 * seasons, play the first unwatched episode or the first. */
export async function play(item: Metadata, fromStart = false): Promise<void> {
  const server = currentServer();
  if (item.type === 'show') {
    const show = await metadata(server, item.ratingKey);
    const next = show?.OnDeck?.Metadata?.[0] ?? (await firstEpisode(show?.ratingKey));
    if (next) return play(next);
    return;
  }
  if (item.type === 'season') {
    const episodes = await children(server, item.ratingKey);
    const next = episodes.find((e) => !e.viewCount) ?? episodes[0];
    if (next) return play(next);
    return;
  }
  // Clips are extras such as trailers.
  if (item.type !== 'movie' && item.type !== 'episode' && item.type !== 'clip') return;
  await startPlayback(item, fromStart, chosenVersion(item.ratingKey));
}

/** Play a whole collection or playlist in its order, or shuffled by the
 * server, starting with the first entry from its start. */
export function playAll(source: { collection: string } | { playlist: string }, shuffle = false): Promise<void> {
  return startQueue({ ...source, shuffle } as QueueSource, true);
}

async function firstEpisode(show?: string): Promise<Metadata | undefined> {
  if (!show) return undefined;
  const seasons = await children(currentServer(), show);
  const first = seasons.find((s) => s.index !== 0) ?? seasons[0];
  return first ? (await children(currentServer(), first.ratingKey))[0] : undefined;
}
