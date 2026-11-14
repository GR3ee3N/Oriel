// Decoded images kept for reuse, so nearby items show their artwork at once.

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
