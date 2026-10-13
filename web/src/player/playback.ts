// Plex derives resume points and watched state from timeline reports.
// Scrobbling every completed item as well can count a play twice; check
// Plex's view count before marking an uncounted completion watched.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import { call, send, state } from '../bridge';
import { refresh } from '../data';
import { notice } from '../notice';
import { prefs } from '../prefs';
import { children, type Details, metadata, setWatched } from '../plex/api';
import type { Server } from '../plex/client';
import { clean, episodeCode } from '../plex/format';
import type { Marker, Metadata, Part } from '../plex/types';
import { currentServer } from '../session';
import { Bif } from './bif';
import { ORIGINAL, QUALITIES, quality } from './quality';
import { HARDWARE_CODECS, stopTranscode, transcode } from './transcode';
import { audioTracks, kodiSubtitle, subtitleTracks, SUBTITLES_OFF, type Track } from './tracks';
import { uuid } from '@oriel/web';

export interface Playback {
  id: string;
  item: Details;
  part: Part;
  /** "Show · S1 · E2" or the movie's title, and the episode's title. */
  heading: string;
  subheading: string;
  audio: Track[];
  subtitles: Track[];
  audioId: number;
  subtitleId: number;
  intro?: Marker;
  /** The final credits (else the first), for Up next. */
  credits?: Marker;
  /** All of them, for skipping: credits can come before a scene. */
  allCredits: Marker[];
  next?: Metadata;
  /** Preview thumbnails, loaded on the first scrub. */
  hasThumbs: boolean;
  /** The quality chosen (kbps, 0 for the original), and whether Kodi is
   * playing a transcode. */
  quality: number;
  transcoded: boolean;
}

const [store, setStore] = createStore<{ current?: Playback; nextCancelled: boolean }>({ nextCancelled: false });
export const playback = () => store.current;

/** What the OSD shows when it is up for a prompt rather than by a key. */
export type Prompt = 'intro' | 'next' | null;
const [prompt, setPrompt] = createSignal<Prompt>(null);
export { prompt };

/** Seconds of the final credits before the next episode starts by itself
 * (Up next counts down; Back cancels it). Without a credits marker the
 * prompt comes 30 s before the end and the next episode follows the end. */
export const NEXT_AFTER = 10;
let nextAt: number | undefined;
/** Up next is on credits: the next episode starts when it runs out, not
 * after the end. */
let nextOnCredits = false;
let nextStarted = false;
const [nextIn, setNextIn] = createSignal<number>();
/** Seconds until Up next plays the next episode, while it counts down. */
export { nextIn };

let bif: Promise<Bif | undefined> | undefined;
let server: Server | undefined;

export async function startPlayback(item: Metadata, fromStart = false): Promise<void> {
  server = currentServer();
  const p = await prepare(server, item.ratingKey, uuid(), server.local ? prefs.qualityLocal : prefs.qualityRemote);
  if (!p) return;
  try {
    await launch(fromStart ? 0 : (p.item.viewOffset ?? 0) / 1000);
  } catch (e) {
    // Nothing plays (Plex refused a transcode, say).
    if (store.current?.id === p.id) setStore('current', undefined);
    throw e;
  }
}

/** What the add-on keeps of a playback for a page loaded again during it
 * (the shell restarted after a crash): enough to pick it up. */
export interface PlaybackNote {
  ratingKey: string;
  quality: number;
  transcoded: boolean;
}

/** Picks up the playback Kodi is on, without starting anything. */
export async function adoptPlayback(note: PlaybackNote, id: string): Promise<void> {
  server = currentServer();
  const p = await prepare(server, note.ratingKey, id, note.quality);
  if (!p) return;
  setStore('current', 'transcoded', note.transcoded);
  // The report effect sends the state on the next position update.
  console.log(`playback: picked up ${p.heading} (${id})`);
}

/** Counts preparations: one whose metadata comes after a newer one's
 * started must not replace it (another item chosen meanwhile). */
let prepares = 0;

/** Sets up the playback of `ratingKey` as the current one; undefined when
 * a newer one overtook it. */
async function prepare(server: Server, ratingKey: string, id: string, quality: number): Promise<Playback | undefined> {
  const ours = ++prepares;
  const meta = await metadata(server, ratingKey);
  if (ours !== prepares) {
    console.log(`playback: a newer playback replaced ${ratingKey}`);
    return undefined;
  }
  const part = meta?.Media?.[0]?.Part?.[0];
  if (!meta || !part) throw new Error(`${ratingKey} has nothing to play`);
  const audio = audioTracks(part);
  const subtitles = subtitleTracks(part);
  const a = audio.find((t) => t.selected) ?? audio[0];
  const s = subtitles.find((t) => t.selected);
  const markers = meta.Marker ?? [];
  bif?.then((b) => b?.dispose());
  bif = undefined;
  setStore({
    nextCancelled: false,
    current: {
      id,
      item: meta,
      part,
      heading: meta.type === 'episode' ? clean(meta.grandparentTitle) : clean(meta.title),
      subheading: meta.type === 'episode' ? `${episodeCode(meta)} · ${clean(meta.title)}` : '',
      audio,
      subtitles,
      audioId: a?.id ?? 0,
      subtitleId: s?.id ?? 0,
      intro: markers.find((m) => m.type === 'intro'),
      credits: markers.find((m) => m.type === 'credits' && m.final) ?? markers.find((m) => m.type === 'credits'),
      allCredits: markers.filter((m) => m.type === 'credits'),
      hasThumbs: part.indexes === 'sd',
      quality,
      transcoded: false,
    },
  });
  setPrompt(null);
  dismissed.clear();
  skipped.clear();
  lastReport = { state: '', at: 0 };
  if (meta.type === 'episode') {
    nextEpisode(server, meta).then((next) => {
      if (store.current?.id === id) setStore('current', 'next', next);
    });
  }
  return store.current!;
}

/** Counts launches: one that a newer launch overtook while it waited on the
 * server must not send its play after the newer one's (two quick seeks in a
 * transcode, say). */
let launches = 0;

/** Starts Kodi on the playback at `at` seconds: the file itself, or a
 * transcode when the file is over the chosen quality. Also restarts a
 * playback (Kodi switches files without a stop in between). */
async function launch(at: number): Promise<void> {
  const p = store.current;
  if (!p || !server) return;
  const ours = ++launches;
  const overtaken = () => {
    if (ours === launches) return false;
    console.log(`playback: a newer launch replaced the one from ${Math.floor(at)} s`);
    return true;
  };
  let q = quality(p.quality);
  const media = p.item.Media?.[0];
  const bitrate = media?.bitrate ?? Infinity;
  if (!decodes(media?.videoCodec)) {
    // Kodi would decode it in software, far too slowly for 4K. Converted
    // instead, at the best of the transcodes for the original.
    if (q.kbps === ORIGINAL) {
      q = QUALITIES[1];
      setStore('current', 'quality', q.kbps);
    }
    if (!p.transcoded) notice(`This box can’t decode ${media?.videoCodec?.toUpperCase()} video; Plex converts it`);
  }
  const title =
    p.item.type === 'episode'
      ? `${clean(p.item.grandparentTitle)} · ${episodeCode(p.item)} · ${clean(p.item.title)}`
      : clean(p.item.title);
  const s = p.subtitles.find((t) => t.id === p.subtitleId);
  const direct = decodes(media?.videoCodec) && (q.kbps === ORIGINAL || bitrate <= q.kbps);
  if (p.transcoded === direct && state.player.session === p.id && state.player.state !== 'idle') {
    // From a transcode to the file or back: the old stream is ended on the
    // server first. On a one-stream limit the server refuses the new one
    // while the old (and the playback session reported for it) runs.
    await Promise.all([
      p.transcoded ? stopTranscode(server, p.id) : undefined,
      report(p, 'stopped', state.player.time, state.player.duration),
    ]);
    lastReport = { state: '', at: 0 };
    if (overtaken()) return;
  }
  if (direct) {
    setStore('current', 'transcoded', false);
    tracksChecked = undefined;
    await call({
      cmd: 'play',
      path: p.part.key,
      session: p.id,
      meta: { ratingKey: p.item.ratingKey, quality: p.quality, transcoded: false },
      title,
      position: at,
      audio: p.audio.find((t) => t.id === p.audioId)?.kodi,
      subtitle: s ? s.kodi : -1,
      subtitleFile: s?.file,
    });
    return;
  }
  let t;
  try {
    t = await transcode(server, p.item.ratingKey, p.id, at, q, state.decoders);
  } catch (e) {
    notice(e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (store.current?.id !== p.id || overtaken()) return;
  console.log(`playback: transcode from ${Math.floor(at)} s at ${q.label}: ${t.decision}`);
  setStore('current', 'transcoded', true);
  // The stream has only the chosen tracks: audio and subtitles are its
  // first (or the subtitles are in the picture).
  await call({
    cmd: 'play',
    path: t.path,
    session: p.id,
    meta: { ratingKey: p.item.ratingKey, quality: p.quality, transcoded: true },
    title,
    position: Math.floor(at),
    streamOffset: Math.floor(at),
    duration: (p.item.duration ?? 0) / 1000,
    subtitle: s && !t.burnt ? 0 : -1,
  });
}

/** Whether the box can play `codec` as it is: a hardware decoder, or a
 * codec light enough for software (old, SD ones), or a box that doesn't
 * say. */
function decodes(codec: string | undefined): boolean {
  const hw = state.decoders;
  return !hw || !codec || !HARDWARE_CODECS.includes(codec) || hw.includes(codec);
}

/** The playback whose start subtitles were checked against Kodi's list. */
let tracksChecked: string | undefined;

/** Kodi's subtitle list for the file playing now, if it is this playback's. */
function kodiSubtitles(p: Playback) {
  const { session, subtitles } = state.player;
  return !p.transcoded && session === p.id ? subtitles : undefined;
}

/** Seeks, by a new transcode when transcoding. */
export function seekTo(seconds: number): void {
  const p = store.current;
  if (p?.transcoded) launch(seconds).catch(warn('seek'));
  else send({ cmd: 'seek-to', seconds });
}

/** Plays on at another quality (kbps, 0 for the original), from here. */
export function chooseQuality(kbps: number): void {
  const p = store.current;
  if (!p || p.quality === kbps) return;
  setStore('current', 'quality', kbps);
  launch(state.player.time).catch(warn('quality'));
}

async function nextEpisode(server: Server, episode: Metadata): Promise<Metadata | undefined> {
  if (!episode.parentRatingKey || !episode.grandparentRatingKey) return undefined;
  const episodes = await children(server, episode.parentRatingKey);
  const after = episodes.find((e) => (e.index ?? 0) > (episode.index ?? 0));
  if (after) return after;
  const seasons = (await children(server, episode.grandparentRatingKey)).sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
  const season = seasons.find((s) => (s.index ?? 0) > (episode.parentIndex ?? 0));
  return season ? (await children(server, season.ratingKey))[0] : undefined;
}

/** The preview thumbnails, fetched once per playback. */
export function thumbs(): Promise<Bif | undefined> {
  const p = store.current;
  if (!p?.hasThumbs || !server) return Promise.resolve(undefined);
  bif ??= Bif.load(server, p.part.id).catch(() => undefined);
  return bif;
}

export function chooseAudio(track: Track): void {
  const p = store.current;
  if (!p || !server) return;
  setStore('current', 'audioId', track.id);
  const saved = server.call(`/library/parts/${p.part.id}`, { audioStreamID: track.id, allParts: 1 }, 'PUT');
  saved.catch(warn('save audio'));
  // A transcode takes the server's choice, so it restarts once that is saved.
  if (p.transcoded) saved.then(() => restart(p)).catch(warn('audio'));
  else send({ cmd: 'audio', index: track.kodi });
}

export function chooseSubtitle(track: Track): void {
  const p = store.current;
  if (!p || !server) return;
  setStore('current', 'subtitleId', track.id);
  const saved = server.call(`/library/parts/${p.part.id}`, { subtitleStreamID: track.id, allParts: 1 }, 'PUT');
  saved.catch(warn('save subtitles'));
  if (p.transcoded) saved.then(() => restart(p)).catch(warn('subtitles'));
  else if (track === SUBTITLES_OFF) send({ cmd: 'subtitle', index: -1 });
  else {
    const kodi = kodiSubtitles(p);
    send({ cmd: 'subtitle', index: (kodi && kodiSubtitle(track, kodi)) ?? track.kodi, file: track.file });
  }
}

/** Restarts `p` from here, unless another playback took its place. */
function restart(p: Playback): Promise<void> | undefined {
  return store.current?.id === p.id ? launch(state.player.time) : undefined;
}

/** Skips to the end of the intro, or plays the next episode now. */
export function acceptPrompt(): void {
  const p = store.current;
  const which = prompt();
  if (!p || !which) return;
  dismiss();
  if (which === 'intro' && p.intro) seekTo(p.intro.endTimeOffset / 1000);
  if (which === 'next') playNextNow(true);
}

/** Stops this episode and plays the next one; `fromCredits`: this one
 * counts as watched to the end. */
export function playNextNow(fromCredits = false): void {
  const next = store.current?.next;
  if (!next) return;
  playNextAfterStop = next;
  stopFinished = fromCredits;
  send({ cmd: 'stop' });
}

/** Back on a prompt: away, and (for Up next) no autoplay either. */
export function dismiss(): void {
  const which = prompt();
  if (!which) return;
  dismissed.add(which);
  if (which === 'next') setStore('nextCancelled', true);
  setPrompt(null);
}

const warn = (what: string) => (e: unknown) => console.error(`playback: ${what}: ${e}`);

/** After a finished item's last report: marks it watched if the server
 * did not count the play (checked first, so it is not counted twice). */
async function ensureWatched(s: Server, p: Playback): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500));
  const mc = await s.get<Metadata>(`/library/metadata/${p.item.ratingKey}`);
  const now = mc.Metadata?.[0]?.viewCount ?? 0;
  if (now > (p.item.viewCount ?? 0)) return;
  console.log(`playback: the server did not count ${p.heading}; marking it watched`);
  await setWatched(s, p.item.ratingKey, true);
  // The screens reloaded when playback ended, before this.
  refresh();
}

let lastReport = { state: '', at: 0 };
const dismissed = new Set<Prompt>();
/** Markers skipped automatically: once each, so seeking back into one
 * watches it. */
const skipped = new Set<Marker>();

/** Credits that run to the end, with nothing after them. */
function finalCredits(m: Marker, p: Playback): boolean {
  const end = (p.item.duration ?? 0) - 5000;
  return !!m.final || (end > 0 && m.endTimeOffset >= end);
}
let playNextAfterStop: Metadata | undefined;
/** The stop leaves the closing credits: reported as the end, so the server
 * marks it watched (it does past ~90 %, which long credits can be under). */
let stopFinished = false;

function report(
  p: Playback,
  plexState: 'playing' | 'paused' | 'stopped' | 'buffering',
  time: number,
  duration: number | null,
): Promise<void> {
  lastReport = { state: plexState, at: Date.now() };
  if (!server) return Promise.resolve();
  const total = duration ?? (p.item.duration ?? 0) / 1000;
  return server
    .call('/:/timeline', {
      ratingKey: p.item.ratingKey,
      key: `/library/metadata/${p.item.ratingKey}`,
      // Ties the report to the transcode session, if there is one.
      'X-Plex-Session-Identifier': p.id,
      state: plexState,
      // Plex refuses a time past the end (HTTP 400), which Kodi's clock
      // can run to when the decoder falls behind.
      time: Math.round((total ? Math.min(time, total) : time) * 1000),
      duration: Math.round(total * 1000),
    })
    .catch(warn('timeline'));
}

createRoot(() => {
  // Once Kodi lists the file's subtitles: the chosen ones by Kodi's index,
  // if container order picked others.
  createEffect(() => {
    const p = store.current;
    const kodi = p && kodiSubtitles(p);
    if (!p || !kodi || tracksChecked === p.id) return;
    tracksChecked = p.id;
    const s = p.subtitles.find((t) => t.id === p.subtitleId);
    const subtitle = s && kodiSubtitle(s, kodi);
    if (subtitle !== undefined && subtitle !== state.player.subtitleIndex) {
      console.log(`playback: subtitles are Kodi's track ${subtitle}, not ${state.player.subtitleIndex}`);
      send({ cmd: 'subtitle', index: subtitle });
    }
  });

  // State changes go out at once, progress every 10 s.
  createEffect(() => {
    const p = store.current;
    const player = state.player;
    // Read up front: the effect must run on every position update, not
    // only when it happens to report.
    const { time, duration } = player;
    if (!p || player.session !== p.id) return;
    if (player.state === 'playing' || player.state === 'paused') {
      if (player.state !== lastReport.state || Date.now() - lastReport.at >= 10000) {
        report(p, player.state, time, duration);
      }
    }
  });

  // The end: final position, then the next episode after a natural end
  // (or when Up next was taken).
  createEffect(
    on(
      () => state.player.state,
      (now, before) => {
        const p = store.current;
        if (now !== 'idle' || !before || before === 'idle' || !p || state.player.session !== p.id) return;
        const ended = state.player.ended === 'ended';
        if (state.player.ended === 'error') notice('Kodi couldn’t play this item');
        const finished = ended || stopFinished;
        stopFinished = false;
        const end = finished ? (state.player.duration ?? state.player.time) : state.player.time;
        const reported = report(p, 'stopped', end, state.player.duration);
        if (finished && server) {
          const s = server;
          reported.then(() => ensureWatched(s, p)).catch(warn('watched'));
        }
        setPrompt(null);
        // Not at once: the UI goes back before Kodi has let go of the
        // stream, and Kodi reconnecting to a stopped transcode starts it again.
        const ending = server;
        const stopped =
          p.transcoded && ending
            ? new Promise((done) => setTimeout(done, 2000)).then(() => stopTranscode(ending, p.id))
            : Promise.resolve();
        const next = playNextAfterStop ?? (ended && !store.nextCancelled ? p.next : undefined);
        playNextAfterStop = undefined;
        setStore('current', undefined);
        if (next) stopped.then(() => startPlayback(next)).catch(warn('next episode'));
      },
    ),
  );

  // Prompts from the markers: Skip intro while in the intro, Up next in
  // the final credits (or the last 30 s) when there is a next episode.
  createEffect(() => {
    const p = store.current;
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state === 'idle' || state.player.state === 'loading') return;
    // Skipped automatically instead: no prompt for the intro, nor for the
    // final credits; credits with more after them are skipped too, so Up
    // next then comes 30 s before the end.
    const auto = prefs.autoSkipCredits;
    const autoNext = auto && p.allCredits.some((m) => finalCredits(m, p));
    const credits = auto ? undefined : p.credits;
    const inIntro = !prefs.autoSkipIntro && !!p.intro && t >= p.intro.startTimeOffset && t < p.intro.endTimeOffset - 3000;
    const duration = state.player.duration;
    const creditsAt = credits?.startTimeOffset ?? (duration === null ? Infinity : (duration - 30) * 1000);
    const inCredits = !autoNext && !!p.next && duration !== null && t >= creditsAt;
    const want: Prompt = inIntro && !dismissed.has('intro') ? 'intro' : inCredits && !dismissed.has('next') ? 'next' : null;
    if (want === prompt()) return;
    setPrompt(want);
    if (want === 'next') {
      nextOnCredits = !!credits;
      nextAt = credits ? state.player.time + NEXT_AFTER : (duration ?? undefined);
      nextStarted = false;
    }
    if (want && state.mode === 'video') send({ cmd: 'osd-on' });
  });

  // Skipping by itself (Settings), as a marker starts playing (not while
  // paused): to the end of the intro, past credits with more after them;
  // from the final credits to the next episode at once, or to the end.
  createEffect(() => {
    const p = store.current;
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state !== 'playing') return;
    const inside = (m: Marker) => t >= m.startTimeOffset && t < m.endTimeOffset - 3000 && !skipped.has(m);
    if (prefs.autoSkipIntro && p.intro && inside(p.intro)) {
      skipped.add(p.intro);
      console.log('playback: skipping the intro');
      seekTo(p.intro.endTimeOffset / 1000);
      return;
    }
    const credits = prefs.autoSkipCredits ? p.allCredits.find(inside) : undefined;
    if (!credits) return;
    skipped.add(credits);
    if (!finalCredits(credits, p)) {
      console.log('playback: skipping credits');
      seekTo(credits.endTimeOffset / 1000);
    } else if (p.next) {
      console.log('playback: skipping the final credits to the next episode');
      playNextNow(true);
    } else {
      console.log('playback: skipping the final credits to the end');
      stopFinished = true;
      send({ cmd: 'stop' });
    }
  });

  // Up next's countdown, and the next episode when it runs out (paused,
  // Kodi's clock stands still, and so does the countdown).
  createEffect(() => {
    const time = state.player.time;
    if (prompt() !== 'next' || nextAt === undefined) {
      setNextIn(undefined);
      return;
    }
    const left = Math.max(0, Math.ceil(nextAt - time));
    setNextIn(left);
    if (left === 0 && nextOnCredits && state.player.state === 'playing' && !nextStarted) {
      nextStarted = true;
      dismiss();
      playNextNow(true);
    }
  });
});
