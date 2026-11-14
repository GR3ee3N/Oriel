// Plex play queues. The server builds the order of what plays from an item,
// a show's following episodes, a collection or a playlist, and keeps one
// queue per client. Each entry has its own playQueueItemID, so a title can
// appear twice. Replies hold a window of entries around one of them.

import type { Queue, QueueEntry, QueueSource } from '../media/provider';
import type { Server } from './client';
import { item } from './convert';
import type { MediaContainer, Metadata } from './types';

/** Entries each side of the centre in a reply; the server caps a reply at 200. */
const WINDOW = 25;

const library = (server: Server, path: string) => `server://${server.id}/com.plexapp.plugins.library${path}`;

/** Build a queue on the server; `first` is its selected entry. */
export async function createQueue(server: Server, source: QueueSource): Promise<{ queue: Queue; first: QueueEntry }> {
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
  const selected = String(mc.playQueueSelectedItemID);
  const first = queue.entries.find((e) => e.entry === selected) ?? queue.entries[0];
  if (!first) throw new Error('the play queue is empty');
  return { queue, first };
}

/** The queue's entries around `center` (a playQueueItemID), or around its selected entry. */
export async function loadQueue(server: Server, id: string, center?: string): Promise<Queue> {
  return fromReply(await server.get<Metadata>(`/playQueues/${id}`, { window: WINDOW, center }));
}

/** Without a centre the window surrounds the selected entry, whose position
 * the reply gives. */
function fromReply(mc: MediaContainer<Metadata>): Queue {
  const items = mc.Metadata ?? [];
  const at = items.findIndex((m) => m.playQueueItemID === mc.playQueueSelectedItemID);
  const start = at >= 0 && mc.playQueueSelectedItemOffset !== undefined ? mc.playQueueSelectedItemOffset - at : 0;
  return {
    id: String(mc.playQueueID ?? 0),
    total: mc.playQueueTotalCount ?? items.length,
    shuffled: !!mc.playQueueShuffled,
    start,
    entries: items.map((m) => ({ entry: String(m.playQueueItemID), item: item(m) })),
  };
}
