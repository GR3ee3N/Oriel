// Request bounded image dimensions to reduce transfer and decoding work.

import type { Server } from './client';

/** A transcoded image of `path` (a thumb or art key) at w×h pixels. */
export function imageUrl(server: Server, path: string, w: number, h: number): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, minSize: 1, upscale: 1 });
}

/** A logo (clearLogo, with transparency) fitted inside w×h, as PNG. */
export function logoUrl(server: Server, path: string, w: number, h: number): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, format: 'png' });
}

/** The item's title logo, if it has one (includeImages). */
export function logoOf(m: { Image?: { type: string; url: string }[] } | undefined): string | undefined {
  return m?.Image?.find((i) => i.type === 'clearLogo')?.url;
}

const MAX = 200;
const cache = new Map<string, HTMLImageElement>();

/** Resolves after the decode attempt, including failures. Cached images stay
 * alive so nearby items can reuse them. */
export function preload(url: string): Promise<void> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return hit.decode().catch(() => {});
  }
  const img = new Image();
  img.src = url;
  cache.set(url, img);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return img.decode().catch(() => {});
}
