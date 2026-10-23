// Timeline reports update Plex's resume position and watched state.
// Check viewCount before marking a completion watched to prevent double counting.

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
import { directPlay, HARDWARE_CODECS, inSession, stopTranscode, transcode } from './transcode';
import { audioTracks, kodiSubtitle, subtitleTracks, SUBTITLES_OFF, type Track } from './tracks';
import { uuid } from '@oriel/web';

export interface Playback {
  id: string;
  item: Details;
  part: Part;
  /** Show or movie title; episodes also have a code and title in subheading. */
  heading: string;
  subheading: string;
  audio: Track[];
  subtitles: Track[];
  audioId: number;
  subtitleId: number;
  intro?: Marker;
  /** Up next uses the final credits marker, falling back to the first. */
  credits?: Marker;
  /** Include every credits marker so skipping preserves scenes after credits. */
  allCredits: Marker[];
  next?: Metadata;
  /** Whether BIF previews are available; fetched on the first scrub. */
  hasThumbs: boolean;
  /** Selected bitrate limit in kbps; 0 requests the original file. */
  quality: number;
  transcoded: boolean;
}

const [store, setStore] = createStore<{ current?: Playback; nextCancelled: boolean }>({ nextCancelled: false });
export const playback = () => store.current;

/** Prompt displayed when playback opens the OSD without a key press. */
export type Prompt = 'intro' | 'next' | null;
const [prompt, setPrompt] = createSignal<Prompt>(null);
export { prompt };

/** Automatic intro skip delay in seconds; pausing also pauses the countdown. */
export const INTRO_AFTER = 5;
/** Remaining playback milliseconds, last performance.now() tick and countdown timer. */
let introLeft: number | undefined;
let introSince: number | undefined;
let introTimer: ReturnType<typeof setInterval> | undefined;
const [introIn, setIntroIn] = createSignal<number>();
/** Remaining intro countdown in seconds, undefined when inactive. */
export { introIn };

/** Up next delay in seconds during credits; Back cancels autoplay.
 * Without a credits marker, show the prompt 30 s before the end and wait
 * for playback to finish before starting the next episode. */
export const NEXT_AFTER = 10;
let nextAt: number | undefined;
/** A credits countdown starts the next episode before this episode ends. */
let nextOnCredits = false;
let nextStarted = false;
const [nextIn, setNextIn] = createSignal<number>();
/** Remaining Up next countdown in seconds, undefined when inactive. */
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
    // Clear the pending item if launch failed and no newer item replaced it.
    if (store.current?.id === p.id) setStore('current', undefined);
    throw e;
  }
}

/** Metadata retained by the add-on to restore playback after a page reload. */
export interface PlaybackNote {
  ratingKey: string;
  quality: number;
  transcoded: boolean;
}

/** Restore page state for the existing Kodi playback without restarting it. */
export async function adoptPlayback(note: PlaybackNote, id: string): Promise<void> {
  server = currentServer();
  const p = await prepare(server, note.ratingKey, id, note.quality);
  if (!p) return;
  setStore('current', 'transcoded', note.transcoded);
  // The next position update triggers a timeline report for the restored session.
  console.log(`playback: picked up ${p.heading} (${id})`);
}

/** Reject metadata from requests superseded by a newer item selection. */
let prepares = 0;

/** Prepare the current item; return undefined if a newer request supersedes it. */
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

/** Prevent a launch waiting on Plex from replacing a newer launch, such as a seek. */
let launches = 0;

/** Start or replace Kodi playback at `at` seconds. Request a transcode when
 * the file exceeds the bitrate limit or the box lacks a decoder for its video codec. */
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
    // Software decoding is too slow for 4K. For Original quality, fall back
    // to the highest configured transcode bitrate when hardware decoding is absent.
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
    // End the old stream and report it stopped before switching playback type;
    // Plex can reject the replacement under a one-stream limit.
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
    // A session keeps Plex from ending this stream when the user opens another
    // file. A declined decision does not prevent Kodi from requesting the file.
    const declined = await directPlay(server, p.item.ratingKey, p.id, media).catch((e) => String(e));
    if (declined) console.warn(`playback: Plex declined the direct play: ${declined}`);
    if (store.current?.id !== p.id || overtaken()) return;
    await call({
      cmd: 'play',
      path: inSession(p.part.key, p.id),
      session: p.id,
      meta: { ratingKey: p.item.ratingKey, quality: p.quality, transcoded: false },
      title,
      position: at,
      audio: p.audio.find((t) => t.id === p.audioId)?.kodi,
      subtitle: s ? s.kodi : -1,
      subtitleFile: s?.file && inSession(s.file, p.id),
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
  // Transcodes contain only the selected tracks, so subtitles use index 0
  // unless Plex burns them into the video.
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

/** Allow direct playback for hardware-supported codecs, codecs outside
 * HARDWARE_CODECS, or unknown codec and decoder information. */
function decodes(codec: string | undefined): boolean {
  const hw = state.decoders;
  return !hw || !codec || !HARDWARE_CODECS.includes(codec) || hw.includes(codec);
}

/** Session id whose initial subtitle selection has been matched against Kodi. */
let tracksChecked: string | undefined;

/** Use Kodi's subtitle list only for this session's direct playback. */
function kodiSubtitles(p: Playback) {
  const { session, subtitles } = state.player;
  return !p.transcoded && session === p.id ? subtitles : undefined;
}

/** Transcoded playback needs a new stream for each seek. */
export function seekTo(seconds: number): void {
  const p = store.current;
  if (p?.transcoded) launch(seconds).catch(warn('seek'));
  else send({ cmd: 'seek-to', seconds });
}

/** Apply a bitrate limit in kbps at the current position; 0 requests Original. */
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

/** Fetch BIF previews once per playback session. */
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
  // Save the selected track before restarting; Plex uses that choice in the transcode.
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

/** Restart at the current position only if `p` is still the active session. */
function restart(p: Playback): Promise<void> | undefined {
  return store.current?.id === p.id ? launch(state.player.time) : undefined;
}

/** Accept the active prompt: skip the intro or start the next episode. */
export function acceptPrompt(): void {
  const p = store.current;
  const which = prompt();
  if (!p || !which) return;
  dismiss();
  if (which === 'intro' && p.intro) seekTo(p.intro.endTimeOffset / 1000);
  if (which === 'next') playNextNow(true);
}

/** Queue the next episode after stopping; `fromCredits` reports this one complete. */
export function playNextNow(fromCredits = false): void {
  const next = store.current?.next;
  if (!next) return;
  playNextAfterStop = next;
  stopFinished = fromCredits;
  send({ cmd: 'stop' });
}

/** Dismiss the prompt and cancel its countdown; Up next also cancels autoplay. */
export function dismiss(): void {
  const which = prompt();
  if (!which) return;
  dismissed.add(which);
  if (which === 'next') setStore('nextCancelled', true);
  setPrompt(null);
}

const warn = (what: string) => (e: unknown) => console.error(`playback: ${what}: ${e}`);

/** After the final report, mark the item watched only if Plex did not count it. */
async function ensureWatched(s: Server, p: Playback): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500));
  const mc = await s.get<Metadata>(`/library/metadata/${p.item.ratingKey}`);
  const now = mc.Metadata?.[0]?.viewCount ?? 0;
  if (now > (p.item.viewCount ?? 0)) return;
  console.log(`playback: the server did not count ${p.heading}; marking it watched`);
  await setWatched(s, p.item.ratingKey, true);
  // Refresh again because the initial post-playback reload preceded this update.
  refresh();
}

let lastReport = { state: '', at: 0 };
const dismissed = new Set<Prompt>();
/** Skip each marker once so seeking back allows it to play. */
const skipped = new Set<Marker>();

/** Subtract elapsed playing time from the intro countdown. */
function runIntroDown(): void {
  if (introLeft === undefined || introSince === undefined) return;
  const now = performance.now();
  introLeft = Math.max(0, introLeft - (now - introSince));
  introSince = now;
}

/** Show Skip intro within the marker, excluding its last 3 s. `t` is in ms. */
function duringIntro(p: Playback, t: number): boolean {
  return !!p.intro && t >= p.intro.startTimeOffset && t < p.intro.endTimeOffset - 3000;
}

/** Treat a final flag or a marker ending within 5 s of the duration as final credits. */
function finalCredits(m: Marker, p: Playback): boolean {
  const end = (p.item.duration ?? 0) - 5000;
  return !!m.final || (end > 0 && m.endTimeOffset >= end);
}
let playNextAfterStop: Metadata | undefined;
/** Report a stop during final credits as completion; long credits can start
 * before Plex's watched threshold. */
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
      // Associate timeline reports with the session used for the Plex decision.
      'X-Plex-Session-Identifier': p.id,
      state: plexState,
      // Clamp Kodi's clock to the duration; Plex rejects later positions with HTTP 400.
      time: Math.round((total ? Math.min(time, total) : time) * 1000),
      duration: Math.round(total * 1000),
    })
    .catch(warn('timeline'));
}

createRoot(() => {
  // Correct the initial subtitle selection once Kodi reports its track order.
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

  // Report state changes immediately and playback progress every 10 s.
  createEffect(() => {
    const p = store.current;
    const player = state.player;
    // Read position before branching so every update remains a reactive dependency.
    const { time, duration } = player;
    if (!p || player.session !== p.id) return;
    if (player.state === 'playing' || player.state === 'paused') {
      if (player.state !== lastReport.state || Date.now() - lastReport.at >= 10000) {
        report(p, player.state, time, duration);
      }
    }
  });

  // Report the final position before starting a queued or automatically selected episode.
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
        // Delay transcode cleanup until Kodi releases the stream; a late reconnect
        // would otherwise start the stopped transcode again.
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

  // Use markers for Skip intro and Up next; without credits, offer the next
  // episode during the final 30 s.
  createEffect(() => {
    const p = store.current;
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state === 'idle' || state.player.state === 'loading') return;
    // Automatic final-credit skipping replaces Up next. If only intermediate
    // credits exist, offer Up next during the final 30 s.
    const auto = prefs.autoSkipCredits;
    const autoNext = auto && p.allCredits.some((m) => finalCredits(m, p));
    const credits = auto ? undefined : p.credits;
    const inIntro = duringIntro(p, t);
    // Leaving the intro clears dismissal, so seeking back shows a fresh prompt.
    if (!inIntro) dismissed.delete('intro');
    const duration = state.player.duration;
    const creditsAt = credits?.startTimeOffset ?? (duration === null ? Infinity : (duration - 30) * 1000);
    const inCredits = !autoNext && !!p.next && duration !== null && t >= creditsAt;
    const want: Prompt = inIntro && !dismissed.has('intro') ? 'intro' : inCredits && !dismissed.has('next') ? 'next' : null;
    if (want === prompt()) return;
    if (want === 'intro') {
      introLeft = prefs.autoSkipIntro ? INTRO_AFTER * 1000 : undefined;
      introSince = undefined;
    }
    setPrompt(want);
    if (want === 'next') {
      nextOnCredits = !!credits;
      nextAt = credits ? state.player.time + NEXT_AFTER : (duration ?? undefined);
      nextStarted = false;
    }
    if (want && state.mode === 'video') send({ cmd: 'osd-on' });
  });

  // Use elapsed playing time so the countdown matches the button animation;
  // Kodi's whole-second position jumps on seeks. Pause freezes both timers.
  // Recheck the marker before skipping because seek effects can run in either order.
  createEffect(() => {
    const counting = prompt() === 'intro' && introLeft !== undefined;
    const playing = state.player.state === 'playing';
    runIntroDown();
    clearInterval(introTimer);
    introSince = undefined;
    if (!counting) {
      setIntroIn(undefined);
      return;
    }
    setIntroIn(Math.ceil(introLeft! / 1000));
    if (!playing) return;
    introSince = performance.now();
    introTimer = setInterval(() => {
      runIntroDown();
      setIntroIn(Math.ceil(introLeft! / 1000));
      const p = store.current;
      if (introLeft === 0 && p && duringIntro(p, state.player.time * 1000)) {
        clearInterval(introTimer);
        introLeft = undefined;
        console.log('playback: skipping the intro');
        acceptPrompt();
      }
    }, 100);
  });

  // Skip credits only while playing. Preserve scenes after intermediate credits;
  // final credits complete the item and start the next episode when available.
  createEffect(() => {
    const p = store.current;
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state !== 'playing') return;
    const inside = (m: Marker) => t >= m.startTimeOffset && t < m.endTimeOffset - 3000 && !skipped.has(m);
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

  // Kodi's playback position drives Up next, so pausing freezes the countdown.
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
