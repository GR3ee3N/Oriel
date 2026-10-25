// Windows of a play queue: joining a newly loaded window onto the loaded one
// and finding entries by their playQueueItemID.

import type { PlayQueue } from '../plex/playqueue';
import type { Metadata } from '../plex/types';

/** Join `got` onto `have` through an entry both contain, taking `got`'s
 * copy of entries in both; a window that shares none replaces the loaded one. */
export function merge(have: PlayQueue, got: PlayQueue): PlayQueue {
  if (have.id !== got.id) return got;
  const ids = new Map(have.items.map((m, i) => [m.playQueueItemID, i]));
  const shared = got.items.findIndex((m) => ids.has(m.playQueueItemID));
  if (shared < 0) return got;
  const start = have.start + ids.get(got.items[shared].playQueueItemID)! - shared;
  const first = Math.min(have.start, start);
  const items: Metadata[] = [];
  for (const [w, offset] of [
    [have, have.start],
    [got, start],
  ] as const) {
    w.items.forEach((m, i) => (items[offset - first + i] = m));
  }
  return { ...got, start: first, items };
}

/** Index of the entry in the loaded window. */
export const indexOf = (q: PlayQueue, entry: number | undefined): number =>
  entry === undefined ? -1 : q.items.findIndex((m) => m.playQueueItemID === entry);

/** The entry after `entry`, if it's loaded. */
export function after(q: PlayQueue | undefined, entry: number | undefined): Metadata | undefined {
  if (!q) return undefined;
  const i = indexOf(q, entry);
  return i >= 0 ? q.items[i + 1] : undefined;
}

/** 1-based position of the entry in the whole queue. */
export function position(q: PlayQueue, entry: number | undefined): number | undefined {
  const i = indexOf(q, entry);
  return i >= 0 ? q.start + i + 1 : undefined;
}

/** Whether entries exist beyond the loaded window on that side. */
export const more = (q: PlayQueue, side: 'before' | 'after'): boolean =>
  side === 'before' ? q.start > 0 : q.start + q.items.length < q.total;
