// Signing in to a server's account, choosing a profile and connecting to a
// server it can use. Each server kind's adapter implements Account;
// media/servers.ts makes the one in use.

import type { Provider } from './provider';

/** A code the user enters on another device to sign in. */
export interface SignInCode {
  code: string;
  /** The sign-in screen's heading, e.g. "Sign in to Plex". */
  title: string;
  /** Where to enter the code, as a sentence. */
  hint: string;
}

/** A person who watches with their own progress and settings. */
export interface Profile {
  id: string;
  name: string;
  photo?: string;
  /** Switching to it asks for a PIN. */
  protected?: boolean;
}

/** A server that answered discovery on the box's network. */
export interface FoundServer {
  id: string;
  name: string;
  /** Addresses to try in order. */
  addresses: string[];
}

export interface ServerChoice {
  id: string;
  name: string;
  /** Owner name for a server someone else shares. */
  owner?: string;
}

export interface Account {
  /** For accounts that live on one server, which the user names first. */
  address?: {
    /** Whether a server is saved. */
    known(): boolean;
    /** Check that `text` reaches a server and keep it; throws a sentence
     * when it doesn't. */
    set(text: string): Promise<void>;
    /** Keep a server found on the network, at the first of its addresses
     * that answers as that server; throws a sentence when none does. */
    choose(server: FoundServer): Promise<void>;
  };
  /** `signIn` adds a profile beside the saved ones, so the picker offers it. */
  addsProfiles?: boolean;
  /** Whether the saved sign-in still holds. */
  restore(): Promise<boolean>;
  /** Show codes until the user enters one, renewing expired codes; resolves
   * once signed in. */
  signIn(show: (code: SignInCode) => void, signal: AbortSignal): Promise<void>;
  /** Forget the sign-in and its profile. */
  signOut(): Promise<void>;
  /** Profiles to pick from; fewer than two means there is nothing to pick. */
  profiles(): Promise<Profile[]>;
  /** The profile last picked, for the picker's focus. */
  lastProfile(): string | undefined;
  /** Use the account's own profile, for accounts with nothing to pick. */
  useAccount(): Promise<Profile>;
  /** The last profile, when it can be used without asking: within the same
   * run of the add-on, or always with `auto`. */
  resume(auto: boolean): Promise<Profile | undefined>;
  /** Switch to `profile`; a wrong PIN throws ServerError 401 or 403. */
  pick(profile: Profile, pin?: string): Promise<Profile>;
  /** Servers the current profile can use, in the account service's order;
   * a server without an owner is the account's own. */
  servers(): Promise<ServerChoice[]>;
  /** The server last chosen by the current profile. */
  savedServer(): string | undefined;
  saveServer(id: string): Promise<void>;
  /** Connect the current profile to a server; throws Unreachable when none of
   * its addresses answer. */
  connect(id: string): Promise<Provider>;
}
