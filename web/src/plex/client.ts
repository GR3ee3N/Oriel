// Requests to plex.tv and to Plex servers.
//
// The X-Plex-* identity goes in the query string, not in headers: with only
// `Accept` as a header every GET or POST stays a CORS "simple request", so
// the browser never sends a preflight (both plex.tv and the server allow
// our origin, but a preflight would cost a round trip per new URL).
//
// Tokens never go to the console: the page's console ends up in shell.log.

import type { MediaContainer } from './types';

export const PRODUCT = 'Oriel';
export const VERSION: string = import.meta.env.VITE_APP_VERSION;
const PLEX_TV = 'https://plex.tv';

let clientId = '';

/** Our X-Plex-Client-Identifier: one per install, kept in the add-on's store. */
export function setClientId(id: string): void {
  clientId = id;
}

export function identity(token?: string): Record<string, string> {
  const params: Record<string, string> = {
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Platform': 'CoreELEC',
    'X-Plex-Device': 'CoreELEC',
    'X-Plex-Device-Name': 'Oriel',
  };
  if (token) params['X-Plex-Token'] = token;
  return params;
}

export class PlexError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  token?: string;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Milliseconds; default 15 s. */
  timeout?: number;
}

export function withParams(url: string, params: Record<string, string | number | boolean | undefined>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeout ?? 15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const full = withParams(url, { ...options.params, ...identity(options.token) });
  const response = await fetch(full, { method: options.method ?? 'GET', headers: { Accept: 'application/json' }, signal });
  const path = new URL(url).pathname;
  if (!response.ok) throw new PlexError(response.status, `${options.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function plexTv<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(PLEX_TV + path, options);
}

/** A Plex server on the connection that answered best (discovery.ts). */
export class Server {
  constructor(
    readonly name: string,
    readonly id: string,
    readonly uri: string,
    readonly token: string,
    /** On the local network (decides the quality setting that applies). */
    readonly local: boolean,
  ) {}

  async get<T = never>(path: string, params?: RequestOptions['params']): Promise<MediaContainer<T>> {
    const body = await request<{ MediaContainer: MediaContainer<T> }>(this.uri + path, { token: this.token, params });
    return body.MediaContainer;
  }

  /** A request whose answer doesn't matter beyond success (timeline,
   * scrobble, stream choice); the body is not parsed. */
  async call(path: string, params: RequestOptions['params'] = {}, method: RequestOptions['method'] = 'GET'): Promise<void> {
    const url = withParams(this.uri + path, { ...params, ...identity(this.token) });
    const response = await fetch(url, { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new PlexError(response.status, `${method} ${path}: HTTP ${response.status}`);
  }

  /** A URL with the token, for <img> and the like. */
  url(path: string, params: Record<string, string | number | undefined> = {}): string {
    return withParams(this.uri + path, { ...params, 'X-Plex-Token': this.token });
  }
}
