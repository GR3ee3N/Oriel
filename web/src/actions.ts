// Shared item actions for Select and Play on every screen.

import { createSignal } from 'solid-js';
import type { Item, Person } from './media/model';
import { push } from './router';
import { clean } from './media/format';
import type { QueueSource } from './media/provider';
import { provider } from './media/servers';
import { startPlayback, startQueue } from './player/playback';

export function open(item: Item): void {
  switch (item.kind) {
    case 'movie':
      return push({ screen: 'movie', id: item.id });
    case 'show':
      return push({ screen: 'show', id: item.id });
    case 'season':
      return push({ screen: 'show', id: item.show!.id, season: item.id });
    case 'episode':
      return push({ screen: 'show', id: item.show!.id, season: item.season?.id, episode: item.id });
    case 'collection':
      return push({ screen: 'collection', id: item.id, title: clean(item.title) });
    case 'playlist':
      return push({ screen: 'playlist', id: item.id, title: clean(item.title) });
    default:
      console.error(`open: no page for a ${item.kind}`);
  }
}

/** The season a show page opens on: the next episode's, else the first
 * season that isn't Specials. */
export function firstSeason(seasons: Item[] | undefined, nextSeason?: string): string | undefined {
  return nextSeason ?? (seasons?.find((s) => s.number !== 0) ?? seasons?.[0])?.id;
}

let prefetchTimer: ReturnType<typeof setTimeout> | undefined;

/** Once focus settles on `item`, fetch what its page loads first, so
 * opening it shows the page from the cache. Entries last one minute. */
export function prefetch(item: Item): void {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    const server = provider();
    const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);
    if (item.kind === 'movie') return void quiet(server.item(item.id));
    const show = item.kind === 'show' ? item.id : item.kind === 'season' || item.kind === 'episode' ? item.show?.id : undefined;
    if (!show) return;
    const details = quiet(server.item(show));
    const seasons = quiet(server.children(show));
    const season = item.kind === 'season' ? item.id : item.kind === 'episode' ? item.season?.id : undefined;
    if (season) return void quiet(server.children(season));
    void details.then(async (s) => {
      const next = s?.next;
      const key = firstSeason(next ? undefined : await seasons, next?.season?.id);
      if (key) await quiet(server.children(key));
    });
  }, 300);
}

/** List titles featuring `person` in the item's library, or on the whole
 * server when the item doesn't name its library. */
export function openPerson(item: Item, person: Person): void {
  if (!person.id) return;
  push({ screen: 'titles', section: item.library ?? '', title: person.name, query: { person: person.id } });
}

// Version chosen per title on its detail page, for this run of Oriel. Item
// ids are local to a server, so each choice is scoped to the current one.
const [versions, setVersions] = createSignal<Record<string, number>>({});
const versionKey = (id: string) => `${provider().server.id}|${id}`;

/** Index in item.versions of the version Play starts. */
export const chosenVersion = (id: string): number => versions()[versionKey(id)] ?? 0;

export function chooseVersion(id: string, index: number): void {
  setVersions((v) => ({ ...v, [versionKey(id)]: index }));
}

/** Resume movies and episodes unless `fromStart` is set; an episode plays
 * on through the rest of its show. For shows, play the next episode; for
 * seasons, play the first unwatched episode or the first. */
export async function play(item: Item, fromStart = false): Promise<void> {
  if (item.kind === 'show') {
    const show = await provider().item(item.id);
    const next = show?.next ?? (show && (await firstEpisode(show.id)));
    if (next) return play(next, fromStart);
    return;
  }
  if (item.kind === 'season') {
    const episodes = await provider().children(item.id);
    const next = episodes.find((e) => !e.plays) ?? episodes[0];
    if (next) return play(next, fromStart);
    return;
  }
  // Clips are extras such as trailers.
  if (item.kind !== 'movie' && item.kind !== 'episode' && item.kind !== 'clip') return;
  await startPlayback(item, fromStart, chosenVersion(item.id));
}

/** Play a whole collection or playlist in its order, or shuffled by the
 * server, starting with the first entry from its start. */
export function playAll(source: { collection: string } | { playlist: string }, shuffle = false): Promise<void> {
  return startQueue({ ...source, shuffle } as QueueSource, true);
}

async function firstEpisode(show: string): Promise<Item | undefined> {
  const first = firstSeason(await provider().children(show));
  return first ? (await provider().children(first))[0] : undefined;
}
