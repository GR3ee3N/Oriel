// A Jellyfin server's users as an Account. The user picks a server found on
// the network or types its address; each person then signs in with Quick
// Connect, approving the code Dormer shows in a browser where they're signed
// in to the server, or with their user name and password. Servers can hide
// their user list, so the profiles are the users who signed in on this box,
// each with its own token; signing in again adds another.

import { runId } from '../bridge';
import { t } from '../i18n';
import type { Account, FoundServer, Profile } from '../media/account';
import { ServerError } from '../media/errors';
import { load, type Saved, save } from '../store';
import { JellyfinError, request, Server, type ServerInfo, setDeviceId } from './client';
import { jellyfinProvider } from './provider';

type SavedUser = NonNullable<Saved['users']>[number];

interface QuickConnect {
  Secret: string;
  Code: string;
  Authenticated: boolean;
}

interface Authenticated {
  AccessToken: string;
  User: { Id: string; Name: string; PrimaryImageTag?: string };
}

interface PublicUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  HasPassword: boolean;
}

/** Quick Connect codes last ten minutes on the server; start a new one before. */
const CODE_LIFE = 9 * 60_000;

/** Addresses to try for what the user typed: as given with a scheme,
 * otherwise HTTPS, then HTTP on Jellyfin's port. */
export function candidates(text: string): string[] {
  const typed = text.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(typed)) return [typed];
  if (/:\d+$/.test(typed)) return [`http://${typed}`, `https://${typed}`];
  return [`https://${typed}`, `http://${typed}:8096`, `http://${typed}`];
}

const profileOf = (u: SavedUser): Profile => ({ id: u.id, name: u.name, photo: u.photo });
const photoOf = (address: string, id: string, tag?: string) => (tag ? `${address}/Users/${id}/Images/Primary?tag=${tag}&maxHeight=240` : undefined);

export async function jellyfinAccount(clientId: string): Promise<Account> {
  setDeviceId(clientId);
  const saved = await load();
  let server = saved.server;
  let users: SavedUser[] = saved.users ?? [];
  let current: SavedUser | undefined;

  const keep = (changes: Pick<Saved, 'server' | 'users' | 'userId' | 'userRun'>) => save(changes);
  const use = async (user: SavedUser): Promise<Profile> => {
    current = user;
    await keep({ userId: user.id, userRun: await runId() });
    return profileOf(user);
  };
  /** Whether the server still accepts the user's token; forgets it when not. */
  const valid = async (user: SavedUser): Promise<boolean> => {
    try {
      await request(server!.address, '/Users/Me', { token: user.token });
      return true;
    } catch (e) {
      if (!(e instanceof ServerError) || e.status !== 401) throw e;
      users = users.filter((u) => u.id !== user.id);
      await keep({ users });
      return false;
    }
  };

  /** Keep the first address that answers as a Jellyfin server, as server
   * `id` when given; whether one did. */
  const reach = async (addresses: string[], id?: string): Promise<boolean> => {
    for (const address of addresses) {
      const info = await request<ServerInfo>(address, '/System/Info/Public', { timeout: 5000 }).catch(() => undefined);
      if (!info?.Id || (id && info.Id !== id)) continue;
      if (server?.id !== info.Id) users = [];
      server = { address, id: info.Id, name: info.ServerName };
      await keep({ server, users });
      return true;
    }
    return false;
  };
  /** Keep a signed-in user as a profile beside the others and use it. */
  const added = async (auth: Authenticated) => {
    const u = auth.User;
    const user: SavedUser = { id: u.Id, name: u.Name, token: auth.AccessToken };
    const photo = photoOf(server!.address, u.Id, u.PrimaryImageTag);
    if (photo) user.photo = photo;
    users = [...users.filter((x) => x.id !== user.id), user];
    await keep({ users });
    await use(user);
  };

  return {
    addsProfiles: true,
    address: {
      known: () => !!server,
      set: async (text) => {
        if (!(await reach(candidates(text)))) throw new Error(t('address.notFound', { address: text.trim() }));
      },
      choose: async (found: FoundServer) => {
        if (!(await reach(found.addresses, found.id))) throw new Error(t('start.notAnswering', { server: found.name }));
      },
    },
    password: {
      users: async () => {
        const at = server!.address;
        const list = await request<PublicUser[]>(at, '/Users/Public').catch(() => []);
        return list.map((u) => ({ id: u.Id, name: u.Name, photo: photoOf(at, u.Id, u.PrimaryImageTag), protected: u.HasPassword }));
      },
      signIn: async (name, password) => {
        await added(await request<Authenticated>(server!.address, '/Users/AuthenticateByName', { method: 'POST', body: { Username: name, Pw: password } }));
      },
    },
    restore: async () => {
      if (!server) return false;
      const last = users.find((u) => u.id === saved.userId) ?? users[0];
      if (last) await valid(last);
      return users.length > 0;
    },
    signIn: async (show, signal) => {
      const at = server!;
      // Without Quick Connect the sign-in screen offers only the password.
      if (!(await request<boolean>(at.address, '/QuickConnect/Enabled', { signal }))) {
        show({ code: '', title: t('start.signInTo', { server: at.name }), hint: '' });
        await new Promise((done) => signal.addEventListener('abort', done, { once: true }));
        return;
      }
      while (!signal.aborted) {
        const started = Date.now();
        let qc = await request<QuickConnect>(at.address, '/QuickConnect/Initiate', { method: 'POST', signal });
        show({ code: qc.Code, title: t('start.signInTo', { server: at.name }), hint: t('start.quickConnectHint', { server: at.name }) });
        while (!signal.aborted && Date.now() - started < CODE_LIFE) {
          await new Promise((r) => setTimeout(r, 2000));
          qc = await request<QuickConnect>(at.address, '/QuickConnect/Connect', { params: { secret: qc.Secret }, signal }).catch((e) => {
            // The server forgets an expired code; start a new one.
            if (e instanceof JellyfinError && (e.status === 404 || e.status === 401)) return { ...qc, Secret: '' };
            throw e;
          });
          if (!qc.Secret) break;
          if (!qc.Authenticated) continue;
          await added(await request<Authenticated>(at.address, '/Users/AuthenticateWithQuickConnect', { method: 'POST', body: { Secret: qc.Secret }, signal }));
          return;
        }
      }
    },
    signOut: async () => {
      if (current) {
        const gone = current;
        await request(server!.address, '/Sessions/Logout', { method: 'POST', token: gone.token }).catch(() => {});
        users = users.filter((u) => u.id !== gone.id);
        current = undefined;
        await save({ users, userId: null });
      }
    },
    profiles: async () => (users.length > 1 ? users.map(profileOf) : []),
    lastProfile: () => current?.id ?? saved.userId,
    useAccount: async () => {
      const only = users[0];
      if (!only) throw new Error(t('start.noUser'));
      return use(only);
    },
    resume: async (auto) => {
      const last = users.find((u) => u.id === (current?.id ?? saved.userId));
      const run = await runId();
      if (!last || !(auto || saved.userRun === run || current?.id === last.id)) return undefined;
      return use(last);
    },
    pick: async (profile) => {
      const user = users.find((u) => u.id === profile.id);
      if (!user || !(await valid(user))) throw new Error(t('start.signedOut', { user: profile.name }));
      return use(user);
    },
    servers: async () => (server ? [{ id: server.id, name: server.name }] : []),
    savedServer: () => server?.id,
    saveServer: async () => {},
    connect: async () => {
      if (!server || !current) throw new Error(t('start.serverGone'));
      return jellyfinProvider(new Server(server.address, server.id, server.name, current.id, current.token));
    },
  };
}
