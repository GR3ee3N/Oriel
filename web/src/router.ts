import { createRouter, type Entry as RouterEntry } from '@oriel/web';

export type Route =
  | { screen: 'home' }
  | { screen: 'library'; section: string; title: string }
  | { screen: 'search' }
  | { screen: 'settings' }
  | { screen: 'movie'; ratingKey: string }
  | { screen: 'show'; ratingKey: string; season?: string; episode?: string }
  | { screen: 'collection'; ratingKey: string; title: string }
  | { screen: 'person'; section: string; filter: string; title: string };

export type Entry = RouterEntry<Route>;

export const { stack, top, root, push, pop, tab } = createRouter<Route>({ screen: 'home' });
