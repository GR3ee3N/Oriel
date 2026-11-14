import { describe, expect, it } from 'vitest';
import type { Chapter, Item } from '../src/media/model';
import { chaptersFor, currentChapter } from '../src/player/chapters';

const movie = (chapters: Chapter[], versions = [{ id: '7', duration: 600_000 }]): Item => ({
  id: '1',
  kind: 'movie',
  title: 'A',
  duration: 600_000,
  art: {},
  chapters,
  versions: versions.map((v) => ({ ...v, thumbs: false })),
});
const ch = (start: number, title?: string, version = '7'): Chapter => ({ start, title, version });

describe('chapters', () => {
  it('keeps real titles and drops ones that only number the chapter', () => {
    const list = chaptersFor(movie([ch(0, 'Kapitel 01'), ch(60_000, 'The Heist'), ch(120_000, 'Chapter 3'), ch(180_000)]), 0);
    expect(list.map((c) => c.title)).toEqual([undefined, 'The Heist', undefined, undefined]);
    expect(list.map((c) => c.n)).toEqual([1, 2, 3, 4]);
  });

  it('sorts, drops duplicates and times outside the video', () => {
    const list = chaptersFor(movie([ch(120_000), ch(0), ch(0, 'again'), ch(-5), ch(NaN), ch(700_000)]), 0);
    expect(list.map((c) => c.start)).toEqual([0, 120]);
  });

  it('offers no chapters for a version their images don\'t belong to', () => {
    const two = [{ id: '7', duration: 600_000 }, { id: '8', duration: 600_000 }];
    expect(chaptersFor(movie([ch(0, undefined, '8')], two), 0)).toEqual([]);
    expect(chaptersFor(movie([ch(0, undefined, '8')], two), 1)).toHaveLength(1);
    expect(chaptersFor(movie([{ start: 0 }], two), 0)).toEqual([]);
    expect(chaptersFor(movie([{ start: 0 }]), 0)).toHaveLength(1);
  });

  it('finds the chapter playing at a time', () => {
    const list = chaptersFor(movie([ch(10_000), ch(60_000)]), 0);
    expect(currentChapter(list, 5)).toBe(-1);
    expect(currentChapter(list, 10)).toBe(0);
    expect(currentChapter(list, 59)).toBe(0);
    expect(currentChapter(list, 300)).toBe(1);
  });

  it('counts a chapter from the whole second it starts in, as the player reports', () => {
    const list = chaptersFor(movie([ch(10_000), ch(2_849_180), ch(3_000_700)], [{ id: '7', duration: 3_600_000 }]), 0);
    expect(currentChapter(list, 2849)).toBe(1);
    expect(currentChapter(list, 2848)).toBe(0);
    expect(currentChapter(list, 3000)).toBe(2);
    expect(currentChapter(list, 2999)).toBe(1);
  });
});
