// Sign-in, profile selection and server connection, through the account
// in media/servers.ts. Startup uses the saved sign-in or shows a code to
// enter on another device. An account with several profiles opens the
// picker unless automatic sign-in or a reload within the same app run
// restores the last profile.
//
// Server preference: the profile's last choice, the account's own servers,
// then the account service's order. Unreachable servers fall through to the
// next available server. Explicit server choices in the account menu,
// Settings or error screen fail without falling back to another server.

import { createStore } from 'solid-js/store';
import { call } from './bridge';
import { tab } from './router';
import type { Account, FoundServer, Profile, ServerChoice, SignInCode } from './media/account';
import { ServerError, Unreachable } from './media/errors';
import type { Library } from './media/model';
import type { Provider } from './media/provider';
import { account as openAccount, setProvider } from './media/servers';
import { t } from './i18n';
import { notice } from './notice';
import { loadFontsAsked } from './fonts';
import { loadPrefs, prefs } from './prefs';
import { load, save } from './store';
import { resetHomeReady } from './boot';
import { uuid } from './uuid';
import type { MenuOption } from './ui/components/Menu';

export type { ServerChoice };

type Phase = 'loading' | 'address' | 'signin' | 'users' | 'connecting' | 'ready' | 'error';

interface Session {
  phase: Phase;
  /** The code the sign-in screen shows. */
  code?: SignInCode;
  /** Profiles in the picker. */
  users: Profile[];
  user?: Profile;
  /** Available servers and the selected server id. */
  servers: ServerChoice[];
  serverId?: string;
  /** Several profiles are available; enables automatic sign-in settings. */
  multiUser: boolean;
  /** The picker can add a profile by signing in another person. */
  canAddUser: boolean;
  /** Sign-in also takes a user name and password. */
  canUsePassword: boolean;
  /** Last profile id, used for initial focus in the picker. */
  lastUser?: string;
  /** Counts profiles picked in the picker; each pick starts Home at its first row. */
  picks: number;
  serverName?: string;
  serverAddress?: string;
  /** Server name shown while connecting. */
  connectingTo?: string;
  /** Movie and show libraries listed in the navigation rail. */
  libraries: Library[];
  /** Number of video playlists; the rail lists Playlists only when there are some. */
  playlists: number;
  error?: string;
}

const [session, setSession] = createStore<Session>({
  phase: 'loading',
  users: [],
  servers: [],
  libraries: [],
  playlists: 0,
  multiUser: false,
  canAddUser: false,
  canUsePassword: false,
  picks: 0,
});
export { session };

let account: Account | undefined;
let connected: Provider | undefined;
/** Profile retained for server switching, including during connection. */
let who: Profile | undefined;
/** Retry action for the failed sign-in or connection step. */
let again: () => Promise<void> = () => start();
let signin: AbortController | undefined;

/** Show the failure as a sentence; the raw error goes to the log. Errors
 * thrown here with t() text are already sentences. */
function fail(e: unknown): void {
  console.error(`session: ${e}`);
  const error =
    e instanceof ServerError
      ? t('start.httpError', { status: e.status })
      : e instanceof TypeError || (e instanceof DOMException && e.name === 'TimeoutError')
        ? t('start.offline')
        : e instanceof Error
          ? e.message
          : String(e);
  setSession({ phase: 'error', error });
}

export async function start(): Promise<void> {
  again = () => start();
  setSession({ phase: 'loading', error: undefined });
  try {
    const saved = await load();
    loadPrefs(saved);
    loadFontsAsked(saved);
    if (!saved.clientId) {
      saved.clientId = uuid();
      await save({ clientId: saved.clientId });
    }
    account = await openAccount(saved.clientId);
    setSession({ canAddUser: !!account.addsProfiles, canUsePassword: !!account.password });
    if (account.address && !account.address.known()) return setSession({ phase: 'address' });
    if (!(await account.restore())) return signIn();
    await afterSignIn(account);
  } catch (e) {
    fail(e);
  }
}

async function afterSignIn(a: Account): Promise<void> {
  setSession({ multiUser: false });
  const users = await a.profiles();
  if (users.length < 2) return useProfile(await a.useAccount());
  setSession({ multiUser: true, lastUser: a.lastProfile() });
  // Automatic sign-in reuses the last profile without asking for a PIN.
  const resumed = await a.resume(prefs.autoSignIn);
  if (resumed) return useProfile(resumed);
  setSession({ phase: 'users', users });
}

/** Wait for the user to enter a sign-in code, renewing expired codes. */
export async function signIn(): Promise<void> {
  signin?.abort();
  const abort = (signin = new AbortController());
  const a = account!;
  try {
    await a.signIn((code) => setSession({ phase: 'signin', code }), abort.signal);
    if (!abort.signal.aborted) await afterSignIn(a);
  } catch (e) {
    if (!abort.signal.aborted) fail(e);
  }
}

/** Keep the server the user typed, then sign in to it. Throws a sentence
 * for the address screen when nothing answers there. */
export async function setAddress(text: string): Promise<void> {
  await account!.address!.set(text);
  await signIn();
}

/** Keep a server found on the network, then sign in to it. Throws a
 * sentence for the address screen when it doesn't answer. */
export async function setFoundServer(server: FoundServer): Promise<void> {
  await account!.address!.choose(server);
  await signIn();
}

/** Users the server lists on its sign-in screen. */
export function passwordUsers(): Promise<Profile[]> {
  return account?.password?.users() ?? Promise.resolve([]);
}

/** Sign in with a user name and password in place of the code. A wrong
 * name or password throws ServerError for the sign-in screen to display. */
export async function signInWithPassword(name: string, password: string): Promise<void> {
  const a = account!;
  await a.password!.signIn(name, password);
  signin?.abort();
  try {
    await afterSignIn(a);
  } catch (e) {
    fail(e);
  }
}

/** Sign in another person beside the saved profiles. */
export function addUser(): Promise<void> {
  return signIn();
}

/** A wrong PIN throws ServerError for the picker to display. */
export async function pickUser(user: Profile, pin?: string): Promise<void> {
  const picked = await account!.pick(user, pin);
  setSession({ lastUser: picked.id, picks: session.picks + 1 });
  // Return to Home because library access differs between profiles.
  tab({ screen: 'home' });
  await useProfile(picked);
}

export async function changeUser(): Promise<void> {
  try {
    setSession({ phase: 'users', users: await account!.profiles() });
  } catch (e) {
    fail(e);
  }
}

/** Forget the sign-in and its profile, then show a new sign-in code. */
export async function signOut(): Promise<void> {
  connected = undefined;
  setProvider(undefined);
  who = undefined;
  setSession({ servers: [], serverId: undefined });
  await account!.signOut();
  return signIn();
}

/** Return from the profile picker to the existing library session. */
export function keepUser(): boolean {
  if (!connected || session.phase !== 'users') return false;
  setSession({ phase: 'ready' });
  return true;
}

/** Retry the step that failed. */
export function retry(): Promise<void> {
  return again();
}

/** Switch servers and save the choice for this profile after connection succeeds. */
export async function chooseServer(id: string): Promise<void> {
  if (!who || (id === session.serverId && session.phase === 'ready')) return;
  tab({ screen: 'home' });
  await useProfile(who, id);
}

/** An explicit `want` disables fallback to other servers. */
async function useProfile(user: Profile, want?: string): Promise<void> {
  const a = account!;
  const sameUser = who?.id === user.id;
  who = user;
  again = () => useProfile(user, want);
  resetHomeReady();
  setSession({ phase: 'connecting', error: undefined, connectingTo: undefined, user });
  try {
    if (!want || !session.servers.length || !sameUser) setSession('servers', await a.servers());
    if (!session.servers.length) throw new Error(t('start.noServer', { user: user.name }));
    const server = want ? await connectTo(a, want) : await connectFirst(a, a.savedServer());
    if (want) await a.saveServer(server.server.id);
    // Configure the proxy with this server and its token for Kodi playback.
    await call({ cmd: 'media-source', ...server.mediaSource() });
    const [libraries, playlists] = await Promise.all([
      server.libraries(),
      server.playlists({ start: 0, size: 0 }).then((p) => p.total, () => 0),
    ]);
    connected = server;
    setProvider(server);
    console.log(`session: ${user.name} on ${server.server.name} via ${server.server.address}`);
    setSession({
      phase: 'ready',
      serverName: server.server.name,
      serverAddress: server.server.address,
      serverId: server.server.id,
      libraries,
      playlists,
    });
  } catch (e) {
    fail(e);
  }
}

/** Server choices shared by the account menu, Settings and error screen. */
export function serverOptions(): MenuOption<string>[] {
  return session.servers.map((s) => ({ label: s.owner ? `${s.name} · ${s.owner}` : s.name, value: s.id }));
}

async function connectTo(a: Account, id: string): Promise<Provider> {
  const choice = session.servers.find((s) => s.id === id);
  if (!choice) throw new Error(t('start.serverGone'));
  setSession({ serverId: id, connectingTo: choice.name });
  try {
    return await a.connect(id);
  } catch (e) {
    throw e instanceof Unreachable ? new Error(t('start.notAnswering', { server: choice.name })) : e;
  }
}

/** Try the saved server, then the account's own servers, then the account
 * service's order. If the first fails, probe the rest in parallel and take
 * the highest-priority success. */
async function connectFirst(a: Account, chosen: string | undefined): Promise<Provider> {
  const rank = (s: ServerChoice) => (s.id === chosen ? 0 : s.owner === undefined ? 1 : 2);
  const order = session.servers.map((s, i) => ({ s, i })).sort((x, y) => rank(x.s) - rank(y.s) || x.i - y.i).map((x) => x.s);
  const [first, ...rest] = order;
  try {
    return await connectTo(a, first.id);
  } catch (e) {
    if (!rest.length) throw e;
    console.warn(`session: ${e}; trying the others`);
  }
  setSession({ connectingTo: undefined });
  const attempts = rest.map((s) => a.connect(s.id).catch(() => undefined));
  for (const attempt of attempts) {
    const found = await attempt;
    if (found) {
      setSession({ serverId: found.server.id });
      notice(t('start.fellBack', { server: first.name, other: found.server.name }));
      return found;
    }
  }
  throw new Error(t('start.noneAnswering', { servers: order.map((s) => s.name).join(', ') }));
}
