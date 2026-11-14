// Windows of a play queue: joining a newly loaded window onto the loaded one
// and finding entries by their own ids.

import type { Queue, QueueEntry } from '../media/provider';

/** Join `got` onto `have` through an entry both contain, taking `got`'s
 * copy of entries in both; a window that shares none replaces the loaded one. */
export function merge(have: Queue, got: Queue): Queue {
  if (have.id !== got.id) return got;
  const ids = new Map(have.entries.map((e, i) => [e.entry, i]));
  const shared = got.entries.findIndex((e) => ids.has(e.entry));
  if (shared < 0) return got;
  const start = have.start + ids.get(got.entries[shared].entry)! - shared;
  const first = Math.min(have.start, start);
  const entries: QueueEntry[] = [];
  for (const [w, offset] of [
    [have, have.start],
    [got, start],
  ] as const) {
    w.entries.forEach((e, i) => (entries[offset - first + i] = e));
  }
  return { ...got, start: first, entries };
}

/** Index of the entry in the loaded window. */
export const indexOf = (q: Queue, entry: string | undefined): number =>
  entry === undefined ? -1 : q.entries.findIndex((e) => e.entry === entry);

/** The entry after `entry`, if it's loaded. */
export function after(q: Queue | undefined, entry: string | undefined): QueueEntry | undefined {
  if (!q) return undefined;
  const i = indexOf(q, entry);
  return i >= 0 ? q.entries[i + 1] : undefined;
}

/** 1-based position of the entry in the whole queue. */
export function position(q: Queue, entry: string | undefined): number | undefined {
  const i = indexOf(q, entry);
  return i >= 0 ? q.start + i + 1 : undefined;
}

/** Whether entries exist beyond the loaded window on that side. */
export const more = (q: Queue, side: 'before' | 'after'): boolean =>
  side === 'before' ? q.start > 0 : q.start + q.entries.length < q.total;
