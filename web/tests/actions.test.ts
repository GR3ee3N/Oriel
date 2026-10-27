import { expect, test, vi } from 'vitest';

const session = vi.hoisted(() => ({ serverId: 'A' }));
vi.mock('../src/session', () => ({ currentServer: () => ({ id: session.serverId }) }));
vi.mock('../src/router', () => ({ push: vi.fn(), tab: vi.fn() }));
vi.mock('../src/plex/api', () => ({ children: vi.fn(), metadata: vi.fn() }));
vi.mock('../src/player/playback', () => ({ startPlayback: vi.fn(), startQueue: vi.fn() }));

const { chooseVersion, chosenVersion } = await import('../src/actions');

test('a version choice applies only on the server it was made on', () => {
  chooseVersion('1', 2);
  expect(chosenVersion('1')).toBe(2);
  session.serverId = 'B';
  expect(chosenVersion('1')).toBe(0);
  chooseVersion('1', 1);
  session.serverId = 'A';
  expect(chosenVersion('1')).toBe(2);
});
