// When browse data may be stale: after playback (watch state, progress)
// the cached responses are dropped and screens reload what they show.

import { createSignal } from 'solid-js';
import { invalidate } from './plex/api';

const [version, setVersion] = createSignal(0);

/** Read it in a resource's source to reload when data changes. */
export const dataVersion = version;

export function refresh(): void {
  invalidate();
  setVersion((v) => v + 1);
}
