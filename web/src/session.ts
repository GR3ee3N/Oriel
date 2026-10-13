// Who is signed in and which server we talk to: from start-up through the
// plex.tv/link code and the Home user picker to a connected server.
//
//   loading → signin (no or rejected account token)
//           → users (a Home with several users, at every start of the
//             app unless it signs in automatically)
//           → connecting → ready
//   any step → error (with a retry)
//
// A user with several servers gets the one they chose last (per user),
// else one of their own, else the first plex.tv lists; one that doesn't
// answer is passed over for the next that does. Another can be chosen in
// the top bar's account menu, in Settings, and on the error screen.

import { createStore } from 'solid-js/store';
import { call } from './bridge';
import { tab } from './router';
import { checkPin, createPin, homeUsers, type Pin, switchUser, whoAmI } from './plex/auth';
import { type Server, setClientId } from './plex/client';
import { connect, servers, Unreachable } from './plex/discovery';
import { invalidate, sections } from './plex/api';
import type { Directory, HomeUser, Resource, User } from './plex/types';
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
  /** The user's servers, and the one connected (or being connected). */
  servers: ServerChoice[];
  serverId?: string;
  /** The Home has several users (Settings offers signing in automatically). */
  multiUser: boolean;
  /** The user picker's focus: the last user. */
  lastUser?: string;
  serverName?: string;
  /** While connecting: to which server. */
  connectingTo?: string;
  /** The movie and show libraries, for the top bar. */
  sections: Directory[];
  error?: string;
}

export interface ServerChoice {
  id: string;
  name: string;
  /** Whose it is, for a server shared with the user. */
  owner?: string;
}

const [session, setSession] = createStore<Session>({
  phase: 'loading',
  users: [],
  servers: [],
  sections: [],
  multiUser: false,
});
export { session };

let saved: Saved = {};
let server: Server | undefined;
/** The user connected or being connected, for choosing another server. */
let who: User | undefined;
let resources: Resource[] = [];
/** What Try again on the error screen does. */
let again: () => Promise<void> = () => start();
let signin: AbortController | undefined;

/** The connected server; only valid in the 'ready' phase. */
export function currentServer(): Server {
  if (!server) throw new Error('no server');
  return server;
}

function fail(e: unknown): void {
  console.error(`session: ${e}`);
  setSession({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
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
  // Every start of the app asks who is watching, as in Plex's own apps,
  // unless it signs in automatically: then the last user carries on,
  // without a PIN. So does a page loaded again in the same start (the
  // shell restarted).
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

/** Shows a plex.tv/link code and waits for it to be entered, renewing
 * the code when it expires. */
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

/** Throws PlexError on a wrong PIN, for the caller to show. */
export async function pickUser(user: HomeUser, pin?: string): Promise<void> {
  const switched = await switchUser(saved.accountToken!, user, pin);
  saved.userUuid = switched.uuid;
  saved.userToken = switched.authToken;
  saved.userRun = saved.run;
  setSession({ lastUser: switched.uuid });
  await save({ userUuid: switched.uuid, userToken: switched.authToken, userRun: saved.run });
  // Another user can see other libraries: start again from Home.
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

/** Forgets the account and the user, and shows a new plex.tv/link code. */
export function signOut(): Promise<void> {
  server = undefined;
  who = undefined;
  resources = [];
  setSession({ servers: [], serverId: undefined });
  saved = { clientId: saved.clientId, run: saved.run };
  return signIn();
}

/** Back out of the user picker to the library, if one was open. */
export function keepUser(): boolean {
  if (!server || session.phase !== 'users') return false;
  setSession({ phase: 'ready' });
  return true;
}

/** The error screen's Try again: what failed, once more. */
export function retry(): Promise<void> {
  return again();
}

/** Connects to another of the user's servers (the account menu, Settings,
 * the error screen); it is remembered for the user once it answers. */
export async function chooseServer(id: string): Promise<void> {
  if (!who || (id === session.serverId && session.phase === 'ready')) return;
  tab({ screen: 'home' });
  await useUser(who, id);
}

/** `want`: a server the user chose, which is not passed over. */
async function useUser(user: User, want?: string): Promise<void> {
  const sameUser = who?.uuid === user.uuid;
  // Cached browse data is the last user's (keyed by server only).
  if (!sameUser) invalidate();
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
    if (!resources.length) throw new Error(`No Plex server is shared with ${user.title}.`);
    server = want ? await connectTo(user, want) : await connectFirst(user, saved.servers?.[user.uuid]);
    if (want && saved.servers?.[user.uuid] !== server.id) {
      saved.servers = { ...saved.servers, [user.uuid]: server.id };
      await save({ servers: saved.servers });
    }
    // Kodi plays through the add-on's proxy to this server.
    await call({ cmd: 'media-source', base: server.uri, headers: { 'X-Plex-Token': server.token } });
    const libraries = await sections(server);
    console.log(`session: ${user.title} on ${server.name} via ${server.uri}`);
    setSession({ phase: 'ready', serverName: server.name, serverId: server.id, sections: libraries });
  } catch (e) {
    fail(e);
  }
}

/** The user's servers as menu options (the account menu, Settings, the
 * error screen). */
export function serverOptions(): MenuOption<string>[] {
  return session.servers.map((s) => ({ label: s.owner ? `${s.name} · ${s.owner}` : s.name, value: s.id }));
}

function choiceOf(r: Resource): ServerChoice {
  return { id: r.clientIdentifier, name: r.name, owner: r.owned ? undefined : (r.sourceTitle ?? undefined) };
}

async function connectTo(user: User, id: string): Promise<Server> {
  const resource = resources.find((r) => r.clientIdentifier === id);
  if (!resource) throw new Error('That server is no longer shared with you.');
  setSession({ serverId: id, connectingTo: resource.name });
  try {
    return await connect(resource, user.authToken);
  } catch (e) {
    throw e instanceof Unreachable ? new Error(`${resource.name} is not answering.`) : e;
  }
}

/** The chosen server, else the user's own, else plex.tv's order; when the
 * first doesn't answer, all the others are tried at once and the first of
 * them in that order that answers is taken. */
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
      notice(`${first.name} is not answering. Showing ${found.name}.`);
      return found;
    }
  }
  throw new Error(`None of your servers is answering (${order.map((r) => r.name).join(', ')}).`);
}
