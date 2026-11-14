// The account in use and the server it's connected to. The only module
// that loads a server's adapter; each build loads one (app.ts).

import type { Account } from './account';
import type { Provider } from './provider';

let current: Provider | undefined;

/** The account the saved sign-in belongs to. `clientId` names this
 * installation to the server. */
export async function account(clientId: string): Promise<Account> {
  // A constant in each build, so the bundle leaves the other adapter out.
  if (import.meta.env.VITE_SERVER === 'jellyfin') return (await import('../jellyfin/account')).jellyfinAccount(clientId);
  return (await import('../plex/account')).plexAccount(clientId);
}

/** Valid only while the session is 'ready'. */
export function provider(): Provider {
  if (!current) throw new Error('no server');
  return current;
}

/** Set by the session once it connects; undefined after signing out. */
export function setProvider(p: Provider | undefined): void {
  current = p;
}

/** Drop cached replies from the server, if one is connected. */
export function invalidate(): void {
  current?.invalidate();
}
