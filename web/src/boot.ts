// Whether Home is complete enough to show: the splash (ui/Splash.tsx)
// stays over it until its rows, the first item's info and its picture are
// in, so Home appears whole rather than piece by piece.

import { createSignal } from 'solid-js';

const [homeReady, setHomeReady] = createSignal(false);
export { homeReady };

export function markHomeReady(): void {
  setHomeReady(true);
}

/** A new session (another user, a new sign-in): Home loads again. */
export function resetHomeReady(): void {
  setHomeReady(false);
}
