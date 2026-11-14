import { describe, expect, it } from 'vitest';
import type { Queue } from '../src/media/provider';
import { after, merge, more, position } from '../src/player/queue';

const entry = (n: number, id = String(n)) => ({ entry: String(n), item: { id, kind: 'episode' as const, title: id, art: {} } });
const queue = (start: number, ns: number[], total = 10): Queue => ({ id: '1', total, shuffled: false, start, entries: ns.map((n) => entry(n)) });
const ids = (q: Queue) => q.entries.map((e) => Number(e.entry));

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
    expect(ids(merge(queue(0, [1, 2]), { ...queue(0, [1, 9]), id: '2' }))).toEqual([1, 9]);
  });

  it('finds the next entry by its own ID, so a title can appear twice', () => {
    const q: Queue = { id: '1', total: 3, shuffled: false, start: 0, entries: [entry(1, 'A'), entry(2, 'B'), entry(3, 'A')] };
    expect(after(q, '1')?.item.id).toBe('B');
    expect(after(q, '3')).toBeUndefined();
    expect(position(q, '3')).toBe(3);
  });

  it('knows whether entries lie beyond the window', () => {
    expect(more(queue(0, [1, 2, 3], 3), 'after')).toBe(false);
    expect(more(queue(2, [3, 4], 10), 'after')).toBe(true);
    expect(more(queue(2, [3, 4], 10), 'before')).toBe(true);
  });
});
