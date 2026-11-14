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
