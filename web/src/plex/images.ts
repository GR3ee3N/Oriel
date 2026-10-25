// Limit requested image dimensions to reduce transfer size and decoding work.

import type { Server } from './client';

/** Request a Plex thumbnail or artwork key transcoded to w×h pixels. */
export function imageUrl(server: Server, path: string, w: number, h: number): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, minSize: 1, upscale: 1 });
}

/** Fit a clearLogo inside w×h pixels as a transparent PNG. */
export function logoUrl(server: Server, path: string, w: number, h: number): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, format: 'png' });
}

/** Extract the clearLogo URL supplied by includeImages. */
export function logoOf(m: { Image?: { type: string; url: string }[] } | undefined): string | undefined {
  return m?.Image?.find((i) => i.type === 'clearLogo')?.url;
}

const MAX = 200;
const cache = new Map<string, HTMLImageElement>();

/** Wait for a decode attempt without rejecting on failure. Retain images
 * in an LRU cache so nearby items can reuse decoded artwork. `cors` matches
 * the request the backdrop painter makes, so it reuses the response. */
export function preload(url: string, cors = false): Promise<void> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return hit.decode().catch(() => {});
  }
  const img = new Image();
  if (cors) img.crossOrigin = 'anonymous';
  img.src = url;
  cache.set(url, img);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return img.decode().catch(() => {});
}
