import { beforeEach, expect, test, vi } from 'vitest';
import type { Metadata } from '../src/plex/types';

const session = vi.hoisted(() => ({ user: { uuid: 'test' } }));
vi.mock('../src/session', () => ({ session }));
vi.mock('../src/prefs', () => ({ hidesUnwatched: (profile: string) => profile === 'test' }));

import { episodeText, episodeTitle, hidden, setRevealed } from '../src/ui/spoilers';

const episode = { ratingKey: '1', type: 'episode', title: 'The real title', thumb: '/episode.jpg' } as Metadata;

beforeEach(() => {
  session.user.uuid = 'test';
  setRevealed(undefined);
});

test('conceals unwatched and partly watched episodes only for the enabled profile', () => {
  expect(hidden(episode)).toBe(true);
  expect(hidden({ ...episode, viewOffset: 60_000 })).toBe(true);
  expect(hidden({ ...episode, viewCount: 1 })).toBe(false);
  expect(hidden({ ...episode, type: 'movie' })).toBe(false);
  expect(hidden(undefined)).toBe(false);
  session.user.uuid = 'other';
  expect(hidden(episode)).toBe(false);
});

test('reveals one episode and conceals it again without changing its details', () => {
  setRevealed(episode.ratingKey);
  expect(hidden(episode)).toBe(false);
  expect(hidden({ ...episode, ratingKey: '2' })).toBe(true);
  setRevealed(undefined);
  expect(hidden(episode)).toBe(true);
  expect(episode.title).toBe('The real title');
  expect(episode.thumb).toBe('/episode.jpg');
});

test('replaces hidden titles, summaries and chapter names, leaving missing text missing', () => {
  expect(episodeTitle(episode)).toBe('[Spoilers removed]');
  expect(episodeText(episode, 'What happens')).toBe('[Spoilers removed]');
  expect(episodeText(episode, undefined)).toBeUndefined();
  expect(episodeTitle({ ...episode, viewCount: 1 })).toBe('The real title');
  expect(episodeText({ ...episode, viewCount: 1 }, 'What happens')).toBe('What happens');
});
