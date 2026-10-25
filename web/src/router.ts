// The screen stack on the current tab. Screens below the top stay mounted, so
// Back returns to their focus and scroll position. Each entry gets its own
// focus scope.

import { createSignal } from 'solid-js';

export type Route =
  | { screen: 'home' }
  | { screen: 'library'; section: string; title: string; type?: string }
  | { screen: 'search' }
  | { screen: 'watchlist' }
  | { screen: 'playlists' }
  | { screen: 'settings' }
  | { screen: 'movie'; ratingKey: string }
  | { screen: 'show'; ratingKey: string; season?: string; episode?: string }
  | { screen: 'collection'; ratingKey: string; title: string; section?: string }
  | { screen: 'playlist'; ratingKey: string; title: string }
  | { screen: 'person'; section: string; filter: string; title: string }
  | { screen: 'remote'; guid: string; title: string };

export interface Entry {
  route: Route;
  scope: string;
}

let next = 0;
const entry = (route: Route): Entry => ({ route, scope: `screen-${next++}` });

const [stack, setStack] = createSignal<Entry[]>([entry({ screen: 'home' })]);

export { stack };
export const top = () => stack()[stack().length - 1];
export const root = () => stack()[0];

export function push(route: Route): void {
  setStack((s) => [...s, entry(route)]);
}

/** Remove the top screen; false at the tab's root. */
export function pop(): boolean {
  if (stack().length <= 1) return false;
  setStack((s) => s.slice(0, -1));
  return true;
}

/** Switch to a tab, starting a new stack unless it's already showing. */
export function tab(route: Route): void {
  if (stack().length === 1 && JSON.stringify(root().route) === JSON.stringify(route)) return;
  setStack([entry(route)]);
}

/** Return to Home. A Home already under the detail stack stays mounted, so
 * it keeps its focus and scroll position. */
export function goHome(): void {
  if (root().route.screen !== 'home') return tab({ screen: 'home' });
  while (pop());
}
