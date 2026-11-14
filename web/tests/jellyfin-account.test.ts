import { beforeEach, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('../src/store', () => ({
  load: vi.fn(async () => structuredClone(store.data)),
  save: vi.fn(async (changes: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) delete store.data[k];
      else if (v !== undefined) store.data[k] = structuredClone(v);
    }
  }),
}));
vi.mock('../src/bridge', () => ({ runId: vi.fn(async () => 'run-1') }));

/** A Jellyfin server answering Quick Connect; `approve` lets the next poll through. */
const server = vi.hoisted(() => ({ approved: false, user: 'u1', calls: [] as { path: string; auth: string }[] }));
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: URL, init: RequestInit) => {
    const path = url.pathname;
    server.calls.push({ path, auth: (init.headers as Record<string, string>).Authorization });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '/System/Info/Public') return url.protocol === 'https:' ? json({ Id: 'srv', ServerName: 'Home', Version: '12.4.0' }) : new Response('', { status: 404 });
    if (path === '/QuickConnect/Enabled') return json(true);
    if (path === '/QuickConnect/Initiate') return json({ Code: '123456', Secret: 'sec', Authenticated: false });
    if (path === '/QuickConnect/Connect') return json({ Code: '123456', Secret: 'sec', Authenticated: server.approved });
    if (path === '/Users/AuthenticateWithQuickConnect') return json({ AccessToken: `token-${server.user}`, User: { Id: server.user, Name: server.user.toUpperCase() } });
    return new Response('', { status: 404 });
  }),
);

const { candidates, jellyfinAccount } = await import('../src/jellyfin/account');

beforeEach(() => {
  store.data = {};
  server.approved = false;
  server.calls = [];
});

test('a typed address is tried as HTTPS, then HTTP on Jellyfin’s port', () => {
  expect(candidates('media.example.com/')).toEqual(['https://media.example.com', 'http://media.example.com:8096', 'http://media.example.com']);
  expect(candidates('192.168.1.20:8096')).toEqual(['http://192.168.1.20:8096', 'https://192.168.1.20:8096']);
  expect(candidates('http://box:8096')).toEqual(['http://box:8096']);
});

test('Quick Connect signs in whoever approves the code, and each sign-in adds a profile', async () => {
  vi.useFakeTimers();
  const account = await jellyfinAccount('device-1');
  expect(account.address!.known()).toBe(false);
  await account.address!.set('media.example.com');
  expect(store.data.server).toEqual({ address: 'https://media.example.com', id: 'srv', name: 'Home' });

  const show = vi.fn();
  const signedIn = account.signIn(show, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(4100);
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ code: '123456', title: 'Sign in to Home' }));
  server.approved = true;
  await vi.advanceTimersByTimeAsync(2100);
  await signedIn;
  expect(server.calls.find((c) => c.path === '/QuickConnect/Initiate')?.auth).toMatch(/^MediaBrowser Client="Oriel", Device="Kodi", DeviceId="device-1", Version="[^"]*"$/);
  expect(store.data).toMatchObject({ users: [{ id: 'u1', name: 'U1', token: 'token-u1' }], userId: 'u1' });
  expect(await account.profiles()).toEqual([]);

  server.user = 'u2';
  const second = account.signIn(vi.fn(), new AbortController().signal);
  await vi.advanceTimersByTimeAsync(2100);
  await second;
  expect((await account.profiles()).map((p) => p.id)).toEqual(['u1', 'u2']);
  expect(await account.resume(false)).toMatchObject({ id: 'u2' });
  vi.useRealTimers();
});

test('a server found on the network is kept at the first of its addresses that answers as that server', async () => {
  const account = await jellyfinAccount('device-1');
  await expect(account.address!.choose({ id: 'elsewhere', name: 'Den', addresses: ['https://media.example.com'] })).rejects.toThrow('Den is not answering.');
  expect(store.data.server).toBeUndefined();
  await account.address!.choose({ id: 'srv', name: 'Home', addresses: ['http://172.17.0.2:8096', 'https://media.example.com'] });
  expect(store.data.server).toEqual({ address: 'https://media.example.com', id: 'srv', name: 'Home' });
});
