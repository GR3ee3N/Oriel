// Based on PM4K's plexnet/plexplayer.py. Kodi reads HTTP MKV streams through
// the proxy. Limit the profile to supported codecs and request Plex's decision
// before playback so refusals include a reason. The framework adds streamOffset
// to Kodi's stream-relative clock. Seeks and track changes reuse the session
// with a new stream; direct playback also requests a decision for its session.

import { identity, PlexError, type Server } from '../plex/client';
import type { Media } from '../plex/types';
import { type Quality } from './quality';

/** Hardware video codec candidates, using FFmpeg/Plex names. Intersect with
 * the box's reported `decoders` when available. */
export const HARDWARE_CODECS = ['h264', 'hevc', 'av1', 'vp9', 'mpeg1video', 'mpeg2video', 'mpeg4', 'vc1'];
const AUDIO = 'aac,ac3,eac3,dca,truehd,flac,opus,mp3,mp2,pcm';
const SUBTITLES = 'srt,ass,ssa,pgs,vobsub,dvd_subtitle,mov_text,webvtt';
const profileExtra = (video: string) =>
  `add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mkv` +
  `&videoCodec=${video}&audioCodec=${AUDIO}&subtitleCodec=${SUBTITLES})`;

export interface Transcode {
  /** Server path and query; the proxy supplies the token header. */
  path: string;
  /** Selected subtitles are burnt into the video. */
  burnt: boolean;
  /** Plex decision code and reason for logging. */
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
  /** Index of the media version in the item's Media list. */
  mediaIndex = 0,
): Promise<Transcode> {
  const video = (decoders ? HARDWARE_CODECS.filter((c) => decoders.includes(c)) : HARDWARE_CODECS).join(',');
  const params: Record<string, string> = {
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: String(mediaIndex),
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

/** Request a direct-play decision tied to `session`. Without a session,
 * another file request by the same user can end the stream. Allow the source
 * format and all tracks because Kodi handles track selection. Return Plex's
 * decision summary on refusal, or undefined on acceptance. */
export async function directPlay(
  server: Server,
  ratingKey: string,
  session: string,
  media?: Media,
  mediaIndex = 0,
): Promise<string | undefined> {
  const audio = media?.audioCodec && !AUDIO.split(',').includes(media.audioCodec) ? `${AUDIO},${media.audioCodec}` : AUDIO;
  const profile =
    'add-settings(DirectPlayStreamSelection=true)+' +
    `add-direct-play-profile(type=videoProfile&container=${media?.container ?? 'mkv'}` +
    `&videoCodec=${media?.videoCodec ?? HARDWARE_CODECS.join(',')}&audioCodec=${audio}&subtitleCodec=${SUBTITLES})`;
  const d = (await server.get<never>('/video/:/transcode/universal/decision', {
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: String(mediaIndex),
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

/** Add playback session identity to a Kodi path; the proxy supplies the token. */
export function inSession(path: string, session: string): string {
  const query = new URLSearchParams({ 'X-Plex-Session-Identifier': session, ...identity() });
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

/** Release the server transcode so it stops counting against the user's stream limit. */
export function stopTranscode(server: Server, session: string): Promise<void> {
  return server.call('/video/:/transcode/universal/stop', { session }).catch(() => {});
}
