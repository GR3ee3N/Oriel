// Based on PM4K's plexnet/plexplayer.py: Kodi reads an HTTP MKV stream
// through the proxy. Restrict the profile to codecs the box can decode,
// and request Plex's decision first so refusals include its reason.
// Kodi's clock starts at zero for each stream; the framework adds `offset`.
// Seeking or changing tracks replaces the stream under the same session.
// A direct play gets a decision too, for its playback session.

import { identity, PlexError, type Server } from '../plex/client';
import type { Media } from '../plex/types';
import { type Quality } from './quality';

/** Video codecs the box's hardware may decode; the state's `decoders` says
 * which it does (ffmpeg's names, which Plex uses too). */
export const HARDWARE_CODECS = ['h264', 'hevc', 'av1', 'vp9', 'mpeg1video', 'mpeg2video', 'mpeg4', 'vc1'];
const AUDIO = 'aac,ac3,eac3,dca,truehd,flac,opus,mp3,mp2,pcm';
const SUBTITLES = 'srt,ass,ssa,pgs,vobsub,dvd_subtitle,mov_text,webvtt';
const profileExtra = (video: string) =>
  `add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mkv` +
  `&videoCodec=${video}&audioCodec=${AUDIO}&subtitleCodec=${SUBTITLES})`;

export interface Transcode {
  /** The stream's path and query on the server (no token: the proxy adds it). */
  path: string;
  /** The selected subtitles are burnt into the picture, not a stream. */
  burnt: boolean;
  /** Plex's summary, for the log. */
  decision: string;
}

interface DecisionStream {
  streamType: number;
  decision?: string;
  selected?: boolean;
}

interface Decision {
  generalDecisionCode?: number;
  generalDecisionText?: string;
  transcodeDecisionText?: string;
  Metadata?: { Media?: { Part?: { Stream?: DecisionStream[] }[] }[] }[];
}

export async function transcode(
  server: Server,
  ratingKey: string,
  session: string,
  offset: number,
  q: Quality,
  decoders?: string[] | null,
): Promise<Transcode> {
  const video = (decoders ? HARDWARE_CODECS.filter((c) => decoders.includes(c)) : HARDWARE_CODECS).join(',');
  const params: Record<string, string> = {
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: '0',
    partIndex: '0',
    protocol: 'http',
    offset: String(Math.max(0, Math.floor(offset))),
    fastSeek: '1',
    copyts: '1',
    directPlay: '0',
    directStream: '1',
    directStreamAudio: '1',
    maxVideoBitrate: String(q.kbps),
    videoResolution: q.resolution,
    subtitles: 'auto',
    location: server.local ? 'lan' : 'wan',
    session,
    'X-Plex-Session-Identifier': session,
    'X-Plex-Client-Profile-Name': 'Generic',
    'X-Plex-Client-Profile-Extra': profileExtra(video),
  };
  const decision = await server.get<never>('/video/:/transcode/universal/decision', params).catch((e) => {
    throw e instanceof PlexError && e.status === 400 ? new Error('Plex can’t convert this item') : e;
  });
  const d = decision as unknown as Decision;
  const code = d.generalDecisionCode ?? 0;
  const text = d.generalDecisionText ?? d.transcodeDecisionText ?? '';
  if (code >= 2000) throw new Error(`Plex can’t convert this item: ${text}`);
  const streams = d.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.Stream ?? [];
  const burnt = streams.some((s) => s.streamType === 3 && s.selected && s.decision === 'burn');
  const query = new URLSearchParams({ ...params, ...identity() });
  return { path: `/video/:/transcode/universal/start.mkv?${query}`, burnt, decision: `${code} ${text}` };
}

/** Asks Plex to direct play `media` in playback `session`. Plex keeps a
 * user's streams of different files apart by their sessions: a part
 * requested outside one gets an ad-hoc decision, which ends when the user
 * requests another file. The profile allows the file as it is, as the app
 * chose to play it so, with any of its tracks (Kodi switches them).
 * Resolves with Plex's summary when Plex declined. */
export async function directPlay(server: Server, ratingKey: string, session: string, media?: Media): Promise<string | undefined> {
  const audio = media?.audioCodec && !AUDIO.split(',').includes(media.audioCodec) ? `${AUDIO},${media.audioCodec}` : AUDIO;
  const profile =
    'add-settings(DirectPlayStreamSelection=true)+' +
    `add-direct-play-profile(type=videoProfile&container=${media?.container ?? 'mkv'}` +
    `&videoCodec=${media?.videoCodec ?? HARDWARE_CODECS.join(',')}&audioCodec=${audio}&subtitleCodec=${SUBTITLES})`;
  const d = (await server.get<never>('/video/:/transcode/universal/decision', {
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: '0',
    partIndex: '0',
    protocol: 'http',
    directPlay: '1',
    directStream: '1',
    location: server.local ? 'lan' : 'wan',
    'X-Plex-Session-Identifier': session,
    'X-Plex-Client-Profile-Name': 'Generic',
    'X-Plex-Client-Profile-Extra': profile,
  })) as unknown as Decision | undefined;
  const code = d?.generalDecisionCode ?? 0;
  return code === 1000 ? undefined : `${code} ${d?.generalDecisionText ?? ''}`.trim();
}

/** `path` on the server in playback `session`, for Kodi (no token: the
 * proxy adds it). */
export function inSession(path: string, session: string): string {
  const query = new URLSearchParams({ 'X-Plex-Session-Identifier': session, ...identity() });
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

/** Ends the session's transcode on the server, so it no longer counts as a
 * stream (a user may be limited to one). */
export function stopTranscode(server: Server, session: string): Promise<void> {
  return server.call('/video/:/transcode/universal/stop', { session }).catch(() => {});
}
