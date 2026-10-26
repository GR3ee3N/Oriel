// Clear cached browse data after playback so screens reload watch state and progress.

import { type Accessor, createSignal, type Resource } from 'solid-js';
import { invalidate } from './plex/api';

const [version, setVersion] = createSignal(0);

/** Read in a resource source to reload it when browse data changes. */
export const dataVersion = version;

/** A resource's value, kept through a failed reload and undefined after a
 * failed first load. Solid's `latest` throws the error instead, which breaks
 * whatever reads it, the error message included. */
export function loaded<T>(r: Resource<T>): Accessor<T | undefined> {
  let last: T | undefined;
  return () => (r.error ? last : (last = r.latest));
}

export function refresh(): void {
  invalidate();
  setVersion((v) => v + 1);
}
