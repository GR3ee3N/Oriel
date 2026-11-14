import { beforeEach, expect, test, vi } from 'vitest';
import type { Item } from '../src/media/model';

const session = vi.hoisted(() => ({ user: { id: 'test' } }));
vi.mock('../src/session', () => ({ session }));
vi.mock('../src/prefs', () => ({ hidesUnwatched: (profile: string) => profile === 'test' }));

import { episodeText, episodeTitle, hidden, setRevealed } from '../src/spoilers';

const episode: Item = { id: '1', kind: 'episode', title: 'The real title', art: { image: '/episode.jpg' } };

beforeEach(() => {
  session.user.id = 'test';
  setRevealed(undefined);
});

test('conceals unwatched and partly watched episodes only for the enabled profile', () => {
  expect(hidden(episode)).toBe(true);
  const started: Item = { ...episode, position: 60_000 };
  expect(hidden(started)).toBe(true);
  expect(hidden({ ...episode, plays: 1 })).toBe(false);
  expect(hidden({ ...episode, kind: 'movie' })).toBe(false);
  expect(hidden(undefined)).toBe(false);
  session.user.id = 'other';
  expect(hidden(episode)).toBe(false);
});

test('reveals one episode and conceals it again without changing its details', () => {
  setRevealed(episode.id);
  expect(hidden(episode)).toBe(false);
  expect(hidden({ ...episode, id: '2' })).toBe(true);
  setRevealed(undefined);
  expect(hidden(episode)).toBe(true);
  expect(episode.title).toBe('The real title');
  expect(episode.art.image).toBe('/episode.jpg');
});

test('replaces hidden titles, summaries and chapter names, leaving missing text missing', () => {
  expect(episodeTitle(episode)).toBe('[Spoilers removed]');
  expect(episodeText(episode, 'What happens')).toBe('[Spoilers removed]');
  expect(episodeText(episode, undefined)).toBeUndefined();
  expect(episodeTitle({ ...episode, plays: 1 })).toBe('The real title');
  expect(episodeText({ ...episode, plays: 1 }, 'What happens')).toBe('What happens');
});
