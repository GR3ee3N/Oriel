// Requests to a Jellyfin server. Requests name this installation in an
// `Authorization: MediaBrowser …` header, with the user's token once signed
// in. That header makes WebKit ask the server first (a CORS preflight), and
// the server doesn't let it remember the answer, so a signed-in GET carries
// the token as the `ApiKey` parameter instead, and goes out without one;
// a server that refuses `ApiKey` gets the header from then on. Never log
// tokens: the page's console is captured in shell.log.

import { PRODUCT, VERSION } from '../app';
import { ServerError } from '../media/errors';

let deviceId = '';

/** Set the installation's persistent device id from the add-on store. */
export function setDeviceId(id: string): void {
  deviceId = id;
}

const quote = (v: string) => `"${v.replace(/"/g, '')}"`;

/** The identity header, with `token` once a user is signed in. */
export function authorization(token?: string): string {
  const fields = { Client: PRODUCT, Device: 'Kodi', DeviceId: deviceId, Version: VERSION, ...(token ? { Token: token } : {}) };
  return `MediaBrowser ${Object.entries(fields)
    .map(([k, v]) => `${k}=${quote(v)}`)
    .join(', ')}`;
}

export class JellyfinError extends ServerError {}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  token?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Request timeout in milliseconds; defaults to 15000. */
  timeout?: number;
}

/** The server refused `ApiKey`; send the header on every request. */
let headerOnly = false;

export async function request<T>(base: string, path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const byKey = method === 'GET' && !!options.token && !headerOnly;
  try {
    return await send<T>(base, path, options, byKey);
  } catch (e) {
    if (!byKey || !(e instanceof JellyfinError) || e.status !== 401) throw e;
    // A revoked token fails both ways; only a header that works switches over.
    const answer = await send<T>(base, path, options, false);
    headerOnly = true;
    return answer;
  }
}

async function send<T>(base: string, path: string, options: RequestOptions, byKey: boolean): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeout ?? 15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(options.params ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (byKey) url.searchParams.set('ApiKey', options.token!);
  else headers.Authorization = authorization(options.token);
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = options.method ?? 'GET';
  const response = await fetch(url, { method, headers, signal, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  if (!response.ok) throw new JellyfinError(response.status, `${method} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** What /System/Info/Public says about a server. */
export interface ServerInfo {
  Id: string;
  ServerName: string;
  Version: string;
  LocalAddress?: string;
}

/** A Jellyfin server with a signed-in user. */
export class Server {
  constructor(
    readonly address: string,
    readonly id: string,
    readonly name: string,
    readonly userId: string,
    readonly token: string,
  ) {}

  /** Selects the local or remote playback quality preference. */
  get local(): boolean {
    const host = new URL(this.address).hostname;
    return host === 'localhost' || host.endsWith('.local') || /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^\[?f[cd]/i.test(host);
  }

  /** This installation's device id, which names its conversions. */
  get deviceId(): string {
    return deviceId;
  }

  /** A URL the page can load without headers, such as an image that needs the token. */
  url(path: string, params: RequestOptions['params'] = {}): string {
    const url = new URL(this.address + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set('ApiKey', this.token);
    return url.toString();
  }

  get<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return request<T>(this.address, path, { token: this.token, params });
  }

  send<T = void>(method: 'POST' | 'DELETE', path: string, body?: unknown, params?: RequestOptions['params']): Promise<T> {
    return request<T>(this.address, path, { method, token: this.token, body, params });
  }
}
