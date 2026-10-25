// Sign-in, Plex Home profile selection and server connection.
// Startup uses the saved account token or requests a plex.tv/link code.
// A Home with several profiles opens the picker unless automatic sign-in
// or a reload within the same app run restores the last profile.
//
// Server preference: the user's last choice, an owned server, then plex.tv's
// order. Unreachable servers fall through to the next available server.
// Explicit server choices in the account menu, Settings or error screen
// fail without falling back to another server.

import { createStore } from 'solid-js/store';
import { call } from './bridge';
import { tab } from './router';
import { checkPin, createPin, homeUsers, type Pin, switchUser, whoAmI } from './plex/auth';
import { PlexError, type Server, setClientId } from './plex/client';
import { connect, servers, Unreachable } from './plex/discovery';
import { invalidate, playlistCount, sections } from './plex/api';
import { forgetWatchlist } from './plex/watchlist';
import type { Directory, HomeUser, Resource, User } from './plex/types';
import { t } from './i18n';
import { notice } from './notice';
import { loadPrefs } from './prefs';
import { load, type Saved, save } from './store';
import { uuid } from '@oriel/web';
import { resetHomeReady } from './boot';
import type { MenuOption } from './ui/components/Menu';

export type Phase = 'loading' | 'signin' | 'users' | 'connecting' | 'ready' | 'error';

interface Session {
  phase: Phase;
  pin?: Pin;
  users: HomeUser[];
  user?: Pick<User, 'uuid' | 'title' | 'thumb'>;
  /** Available servers and the selected server id. */
  servers: ServerChoice[];
  serverId?: string;
  /** Multiple Plex Home profiles are available; enables automatic sign-in settings. */
  multiUser: boolean;
  /** Last profile UUID, used for initial focus in the picker. */
  lastUser?: string;
  /** Counts profiles picked in the picker; each pick starts Home at its first row. */
  picks: number;
  serverName?: string;
  /** Server name shown while connecting. */
  connectingTo?: string;
  /** Movie and show libraries listed in the navigation rail. */
  sections: Directory[];
  /** Number of video playlists; the rail lists Playlists only when there are some. */
  playlists: number;
  error?: string;
}

export interface ServerChoice {
  id: string;
  name: string;
  /** Owner name for a shared server. */
  owner?: string;
}

const [session, setSession] = createStore<Session>({
  phase: 'loading',
  users: [],
  servers: [],
  sections: [],
  playlists: 0,
  multiUser: false,
  picks: 0,
});
export { session };

let saved: Saved = {};
let server: Server | undefined;
/** Current user retained for server switching, including during connection. */
let who: User | undefined;
let resources: Resource[] = [];
/** Retry action for the failed sign-in or connection step. */
let again: () => Promise<void> = () => start();
let signin: AbortController | undefined;

/** plex.tv token of the signed-in profile, for account features such as
 * the Watchlist. Valid only while the session is 'ready'. */
export function profileToken(): string {
  if (!who) throw new Error('no profile');
  return who.authToken;
}

/** Valid only while the session is 'ready'. */
export function currentServer(): Server {
  if (!server) throw new Error('no server');
  return server;
}

/** Show the failure as a sentence; the raw error goes to the log. Errors
 * thrown here with t() text are already sentences. */
function fail(e: unknown): void {
  console.error(`session: ${e}`);
  const error =
    e instanceof PlexError
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
    saved = await load();
    loadPrefs(saved);
    if (!saved.clientId) {
      saved.clientId = uuid();
      await save({ clientId: saved.clientId });
    }
    setClientId(saved.clientId);
    const account = saved.accountToken ? await whoAmI(saved.accountToken) : null;
    if (!account) return signIn();
    await afterAccount(account);
  } catch (e) {
    fail(e);
  }
}

async function afterAccount(account: User): Promise<void> {
  setSession({ multiUser: false });
  if (!account.home) return useUser(account);
  const users = await homeUsers(saved.accountToken!);
  if (users.length < 2) return useUser(account);
  setSession({ multiUser: true, lastUser: saved.userUuid });
  // Automatic sign-in reuses the last profile token without asking for a PIN.
  // Reloads within the same app run also preserve the selected profile.
  const sameRun = !!saved.run && saved.userRun === saved.run;
  if ((saved.autoSignIn || sameRun) && saved.userUuid && saved.userToken) {
    const user = await whoAmI(saved.userToken);
    if (user && user.uuid === saved.userUuid) {
      if (saved.run && saved.userRun !== saved.run) {
        saved.userRun = saved.run;
        await save({ userRun: saved.run });
      }
      return useUser(user);
    }
  }
  setSession({ phase: 'users', users });
}

/** Wait for plex.tv/link authorization, renewing expired codes. */
export async function signIn(): Promise<void> {
  signin?.abort();
  const abort = (signin = new AbortController());
  await save({ accountToken: null, userUuid: null, userToken: null, userRun: null });
  try {
    while (!abort.signal.aborted) {
      const pin = await createPin();
      setSession({ phase: 'signin', pin });
      while (!abort.signal.aborted && Date.now() < pin.expiresAt - 5000) {
        await new Promise((r) => setTimeout(r, 2000));
        const token = await checkPin(pin, abort.signal).catch(() => null);
        if (!token) continue;
        saved.accountToken = token;
        await save({ accountToken: token });
        const account = await whoAmI(token);
        if (!account) throw new Error('plex.tv rejected the new sign-in');
        return afterAccount(account);
      }
    }
  } catch (e) {
    if (!abort.signal.aborted) fail(e);
  }
}

/** A wrong PIN throws PlexError for the picker to display. */
export async function pickUser(user: HomeUser, pin?: string): Promise<void> {
  const switched = await switchUser(saved.accountToken!, user, pin);
  saved.userUuid = switched.uuid;
  saved.userToken = switched.authToken;
  saved.userRun = saved.run;
  setSession({ lastUser: switched.uuid, picks: session.picks + 1 });
  await save({ userUuid: switched.uuid, userToken: switched.authToken, userRun: saved.run });
  // Return to Home because library access differs between profiles.
  tab({ screen: 'home' });
  await useUser(switched);
}

export async function changeUser(): Promise<void> {
  try {
    setSession({ phase: 'users', users: await homeUsers(saved.accountToken!) });
  } catch (e) {
    fail(e);
  }
}

/** Clear account and profile credentials, then request a new sign-in code. */
export function signOut(): Promise<void> {
  server = undefined;
  who = undefined;
  resources = [];
  setSession({ servers: [], serverId: undefined });
  saved = { clientId: saved.clientId, run: saved.run };
  return signIn();
}

/** Return from the profile picker to the existing library session. */
export function keepUser(): boolean {
  if (!server || session.phase !== 'users') return false;
  setSession({ phase: 'ready' });
  return true;
}

/** Retry the step that failed. */
export function retry(): Promise<void> {
  return again();
}

/** Switch servers and save the choice for this user after connection succeeds. */
export async function chooseServer(id: string): Promise<void> {
  if (!who || (id === session.serverId && session.phase === 'ready')) return;
  tab({ screen: 'home' });
  await useUser(who, id);
}

/** An explicit `want` disables fallback to other servers. */
async function useUser(user: User, want?: string): Promise<void> {
  const sameUser = who?.uuid === user.uuid;
  // Browse caches use server keys, so clear data from the previous profile.
  if (!sameUser) {
    invalidate();
    forgetWatchlist();
  }
  who = user;
  again = () => useUser(user, want);
  resetHomeReady();
  setSession({
    phase: 'connecting',
    error: undefined,
    connectingTo: undefined,
    user: { uuid: user.uuid, title: user.title, thumb: user.thumb },
  });
  try {
    if (!want || !resources.length || !sameUser) {
      resources = await servers(user.authToken);
      setSession('servers', resources.map(choiceOf));
    }
    if (!resources.length) throw new Error(t('start.noServer', { user: user.title }));
    server = want ? await connectTo(user, want) : await connectFirst(user, saved.servers?.[user.uuid]);
    if (want && saved.servers?.[user.uuid] !== server.id) {
      saved.servers = { ...saved.servers, [user.uuid]: server.id };
      await save({ servers: saved.servers });
    }
    // Configure the proxy with this server and its token for Kodi playback.
    await call({ cmd: 'media-source', base: server.uri, headers: { 'X-Plex-Token': server.token } });
    const [libraries, playlists] = await Promise.all([sections(server), playlistCount(server).catch(() => 0)]);
    console.log(`session: ${user.title} on ${server.name} via ${server.uri}`);
    setSession({ phase: 'ready', serverName: server.name, serverId: server.id, sections: libraries, playlists });
  } catch (e) {
    fail(e);
  }
}

/** Server choices shared by the account menu, Settings and error screen. */
export function serverOptions(): MenuOption<string>[] {
  return session.servers.map((s) => ({ label: s.owner ? `${s.name} · ${s.owner}` : s.name, value: s.id }));
}

function choiceOf(r: Resource): ServerChoice {
  return { id: r.clientIdentifier, name: r.name, owner: r.owned ? undefined : (r.sourceTitle ?? undefined) };
}

async function connectTo(user: User, id: string): Promise<Server> {
  const resource = resources.find((r) => r.clientIdentifier === id);
  if (!resource) throw new Error(t('start.serverGone'));
  setSession({ serverId: id, connectingTo: resource.name });
  try {
    return await connect(resource, user.authToken);
  } catch (e) {
    throw e instanceof Unreachable ? new Error(t('start.notAnswering', { server: resource.name })) : e;
  }
}

/** Try the saved server, then owned servers, then plex.tv's order. If the
 * first fails, probe the rest in parallel and take the highest-priority success. */
async function connectFirst(user: User, chosen: string | undefined): Promise<Server> {
  const rank = (r: Resource) => (r.clientIdentifier === chosen ? 0 : r.owned ? 1 : 2);
  const order = resources.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  const [first, ...rest] = order;
  try {
    return await connectTo(user, first.clientIdentifier);
  } catch (e) {
    if (!rest.length) throw e;
    console.warn(`session: ${e}; trying the others`);
  }
  setSession({ connectingTo: undefined });
  const attempts = rest.map((r) => connect(r, user.authToken).catch(() => undefined));
  for (const attempt of attempts) {
    const found = await attempt;
    if (found) {
      setSession({ serverId: found.id });
      notice(t('start.fellBack', { server: first.name, other: found.name }));
      return found;
    }
  }
  throw new Error(t('start.noneAnswering', { servers: order.map((r) => r.name).join(', ') }));
}
