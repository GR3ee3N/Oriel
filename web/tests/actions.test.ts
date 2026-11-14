import { expect, test, vi } from 'vitest';

const session = vi.hoisted(() => ({ serverId: 'A' }));
vi.mock('../src/media/servers', async () => {
  const { plexProvider } = await import('../src/plex/provider');
  const p = plexProvider({ id: 'A' } as never);
  return { provider: () => ({ ...p, server: { ...p.server, id: session.serverId } }) };
});
vi.mock('../src/router', () => ({ push: vi.fn(), tab: vi.fn() }));
vi.mock('../src/plex/api', () => ({ children: vi.fn(), metadata: vi.fn() }));
vi.mock('../src/player/playback', () => ({ startPlayback: vi.fn(), startQueue: vi.fn() }));

const { chooseVersion, chosenVersion, play } = await import('../src/actions');
const { metadata } = await import('../src/plex/api');
const { startPlayback } = await import('../src/player/playback');

test('a version choice applies only on the server it was made on', () => {
  chooseVersion('1', 2);
  expect(chosenVersion('1')).toBe(2);
  session.serverId = 'B';
  expect(chosenVersion('1')).toBe(0);
  chooseVersion('1', 1);
  session.serverId = 'A';
  expect(chosenVersion('1')).toBe(2);
});

test("playing a show starts the next episode Plex names in the show's reply", async () => {
  const next = { ratingKey: 'e5', key: '', type: 'episode', title: 'E5' };
  vi.mocked(metadata).mockResolvedValueOnce({ ratingKey: 's', key: '', type: 'show', title: 'S', OnDeck: { Metadata: next } });
  await play({ id: 's', kind: 'show', title: 'S', art: {} });
  expect(startPlayback).toHaveBeenCalledWith(expect.objectContaining({ id: 'e5', kind: 'episode' }), false, 0);
});

test('a season opens on its part-watched episode, else the first unwatched, else the first', async () => {
  const { nextEpisode } = await import('../src/actions');
  const ep = (id: string, extra: object = {}) => ({ id, kind: 'episode' as const, title: id, art: {}, ...extra });
  expect(nextEpisode([ep('1', { plays: 1 }), ep('2'), ep('3', { position: 60000 })])?.id).toBe('3');
  expect(nextEpisode([ep('1', { plays: 1 }), ep('2'), ep('3')])?.id).toBe('2');
  expect(nextEpisode([ep('1', { plays: 1 }), ep('2', { plays: 1 })])?.id).toBe('1');
  expect(nextEpisode([])).toBeUndefined();
});

test('an episode or season opens its season screen on its own, so Back returns to where it was', async () => {
  const { open } = await import('../src/actions');
  const { push } = await import('../src/router');
  open({ id: 'e3', kind: 'episode', title: 'E3', art: {}, show: { id: 's', title: 'S' }, season: { id: 's1', number: 1 } });
  expect(push).toHaveBeenLastCalledWith({ screen: 'season', show: 's', season: 's1', episode: 'e3' });
  open({ id: 's2', kind: 'season', title: 'Season 2', art: {}, show: { id: 's', title: 'S' } });
  expect(push).toHaveBeenLastCalledWith({ screen: 'season', show: 's', season: 's2' });
});
