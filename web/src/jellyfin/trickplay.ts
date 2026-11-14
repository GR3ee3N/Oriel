// Jellyfin's scrub previews (trickplay): JPEG sheets of frames taken at a
// fixed interval, read left to right, top to bottom. The OSD shows a frame
// as one tile of its sheet, so the box decodes a sheet only when a frame
// from it shows.

import type { Frame, Thumbs } from '../media/provider';
import type { Server } from './client';
import type { BaseItem } from './types';

/** The OSD shows previews this wide. */
const WIDTH = 320;

export async function trickplay(server: Server, itemId: string, sourceId: string): Promise<Thumbs | undefined> {
  const j = await server.get<BaseItem>(`/Items/${itemId}`, { userId: server.userId, Fields: 'Trickplay' });
  const sizes = Object.values(j.Trickplay?.[sourceId] ?? {}).sort((a, b) => a.Width - b.Width);
  // The smallest size at least as wide as the preview, else the widest.
  const info = sizes.find((s) => s.Width >= WIDTH) ?? sizes[sizes.length - 1];
  if (!info?.ThumbnailCount || !info.Interval) return undefined;
  const perSheet = info.TileWidth * info.TileHeight;
  return {
    frameAt: (seconds): Frame => {
      const n = Math.min(Math.floor((seconds * 1000) / info.Interval), info.ThumbnailCount - 1);
      const sheet = Math.floor(n / perSheet);
      const place = n % perSheet;
      return {
        url: server.url(`/Videos/${itemId}/Trickplay/${info.Width}/${sheet}.jpg`, { MediaSourceId: sourceId }),
        tile: { column: place % info.TileWidth, row: Math.floor(place / info.TileWidth), columns: info.TileWidth, width: info.Width, height: info.Height },
      };
    },
    dispose: () => {},
  };
}
