// Jellyfin requests the provider makes, kept briefly in the shared cache, and
// image URLs. Lists ask for few fields; details ask for files, tracks,
// people and chapters.

import { createCache } from '../media/cache';
import type { ArtRef } from '../media/model';
import type { Server } from './client';

const { cached, clear: invalidate } = createCache();

export { invalidate };

/** Fields for tiles & rows: images, counts and what the hero shows. */
export const LIST = 'ImageBlurHashes,ChildCount,RecursiveItemCount,Overview,Genres';
/** Fields for a detail page. */
export const DETAIL = `${LIST},People,Studios,Taglines,MediaSources,MediaStreams,Chapters,Trickplay`;

/** A GET for the signed-in user, from the cache when it's fresh. */
export function get<T>(server: Server, path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const query = { userId: server.userId, ...params };
  return cached(`${server.id}/${server.userId}${path}?${JSON.stringify(query)}`, () => server.get<T>(path, query));
}

/** An image at w×h. `logo` keeps a logo's shape and transparency inside the
 * size; `blur` hides a spoiler. Jellyfin serves images without a token. */
export function imageUrl(server: Server, ref: ArtRef, w: number, h: number, o: { blur?: boolean; logo?: boolean } = {}): string {
  const parts = ref.split('/');
  const [id, type] = parts;
  const tag = parts[parts.length - 1];
  const index = parts.length === 4 ? `/${parts[2]}` : '';
  const url = new URL(`${server.address}/Items/${id}/Images/${type}${index}`);
  url.searchParams.set('tag', tag);
  if (o.logo) {
    url.searchParams.set('maxWidth', String(w));
    url.searchParams.set('maxHeight', String(h));
  } else {
    url.searchParams.set('fillWidth', String(w));
    url.searchParams.set('fillHeight', String(h));
  }
  url.searchParams.set('quality', '90');
  if (o.blur) url.searchParams.set('blur', '30');
  return url.toString();
}
