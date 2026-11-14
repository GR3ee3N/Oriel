// A plex.tv account as an Account: sign-in through plex.tv/link, Plex Home
// profiles and server discovery. It saves the account token, the last
// profile and its token, the add-on run it was picked in, and each
// profile's last server.

import { runId } from '../bridge';
import { t } from '../i18n';
import type { Account, Profile, ServerChoice } from '../media/account';
import { load, type Saved, save } from '../store';
import { invalidate } from './api';
import { checkPin, createPin, homeUsers, switchUser, whoAmI } from './auth';
import { setClientId } from './client';
import { connect, servers } from './discovery';
import { plexProvider } from './provider';
import type { HomeUser, Resource, User } from './types';
import { forgetWatchlist } from './watchlist';

interface PlexSaved {
  accountToken?: string;
  userUuid?: string;
  userToken?: string;
  /** Add-on run id in which the profile was picked. */
  userRun?: string;
  /** Last server for each profile UUID. */
  servers?: Record<string, string>;
}

const FIELDS = ['accountToken', 'userUuid', 'userToken', 'userRun', 'servers'] as const;

/** The signed-in profile, whose token reaches its servers and plex.tv. */
let who: User | undefined;

/** plex.tv token of the signed-in profile, for account features such as
 * the Watchlist. Valid only while a profile is in use. */
export function profileToken(): string {
  if (!who) throw new Error('no profile');
  return who.authToken;
}

/** The account's state from the store. */
function loadSaved(all: Saved): PlexSaved {
  const out: PlexSaved = {};
  for (const key of FIELDS) if (all[key] !== undefined) Object.assign(out, { [key]: all[key] });
  return out;
}

const profileOf = (u: HomeUser | User): Profile => ({ id: u.uuid, name: u.title, photo: u.thumb, protected: 'protected' in u ? u.protected : undefined });

export async function plexAccount(clientId: string): Promise<Account> {
  setClientId(clientId);
  let saved = loadSaved(await load());
  let account: User | null = null;
  let home: HomeUser[] = [];
  let resources: Resource[] = [];

  const keep = async (changes: Partial<PlexSaved>) => {
    saved = { ...saved, ...changes };
    await save(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v ?? null])));
  };
  /** Use `user`; caches hold another profile's replies. */
  const use = (user: User): Profile => {
    if (who?.uuid !== user.uuid) {
      invalidate();
      forgetWatchlist();
    }
    who = user;
    return profileOf(user);
  };

  return {
    restore: async () => {
      account = saved.accountToken ? await whoAmI(saved.accountToken) : null;
      return !!account;
    },
    signIn: async (show, signal) => {
      account = null;
      await keep({ accountToken: undefined, userUuid: undefined, userToken: undefined, userRun: undefined });
      while (!signal.aborted) {
        const pin = await createPin();
        show({ code: pin.code, title: t('start.signIn'), hint: t('start.signInHint', { site: 'plex.tv/link' }) });
        while (!signal.aborted && Date.now() < pin.expiresAt - 5000) {
          await new Promise((r) => setTimeout(r, 2000));
          const token = await checkPin(pin, signal).catch(() => null);
          if (!token) continue;
          await keep({ accountToken: token });
          account = await whoAmI(token);
          if (!account) throw new Error('plex.tv rejected the new sign-in');
          return;
        }
      }
    },
    signOut: async () => {
      account = null;
      who = undefined;
      resources = [];
      saved = {};
      await save(Object.fromEntries(FIELDS.map((k) => [k, null])));
    },
    profiles: async () => {
      if (!account?.home) return [];
      home = await homeUsers(saved.accountToken!);
      return home.map(profileOf);
    },
    lastProfile: () => saved.userUuid,
    useAccount: async () => use(account!),
    resume: async (auto) => {
      // A reload within the same add-on run keeps the profile in use.
      const run = await runId();
      const sameRun = saved.userRun === run;
      if (!(auto || sameRun) || !saved.userUuid || !saved.userToken) return undefined;
      const user = await whoAmI(saved.userToken);
      if (!user || user.uuid !== saved.userUuid) return undefined;
      if (!sameRun) await keep({ userRun: run });
      return use(user);
    },
    pick: async (profile, pin) => {
      const user = home.find((u) => u.uuid === profile.id);
      if (!user) throw new Error(`no profile ${profile.name}`);
      const switched = await switchUser(saved.accountToken!, user, pin);
      await keep({ userUuid: switched.uuid, userToken: switched.authToken, userRun: await runId() });
      return use(switched);
    },
    servers: async () => {
      if (!who) throw new Error('no profile');
      resources = await servers(who.authToken);
      return resources.map((r): ServerChoice => ({ id: r.clientIdentifier, name: r.name, owner: r.owned ? undefined : (r.sourceTitle ?? undefined) }));
    },
    savedServer: () => (who ? saved.servers?.[who.uuid] : undefined),
    saveServer: async (id) => {
      if (who && saved.servers?.[who.uuid] !== id) await keep({ servers: { ...saved.servers, [who.uuid]: id } });
    },
    connect: async (id) => {
      const resource = resources.find((r) => r.clientIdentifier === id);
      if (!resource || !who) throw new Error(t('start.serverGone'));
      return plexProvider(await connect(resource, who.authToken));
    },
  };
}
