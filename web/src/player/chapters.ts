// Chapters of the playing version. Plex lists one set of chapters per item;
// their images name the version (media ID) the times belong to.

import type { Metadata } from '../plex/types';

export interface ChapterMark {
  /** 1-based, in time order. */
  n: number;
  /** The chapter's own title; undefined for none or a generic "Chapter 3". */
  title?: string;
  /** Seconds. */
  start: number;
  thumb?: string;
}

// Titles that only number the chapter, in the languages servers use.
const GENERIC = /^\s*(chapter|kapitel|chapitre|capitolo|cap[ií]tulo|hoofdstuk|scene|szene)\s*\d+\s*$/i;

const mediaOf = (thumb: string | undefined) => thumb?.match(/^\/library\/media\/(\d+)\//)?.[1];

/** Chapters for version `media` of `item`, sorted & checked; none when they
 * belong to another version or can't be told apart from one. */
export function chaptersFor(item: Metadata, media: number): ChapterMark[] {
  const list = item.Chapter ?? [];
  const version = item.Media?.[media];
  if (!list.length || !version) return [];
  const owners = new Set(list.map((c) => mediaOf(c.thumb)).filter(Boolean));
  if (owners.size ? !owners.has(String(version.id)) : (item.Media?.length ?? 0) > 1) return [];
  const length = (version.duration ?? item.duration ?? Infinity) / 1000;
  const seen = new Set<number>();
  return list
    .map((c) => ({ title: c.tag && !GENERIC.test(c.tag) ? c.tag.trim() : undefined, start: c.startTimeOffset / 1000, thumb: c.thumb }))
    .filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.start < length)
    .sort((a, b) => a.start - b.start)
    .filter((c) => !seen.has(c.start) && !!seen.add(c.start))
    .map((c, i) => ({ ...c, n: i + 1 }));
}

/** Index of the chapter playing at `seconds`, or -1 before the first. The
 * player reports whole seconds, so a chapter counts from the second it
 * starts in. */
export function currentChapter(list: ChapterMark[], seconds: number): number {
  let at = -1;
  for (let i = 0; i < list.length && Math.floor(list[i].start) <= seconds; i++) at = i;
  return at;
}
