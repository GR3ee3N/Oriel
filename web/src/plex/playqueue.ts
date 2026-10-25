// Plex play queues. The server builds the order of what plays from an item,
// a show's following episodes, a collection or a playlist, and keeps one
// queue per client. Each entry has its own playQueueItemID, so a title can
// appear twice. Replies hold a window of entries around one of them.

import type { Server } from './client';
import type { MediaContainer, Metadata } from './types';

export type QueueSource =
  /** One item; with `continuous`, an episode and the rest of its show. */
  | { item: string; continuous?: boolean }
  | { collection: string; shuffle?: boolean }
  | { playlist: string; shuffle?: boolean };

export interface PlayQueue {
  id: number;
  total: number;
  shuffled: boolean;
  /** Loaded entries in queue order; `start` is the first one's position. */
  start: number;
  items: Metadata[];
}

/** Entries each side of the centre in a reply; the server caps a reply at 200. */
const WINDOW = 25;

const library = (server: Server, path: string) => `server://${server.id}/com.plexapp.plugins.library${path}`;

/** Build a queue on the server; its selected entry is the one to play first. */
export async function createQueue(server: Server, source: QueueSource): Promise<{ queue: PlayQueue; selected: Metadata }> {
  const params: Record<string, string | number> = { type: 'video', window: WINDOW };
  if ('item' in source) {
    params.uri = library(server, `/library/metadata/${source.item}`);
    if (source.continuous) params.continuous = 1;
  } else if ('collection' in source) {
    params.uri = library(server, `/library/collections/${source.collection}/children`);
    if (source.shuffle) params.shuffle = 1;
  } else {
    params.playlistID = source.playlist;
    if (source.shuffle) params.shuffle = 1;
  }
  const mc = await server.get<Metadata>('/playQueues', params, 'POST');
  const queue = fromReply(mc);
  const selected = queue.items.find((m) => m.playQueueItemID === mc.playQueueSelectedItemID) ?? queue.items[0];
  if (!selected) throw new Error('the play queue is empty');
  return { queue, selected };
}

/** The queue's entries around `center` (a playQueueItemID), or around its selected entry. */
export async function loadQueue(server: Server, id: number, center?: number): Promise<PlayQueue> {
  return fromReply(await server.get<Metadata>(`/playQueues/${id}`, { window: WINDOW, center }));
}

/** Without a centre the window surrounds the selected entry, whose position
 * the reply gives. */
function fromReply(mc: MediaContainer<Metadata>): PlayQueue {
  const items = mc.Metadata ?? [];
  const at = items.findIndex((m) => m.playQueueItemID === mc.playQueueSelectedItemID);
  const start = at >= 0 && mc.playQueueSelectedItemOffset !== undefined ? mc.playQueueSelectedItemOffset - at : 0;
  return {
    id: mc.playQueueID ?? 0,
    total: mc.playQueueTotalCount ?? items.length,
    shuffled: !!mc.playQueueShuffled,
    start,
    items,
  };
}
