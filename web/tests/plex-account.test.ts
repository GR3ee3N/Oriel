import { beforeEach, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
const run = vi.hoisted(() => ({ id: 'run-2' }));
vi.mock('../src/store', () => ({
  load: vi.fn(async () => structuredClone(store.data)),
  save: vi.fn(async (changes: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) delete store.data[k];
      else store.data[k] = v;
    }
  }),
}));
vi.mock('../src/bridge', () => ({ runId: vi.fn(async () => run.id) }));
const users = {
  admin: { id: 1, uuid: 'admin', title: 'Admin', authToken: 'account-token', home: true },
  test: { id: 2, uuid: 'test', title: 'Test', authToken: 'test-token' },
};
vi.mock('../src/plex/auth', () => ({
  whoAmI: vi.fn(async (token: string) => Object.values(users).find((u) => u.authToken === token) ?? null),
  homeUsers: vi.fn(async () => [
    { id: 1, uuid: 'admin', title: 'Admin', protected: true },
    { id: 2, uuid: 'test', title: 'Test', protected: false },
  ]),
  switchUser: vi.fn(async (_token: string, user: { uuid: string }) => Object.values(users).find((u) => u.uuid === user.uuid)),
  createPin: vi.fn(),
  checkPin: vi.fn(),
}));

const { plexAccount } = await import('../src/plex/account');

beforeEach(() => {
  store.data = {};
  run.id = 'run-2';
});

test('the last profile comes back within the same run, and in a new run only with automatic sign-in', async () => {
  store.data = { accountToken: 'account-token', userUuid: 'test', userToken: 'test-token', userRun: 'run-1' };
  const account = await plexAccount('c');
  await account.restore();
  expect(await account.resume(false)).toBeUndefined();
  expect(await account.resume(true)).toMatchObject({ id: 'test', name: 'Test' });
  expect(store.data).toMatchObject({ userRun: 'run-2' });
  expect(await account.resume(false)).toMatchObject({ id: 'test' });
});

test('picking a profile keeps its token and its server choice', async () => {
  store.data = { accountToken: 'account-token' };
  const account = await plexAccount('c');
  await account.restore();
  const profiles = await account.profiles();
  expect(profiles).toEqual([
    { id: 'admin', name: 'Admin', protected: true },
    { id: 'test', name: 'Test', protected: false },
  ]);
  await account.pick(profiles[1]);
  await account.saveServer('s2');
  expect(store.data).toEqual({ accountToken: 'account-token', userUuid: 'test', userToken: 'test-token', userRun: 'run-2', servers: { test: 's2' } });
  expect(account.savedServer()).toBe('s2');
});
