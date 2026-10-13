// Signing in with a plex.tv/link code, and Plex Home users.
//
// The TV shows a 4-character code; the user enters it at plex.tv/link on a
// phone or computer, and the PIN we created turns into an account token.
// That account token is kept (store.ts) and is what switches between Home
// users; each user's own token is what talks to servers.

import { PlexError, plexTv } from './client';
import type { HomeUser, User } from './types';

export interface Pin {
  id: number;
  code: string;
  /** Date.now() milliseconds. */
  expiresAt: number;
}

interface PinResponse {
  id: number;
  code: string;
  authToken: string | null;
  expiresIn: number;
}

export async function createPin(): Promise<Pin> {
  const pin = await plexTv<PinResponse>('/api/v2/pins', { method: 'POST', params: { strong: false } });
  return { id: pin.id, code: pin.code, expiresAt: Date.now() + pin.expiresIn * 1000 };
}

/** The account token once the code has been entered, else null. */
export async function checkPin(pin: Pin, signal?: AbortSignal): Promise<string | null> {
  const r = await plexTv<PinResponse>(`/api/v2/pins/${pin.id}`, { params: { code: pin.code }, signal });
  return r.authToken || null;
}

/** The account or user behind a token; null if plex.tv rejects the token. */
export async function whoAmI(token: string): Promise<User | null> {
  try {
    return await plexTv<User>('/api/v2/user', { token });
  } catch (e) {
    if (e instanceof PlexError && e.status === 401) return null;
    throw e;
  }
}

export async function homeUsers(accountToken: string): Promise<HomeUser[]> {
  const r = await plexTv<{ users: HomeUser[] }>('/api/v2/home/users', { token: accountToken });
  return r.users;
}

/** Switches to a Home user; `pin` for protected users. Throws PlexError
 * (403 or 401) for a wrong PIN. */
export function switchUser(accountToken: string, user: HomeUser, pin?: string): Promise<User> {
  return plexTv<User>(`/api/v2/home/users/${user.uuid}/switch`, {
    method: 'POST',
    token: accountToken,
    params: { pin },
  });
}
