// Keep the splash visible until Home's rows and the first item's metadata
// and artwork are ready, so the screen appears together.

import { createSignal } from 'solid-js';

const [homeReady, setHomeReady] = createSignal(false);
export { homeReady };

export function markHomeReady(): void {
  setHomeReady(true);
}

/** Wait for Home to load after sign-in or a user change. */
export function resetHomeReady(): void {
  setHomeReady(false);
}
