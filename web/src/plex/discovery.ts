// Discover servers through plex.tv and probe their addresses at /identity
// in parallel. Addresses can include unreachable Docker bridges or subnets.
// Prefer local HTTP when allowed to reduce TLS work on the box, then local
// advertised connections, remote connections and Plex relay. Verify the
// machineIdentifier because a private address can reach a different server.

import { PlexError, request, plexTv, Server } from './client';
import type { Resource } from './types';

export async function servers(token: string): Promise<Resource[]> {
  // Retry transient failures after sign-in or profile changes. plex.tv can
  // return HTTP 429 without CORS headers, which appears as a network failure.
  for (const wait of [2000, 5000, 0]) {
    try {
      const all = await plexTv<Resource[]>('/api/v2/resources', {
        token,
        params: { includeHttps: 1, includeRelay: 1, includeIPv6: 1 },
      });
      return all.filter((r) => r.provides.split(',').includes('server'));
    } catch (e) {
      const passing = e instanceof TypeError || (e instanceof PlexError && (e.status === 429 || e.status >= 500));
      if (!passing || !wait) throw e;
      console.warn(`discovery: ${e}; trying again in ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

interface Candidate {
  uri: string;
  rank: number;
}

function candidates(resource: Resource): Candidate[] {
  const out: Candidate[] = [];
  for (const c of resource.connections) {
    if (c.relay) out.push({ uri: c.uri, rank: 4 });
    else if (!c.local) out.push({ uri: c.uri, rank: 3 });
    else {
      if (!resource.httpsRequired && !c.IPv6) out.push({ uri: `http://${c.address}:${c.port}`, rank: 1 });
      out.push({ uri: c.uri, rank: 2 });
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.uri) && seen.add(c.uri)).sort((a, b) => a.rank - b.rank);
}

export class Unreachable extends Error {}

/** Resolve the preferred reachable connection, or reject with Unreachable. */
export function connect(resource: Resource, userToken: string, signal?: AbortSignal): Promise<Server> {
  const token = resource.accessToken ?? userToken;
  const list = candidates(resource);
  return new Promise((resolve, reject) => {
    const answered: (Candidate | null)[] = list.map(() => null);
    const settled = list.map(() => false);
    let done = false;
    const decide = () => {
      if (done) return;
      // Wait only for higher-priority probes; equal ranks can resolve immediately.
      const pending = Math.min(...list.map((c, i) => (settled[i] ? Infinity : c.rank)));
      const best = answered.reduce<Candidate | null>((b, c) => (c && (!b || c.rank < b.rank) ? c : b), null);
      if (best && best.rank <= pending) {
        done = true;
        resolve(new Server(resource.name, resource.clientIdentifier, best.uri, token, best.rank <= 2));
      } else if (pending === Infinity) {
        done = true;
        reject(new Unreachable(`${resource.name}: none of ${list.length} connections answered`));
      }
    };
    list.forEach((c, i) => {
      request<{ MediaContainer: { machineIdentifier: string } }>(`${c.uri}/identity`, {
        token,
        signal,
        timeout: c.rank === 4 ? 10000 : 5000,
      })
        .then((r) => {
          if (r.MediaContainer.machineIdentifier === resource.clientIdentifier) answered[i] = c;
        })
        .catch(() => {})
        .finally(() => {
          settled[i] = true;
          decide();
        });
    });
    if (!list.length) decide();
  });
}
