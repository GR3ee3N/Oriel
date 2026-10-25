import { describe, expect, it } from 'vitest';
import type { Chapter, Metadata } from '../src/plex/types';
import { chaptersFor, currentChapter } from '../src/player/chapters';

const movie = (chapters: Chapter[], media = [{ id: 7, duration: 600_000 }]) =>
  ({ ratingKey: '1', key: '', type: 'movie', title: 'A', duration: 600_000, Chapter: chapters, Media: media }) as unknown as Metadata;
const ch = (start: number, tag?: string, media = 7, n = 1): Chapter => ({ startTimeOffset: start, tag, thumb: `/library/media/${media}/chapterImages/${n}` });

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
    const two = [{ id: 7, duration: 600_000 }, { id: 8, duration: 600_000 }];
    expect(chaptersFor(movie([ch(0, undefined, 8)], two), 0)).toEqual([]);
    expect(chaptersFor(movie([ch(0, undefined, 8)], two), 1)).toHaveLength(1);
    expect(chaptersFor(movie([{ startTimeOffset: 0 }], two), 0)).toEqual([]);
    expect(chaptersFor(movie([{ startTimeOffset: 0 }]), 0)).toHaveLength(1);
  });

  it('finds the chapter playing at a time', () => {
    const list = chaptersFor(movie([ch(10_000), ch(60_000)]), 0);
    expect(currentChapter(list, 5)).toBe(-1);
    expect(currentChapter(list, 10)).toBe(0);
    expect(currentChapter(list, 59)).toBe(0);
    expect(currentChapter(list, 300)).toBe(1);
  });

  it('counts a chapter from the whole second it starts in, as the player reports', () => {
    const list = chaptersFor(movie([ch(10_000), ch(2_849_180), ch(3_000_700)], [{ id: 7, duration: 3_600_000 }]), 0);
    expect(currentChapter(list, 2849)).toBe(1);
    expect(currentChapter(list, 2848)).toBe(0);
    expect(currentChapter(list, 3000)).toBe(2);
    expect(currentChapter(list, 2999)).toBe(1);
  });
});
