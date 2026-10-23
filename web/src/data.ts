// Clear cached browse data after playback so screens reload watch state and progress.

import { createSignal } from 'solid-js';
import { invalidate } from './plex/api';

const [version, setVersion] = createSignal(0);

/** Read in a resource source to reload it when browse data changes. */
export const dataVersion = version;

export function refresh(): void {
  invalidate();
  setVersion((v) => v + 1);
}
