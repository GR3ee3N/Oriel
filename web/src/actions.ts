// What OK and Play do with an item, from any screen.

import { push } from './router';
import { children, metadata } from './plex/api';
import { clean } from './plex/format';
import type { Metadata, Role } from './plex/types';
import { startPlayback } from './player/playback';
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
    default:
      console.error(`open: no page for a ${item.type}`);
  }
}

/** Opens the library's titles with `person` in them. */
export function openPerson(item: Metadata, person: Role): void {
  const filter = person.filter ?? (person.id !== undefined ? `actor=${person.id}` : undefined);
  if (item.librarySectionID === undefined || !filter) return;
  push({ screen: 'person', section: String(item.librarySectionID), filter, title: person.tag });
}

/** Plays the item: a movie or episode itself (resuming unless `fromStart`),
 * a show its next episode, a season its first unwatched one. */
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
  if (item.type !== 'movie' && item.type !== 'episode') return;
  await startPlayback(item, fromStart);
}

async function firstEpisode(show?: string): Promise<Metadata | undefined> {
  if (!show) return undefined;
  const seasons = await children(currentServer(), show);
  const first = seasons.find((s) => s.index !== 0) ?? seasons[0];
  return first ? (await children(currentServer(), first.ratingKey))[0] : undefined;
}
