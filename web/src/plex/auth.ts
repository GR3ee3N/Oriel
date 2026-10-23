// Sign in through plex.tv/link and select Plex Home profiles.
// Authorizing the TV's four-character code yields an account token, saved
// through store.ts. Use it to switch profiles; use each profile's token
// for requests to Plex servers.

import { PlexError, plexTv } from './client';
import type { HomeUser, User } from './types';

export interface Pin {
  id: number;
  code: string;
  /** Expiry timestamp in milliseconds since the Unix epoch. */
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

/** Return the account token after authorization, or null while waiting. */
export async function checkPin(pin: Pin, signal?: AbortSignal): Promise<string | null> {
  const r = await plexTv<PinResponse>(`/api/v2/pins/${pin.id}`, { params: { code: pin.code }, signal });
  return r.authToken || null;
}

/** Resolve a token to its account or profile; return null on HTTP 401. */
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

/** Switch Plex Home profiles, passing `pin` for protected profiles.
 * A wrong PIN throws PlexError with HTTP 401 or 403. */
export function switchUser(accountToken: string, user: HomeUser, pin?: string): Promise<User> {
  return plexTv<User>(`/api/v2/home/users/${user.uuid}/switch`, {
    method: 'POST',
    token: accountToken,
    params: { pin },
  });
}
