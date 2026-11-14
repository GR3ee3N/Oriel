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
const fonts = vi.hoisted(() => ({ noteText: vi.fn() }));
vi.mock('../src/fonts', () => fonts);

/** A Jellyfin server answering Quick Connect; `approve` lets the next poll through. */
const server = vi.hoisted(() => ({ approved: false, quickConnect: true, user: 'u1', calls: [] as { path: string; auth: string }[] }));
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: URL, init: RequestInit) => {
    const path = url.pathname;
    server.calls.push({ path, auth: (init.headers as Record<string, string>).Authorization });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '/System/Info/Public') return url.protocol === 'https:' ? json({ Id: 'srv', ServerName: 'Home', Version: '12.4.0' }) : new Response('', { status: 404 });
    if (path === '/QuickConnect/Enabled') return json(server.quickConnect);
    if (path === '/Users/Public') return json([{ Id: 'u1', Name: 'Ann', PrimaryImageTag: 'p1', HasPassword: true }, { Id: 'u3', Name: 'Kid', HasPassword: false }]);
    if (path === '/Users/AuthenticateByName') {
      const { Username, Pw } = JSON.parse(init.body as string);
      if (Username !== 'Ann' || Pw !== 'right') return new Response('', { status: 401 });
      return json({ AccessToken: 'token-ann', User: { Id: 'u1', Name: 'Ann', PrimaryImageTag: 'p1' } });
    }
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
  server.quickConnect = true;
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

test('a user name and password sign in and add a profile; the listed users say who needs a password', async () => {
  const account = await jellyfinAccount('device-1');
  await account.address!.set('media.example.com');
  expect(await account.password!.users()).toEqual([
    { id: 'u1', name: 'Ann', photo: 'https://media.example.com/Users/u1/Images/Primary?tag=p1&maxHeight=240', protected: true },
    { id: 'u3', name: 'Kid', photo: undefined, protected: false },
  ]);
  await expect(account.password!.signIn('Ann', 'wrong')).rejects.toMatchObject({ status: 401 });
  expect(store.data.users).toEqual([]);
  await account.password!.signIn('Ann', 'right');
  expect(store.data).toMatchObject({ users: [{ id: 'u1', name: 'Ann', token: 'token-ann', photo: expect.stringContaining('tag=p1') }], userId: 'u1' });
  expect(server.calls.find((c) => c.path === '/Users/AuthenticateByName')?.auth).toMatch(/^MediaBrowser Client="Oriel", Device="Kodi", DeviceId="device-1"/);
});

test('without Quick Connect the sign-in screen shows no code and waits for the password', async () => {
  server.quickConnect = false;
  const account = await jellyfinAccount('device-1');
  await account.address!.set('media.example.com');
  const show = vi.fn();
  const abort = new AbortController();
  const waiting = account.signIn(show, abort.signal);
  await vi.waitFor(() => expect(show).toHaveBeenCalledWith({ code: '', title: 'Sign in to Home', hint: '' }));
  abort.abort();
  await waiting;
  expect(server.calls.some((c) => c.path === '/QuickConnect/Initiate')).toBe(false);
});

test('text the server sends is checked for characters only the extra fonts draw', async () => {
  const account = await jellyfinAccount('client-1');
  await account.address!.set('media.example.com');
  expect(fonts.noteText).toHaveBeenCalledWith(expect.stringContaining('"ServerName":"Home"'));
});
