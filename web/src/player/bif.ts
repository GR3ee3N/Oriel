// Plex's preview thumbnails (BIF: Roku's "base index frames"), for the
// scrubber. One file per part holds a JPEG every few seconds:
//
//   0   magic 89 42 49 46 0d 0a 1a 0a
//   8   version, u32 LE
//   12  number of frames, u32 LE
//   16  timestamp multiplier in ms, u32 LE (0 means 1000)
//   64  index: (timestamp u32, offset u32) per frame, then a terminator
//       whose offset is the end of the last frame
//
// The file is several MB, so it is fetched once, on the first scrub, and
// frames become object URLs only when shown (a few kept, the rest revoked).

import type { Server } from '../plex/client';

const KEEP = 12;

export class Bif {
  private urls = new Map<number, string>();

  private constructor(
    private data: ArrayBuffer,
    private times: Uint32Array,
    private offsets: Uint32Array,
    private interval: number,
  ) {}

  static async load(server: Server, partId: number): Promise<Bif | undefined> {
    const r = await fetch(server.url(`/library/parts/${partId}/indexes/sd`));
    if (!r.ok) return undefined;
    const data = await r.arrayBuffer();
    const view = new DataView(data);
    if (data.byteLength < 64 || view.getUint32(0) !== 0x89424946) return undefined;
    const count = view.getUint32(12, true);
    const interval = view.getUint32(16, true) || 1000;
    const times = new Uint32Array(count);
    const offsets = new Uint32Array(count + 1);
    for (let i = 0; i <= count; i++) {
      if (i < count) times[i] = view.getUint32(64 + i * 8, true);
      offsets[i] = view.getUint32(64 + i * 8 + 4, true);
    }
    return new Bif(data, times, offsets, interval);
  }

  /** The frame at or before `seconds`, as an image URL. */
  frameAt(seconds: number): string | undefined {
    const t = (seconds * 1000) / this.interval;
    let lo = 0;
    let hi = this.times.length - 1;
    if (hi < 0) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const hit = this.urls.get(lo);
    if (hit) return hit;
    const url = URL.createObjectURL(
      new Blob([this.data.slice(this.offsets[lo], this.offsets[lo + 1])], { type: 'image/jpeg' }),
    );
    this.urls.set(lo, url);
    if (this.urls.size > KEEP) {
      const [first, old] = this.urls.entries().next().value!;
      URL.revokeObjectURL(old);
      this.urls.delete(first);
    }
    return url;
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
