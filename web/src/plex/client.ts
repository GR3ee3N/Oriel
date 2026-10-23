// Requests to plex.tv and Plex servers.
// Put X-Plex-* identity in the query string so GET and POST requests with
// only an Accept header avoid CORS preflights and their extra round trip.
// Never log tokens: the page's console is captured in shell.log.

import type { MediaContainer } from './types';

export const PRODUCT = 'Oriel';
export const VERSION: string = import.meta.env.VITE_APP_VERSION;
const PLEX_TV = 'https://plex.tv';

let clientId = '';

/** Set the installation's persistent X-Plex-Client-Identifier from the add-on store. */
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
  /** Request timeout in milliseconds; defaults to 15000. */
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

/** Plex server using the highest-priority reachable connection from discovery.ts. */
export class Server {
  constructor(
    readonly name: string,
    readonly id: string,
    readonly uri: string,
    readonly token: string,
    /** Selects the local or remote playback quality preference. */
    readonly local: boolean,
  ) {}

  async get<T = never>(path: string, params?: RequestOptions['params']): Promise<MediaContainer<T>> {
    const body = await request<{ MediaContainer: MediaContainer<T> }>(this.uri + path, { token: this.token, params });
    return body.MediaContainer;
  }

  /** Check HTTP success without parsing the response body, for commands such
   * as timeline reports, watched-state updates and track selection. */
  async call(path: string, params: RequestOptions['params'] = {}, method: RequestOptions['method'] = 'GET'): Promise<void> {
    const url = withParams(this.uri + path, { ...params, ...identity(this.token) });
    const response = await fetch(url, { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new PlexError(response.status, `${method} ${path}: HTTP ${response.status}`);
  }

  /** Include the token in a URL for elements such as <img>. */
  url(path: string, params: Record<string, string | number | undefined> = {}): string {
    return withParams(this.uri + path, { ...params, 'X-Plex-Token': this.token });
  }
}
