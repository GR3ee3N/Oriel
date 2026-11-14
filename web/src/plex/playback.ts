// The player's requests to Plex Media Server: play queues, stream decisions,
// timeline reports, track choices and BIF scrub previews.

import type { Item } from '../media/model';
import type { PlaybackBackend } from '../media/provider';
import { setWatched } from './api';
import { Bif } from './bif';
import type { Server } from './client';
import { createQueue, loadQueue } from './playqueue';
import { directPlay, inSession, stopTranscode, transcode } from './stream';
import type { Metadata } from './types';

export function plexPlayback(server: Server): PlaybackBackend {
  /** Version `index` and its file, which is a Plex part. */
  const file = (item: Item, index: number) => {
    const version = item.versions?.[index];
    if (!version?.file) throw new Error(`${item.id} has no version ${index}`);
    return { version, part: version.file };
  };
  return {
    queue: (source) => createQueue(server, source),
    around: (queue, entry) => loadQueue(server, queue, entry),
    stream: async ({ item, version, session, at, direct, quality, decoders }) => {
      const { version: v, part } = file(item, version);
      if (!direct) {
        const t = await transcode(server, item.id, session, at / 1000, quality, decoders, version);
        return { path: t.path, burnt: t.burnt, note: t.decision };
      }
      // A session keeps Plex from ending this stream when the user opens another
      // file. A declined decision does not prevent Kodi from requesting the file.
      const declined = await directPlay(server, item.id, session, { container: v.container, videoCodec: v.videoCodec, audioCodec: v.sound?.codec }, version).catch((e) => String(e));
      return { path: inSession(part.path, session), burnt: false, note: declined ? `Plex declined the direct play: ${declined}` : '' };
    },
    sessionPath: inSession,
    stopStream: (session) => stopTranscode(server, session),
    report: ({ item, session, entry, state, time, duration }) =>
      server.call('/:/timeline', {
        ratingKey: item.id,
        key: `/library/metadata/${item.id}`,
        // Associate timeline reports with the session used for the Plex decision.
        'X-Plex-Session-Identifier': session,
        playQueueItemID: entry,
        state,
        // Clamp Kodi's clock to the duration; Plex rejects later positions with HTTP 400.
        time: Math.round(duration ? Math.min(time, duration) : time),
        duration: Math.round(duration),
      }),
    saveTrack: async (item, version, kind, id) => {
      const { part } = file(item, version);
      await server.call(`/library/parts/${part.id}`, { [kind === 'audio' ? 'audioStreamID' : 'subtitleStreamID']: id, allParts: 1 }, 'PUT');
    },
    thumbs: async (item, version) => {
      const { version: v, part } = file(item, version);
      return v.thumbs ? Bif.load(server, part.id) : undefined;
    },
    ensureWatched: async (item) => {
      // Plex counts a play shortly after the stop report.
      await new Promise((r) => setTimeout(r, 1500));
      const mc = await server.get<Metadata>(`/library/metadata/${item.id}`);
      if ((mc.Metadata?.[0]?.viewCount ?? 0) > (item.plays ?? 0)) return false;
      await setWatched(server, item.id, true);
      return true;
    },
  };
}
