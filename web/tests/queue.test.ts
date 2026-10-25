import { describe, expect, it } from 'vitest';
import type { PlayQueue } from '../src/plex/playqueue';
import type { Metadata } from '../src/plex/types';
import { after, merge, more, position } from '../src/player/queue';

const entry = (id: number, ratingKey = String(id)) => ({ ratingKey, key: '', type: 'episode', title: ratingKey, playQueueItemID: id }) as Metadata;
const queue = (start: number, ids: number[], total = 10): PlayQueue => ({ id: 1, total, shuffled: false, start, items: ids.map((i) => entry(i)) });
const ids = (q: PlayQueue) => q.items.map((m) => m.playQueueItemID);

describe('play queue windows', () => {
  it('joins a later window through a shared entry', () => {
    const q = merge(queue(2, [3, 4, 5]), queue(4, [5, 6, 7]));
    expect(q.start).toBe(2);
    expect(ids(q)).toEqual([3, 4, 5, 6, 7]);
  });

  it('joins an earlier window and moves the start back', () => {
    const q = merge(queue(4, [5, 6, 7]), { ...queue(0, [1, 2, 3, 4, 5]), start: 0 });
    expect(q.start).toBe(0);
    expect(ids(q)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('replaces the window when nothing is shared, or the queue changed', () => {
    expect(ids(merge(queue(0, [1, 2]), queue(6, [7, 8])))).toEqual([7, 8]);
    expect(ids(merge(queue(0, [1, 2]), { ...queue(0, [1, 9]), id: 2 }))).toEqual([1, 9]);
  });

  it('finds the next entry by its own ID, so a title can appear twice', () => {
    const q: PlayQueue = { id: 1, total: 3, shuffled: false, start: 0, items: [entry(1, 'A'), entry(2, 'B'), entry(3, 'A')] };
    expect(after(q, 1)?.ratingKey).toBe('B');
    expect(after(q, 3)).toBeUndefined();
    expect(position(q, 3)).toBe(3);
  });

  it('knows whether entries lie beyond the window', () => {
    expect(more(queue(0, [1, 2, 3], 3), 'after')).toBe(false);
    expect(more(queue(2, [3, 4], 10), 'after')).toBe(true);
    expect(more(queue(2, [3, 4], 10), 'before')).toBe(true);
  });
});
