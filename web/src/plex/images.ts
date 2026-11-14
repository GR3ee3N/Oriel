// Plex image URLs at the requested size, which limits transfer size and
// decoding work.

import type { Server } from './client';

/** Request a Plex thumbnail or artwork key transcoded to w×h pixels. */
export function imageUrl(server: Server, path: string, w: number, h: number, blur = false): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, minSize: 1, upscale: 1, ...(blur ? { blur: 16 } : {}) });
}

/** Fit a clearLogo inside w×h pixels as a transparent PNG. */
export function logoUrl(server: Server, path: string, w: number, h: number): string {
  return server.url('/photo/:/transcode', { url: path, width: w, height: h, format: 'png' });
}
