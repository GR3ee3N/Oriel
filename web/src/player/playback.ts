// Timeline reports update Plex's resume position and watched state.
// Check viewCount before marking a completion watched to prevent double counting.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { call, send, state } from '../bridge';
import { refresh } from '../data';
import { t } from '../i18n';
import { notice } from '../notice';
import { prefs } from '../prefs';
import { type Details, metadata, setWatched } from '../plex/api';
import type { Server } from '../plex/client';
import { clean, episodeCode } from '../plex/format';
import { createQueue, loadQueue, type PlayQueue, type QueueSource } from '../plex/playqueue';
import type { Marker, Metadata, Part } from '../plex/types';
import { currentServer } from '../session';
import { uuid } from '../uuid';
import { Bif } from './bif';
import { type ChapterMark, chaptersFor } from './chapters';
import { after, merge } from './queue';
import { ORIGINAL, QUALITIES, quality } from './quality';
import { directPlay, HARDWARE_CODECS, inSession, stopTranscode, transcode } from './transcode';
import { audioTracks, kodiSubtitle, subtitleTracks, SUBTITLES_OFF, type Track } from './tracks';

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
  /** The playing entry's playQueueItemID; undefined without a play queue. */
  entry?: number;
  /** Chapters of the playing version, in time order. */
  chapters: ChapterMark[];
  /** Whether BIF previews are available; fetched on the first scrub. */
  hasThumbs: boolean;
  /** Selected bitrate limit in kbps; 0 requests the original file. */
  quality: number;
  transcoded: boolean;
  /** Index of the playing version in item.Media. */
  media: number;
}

const [store, setStore] = createStore<{ current?: Playback; nextCancelled: boolean; queue?: PlayQueue }>({ nextCancelled: false });
export const playback = () => store.current;
/** The Plex play queue the playing item belongs to; its loaded window only. */
export const playQueue = () => store.queue;
/** The entry after the playing one, which Next, Up Next & the end of the item start. */
export const nextEntry = () => after(store.queue, store.current?.entry);

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

/** Up next counts down this many seconds of playback in the final credits,
 * then starts the next entry; Back cancels that. Without a credits marker
 * it shows NEXT_BEFORE_END s before the end and the next entry follows the end. */
export const NEXT_AFTER = 10;
export const NEXT_BEFORE_END = 30;
/** In the credits: milliseconds of playback left, when they last ran down
 * (performance.now()) and the timer running them, as for Skip intro. */
let nextLeft: number | undefined;
let nextSince: number | undefined;
let nextTimer: ReturnType<typeof setInterval> | undefined;
/** A credits countdown starts the next entry before this one ends. */
let nextOnCredits = false;
let nextStarted = false;
const [nextIn, setNextIn] = createSignal<number>();
const [nextShare, setNextShare] = createSignal<number>();
const [nextTimed, setNextTimed] = createSignal(false);
/** Seconds until the next entry starts, and the share of the countdown
 * left (0–1); undefined while Up next isn't showing. `nextTimed`: the
 * countdown runs on the clock (credits), updating every 100 ms rather than
 * with Kodi's position. */
export { nextIn, nextShare, nextTimed };

let bif: Promise<Bif | undefined> | undefined;
let server: Server | undefined;

/** Play an item in a new play queue: an episode with the rest of its show,
 * anything else on its own. `media` picks a version of an item with several
 * files, e.g. 4K or 1080p. */
export function startPlayback(item: Metadata, fromStart = false, media = 0): Promise<void> {
  return startQueue({ item: item.ratingKey, continuous: item.type === 'episode' }, fromStart, media, item);
}

/** Play a new play queue from its first entry, e.g. a shuffled collection.
 * Without one from the server, `fallback` plays on its own. */
export async function startQueue(source: QueueSource, fromStart = false, media = 0, fallback?: Metadata): Promise<void> {
  server = currentServer();
  const built = await createQueue(server, source).catch((e) => {
    console.warn(`playback: no play queue: ${e}`);
    return undefined;
  });
  const first = built?.selected ?? fallback;
  if (!first) throw new Error('nothing to play');
  // A version chosen on the detail page applies to that item only.
  await begin(first, fromStart, first.ratingKey === fallback?.ratingKey ? media : 0, built?.queue);
}

/** Play `entry` of the current queue, resuming where it has a saved position. */
export function playEntry(entry: Metadata, fromCredits = false): void {
  if (state.player.state === 'idle' || !store.current) {
    begin(entry, false, 0, store.queue).catch(warn('entry'));
    return;
  }
  playAfterStop = entry;
  stopFinished = fromCredits;
  send({ cmd: 'stop' });
}

async function begin(entry: Metadata, fromStart: boolean, media: number, queue: PlayQueue | undefined): Promise<void> {
  const s = (server = currentServer());
  const quality = s.local ? prefs.qualityLocal : prefs.qualityRemote;
  const p = await prepare(s, entry.ratingKey, uuid(), quality, media, queue, entry.playQueueItemID);
  if (!p) return;
  try {
    await launch(fromStart ? 0 : (p.item.viewOffset ?? 0) / 1000);
  } catch (e) {
    // Clear the pending item if launch failed and no newer item replaced it.
    if (store.current?.id === p.id) setStore('current', undefined);
    throw e;
  }
}

/** Load the queue's entries around `entry`: as each entry starts, for
 * fresh progress & watched state and so Up next has the one after it, and
 * as the strip nears either end of the loaded window. Entries already loaded
 * keep their objects, so the strip keeps their cards and focus. */
export function loadAround(entry: number | undefined): void {
  const q = store.queue;
  if (!q || !server || entry === undefined) return;
  loadQueue(server, q.id, entry)
    .then((w) => store.queue?.id === w.id && setStore('queue', reconcile(merge(store.queue, w), { key: 'playQueueItemID', merge: true })))
    .catch(warn('queue'));
}

/** Metadata retained by the add-on to restore playback after a page reload. */
export interface PlaybackNote {
  ratingKey: string;
  quality: number;
  transcoded: boolean;
  /** Version index; older notes have none and played the first version. */
  media?: number;
  /** Play queue & the playing entry's playQueueItemID. */
  queue?: number;
  entry?: number;
}

/** Restore page state for the existing Kodi playback without restarting it. */
export async function adoptPlayback(note: PlaybackNote, id: string): Promise<void> {
  const s = (server = currentServer());
  const queue = note.queue ? await loadQueue(s, note.queue, note.entry).catch(() => undefined) : undefined;
  const p = await prepare(s, note.ratingKey, id, note.quality, note.media ?? 0, queue, queue && note.entry);
  if (!p) return;
  setStore('current', 'transcoded', note.transcoded);
  // The next position update triggers a timeline report for the restored session.
  console.log(`playback: picked up ${p.heading} (${id})`);
}

/** Reject metadata from requests superseded by a newer item selection. */
let prepares = 0;

/** Prepare the current item as `entry` of `queue`; return undefined if a
 * newer request supersedes it. */
async function prepare(
  server: Server,
  ratingKey: string,
  id: string,
  quality: number,
  media: number,
  queue: PlayQueue | undefined,
  entry?: number,
): Promise<Playback | undefined> {
  const ours = ++prepares;
  const meta = await metadata(server, ratingKey);
  if (ours !== prepares) {
    console.log(`playback: a newer playback replaced ${ratingKey}`);
    return undefined;
  }
  // Fall back to the first version if the chosen one is gone.
  const index = meta?.Media?.[media] ? media : 0;
  const part = meta?.Media?.[index]?.Part?.[0];
  if (!meta || !part) throw new Error(`${ratingKey} has nothing to play`);
  const audio = audioTracks(part);
  const subtitles = subtitleTracks(part);
  const a = audio.find((t) => t.selected) ?? audio[0];
  const s = subtitles.find((t) => t.selected);
  const markers = meta.Marker ?? [];
  bif?.then((b) => b?.dispose());
  bif = undefined;
  const sameQueue = !!queue && queue === store.queue;
  setStore({
    nextCancelled: false,
    queue,
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
      entry,
      chapters: chaptersFor(meta, index),
      hasThumbs: part.indexes === 'sd',
      quality,
      transcoded: false,
      media: index,
    },
  });
  setPrompt(null);
  dismissed.clear();
  skipped.clear();
  lastReport = { state: '', at: 0 };
  // A new queue arrives with its window; moving along one refreshes it.
  if (sameQueue) loadAround(entry);
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
  const media = p.item.Media?.[p.media];
  const bitrate = media?.bitrate ?? Infinity;
  if (!decodes(media?.videoCodec)) {
    // Software decoding is too slow for 4K. For Original quality, fall back
    // to the highest configured transcode bitrate when hardware decoding is absent.
    if (q.kbps === ORIGINAL) {
      q = QUALITIES[1];
      setStore('current', 'quality', q.kbps);
    }
    if (!p.transcoded) notice(t('player.noDecoder', { codec: media?.videoCodec?.toUpperCase() ?? '' }));
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
    const declined = await directPlay(server, p.item.ratingKey, p.id, media, p.media).catch((e) => String(e));
    if (declined) console.warn(`playback: Plex declined the direct play: ${declined}`);
    if (store.current?.id !== p.id || overtaken()) return;
    await call({
      cmd: 'play',
      path: inSession(p.part.key, p.id),
      session: p.id,
      meta: { ...note(p), transcoded: false },
      title,
      position: at,
      audio: p.audio.find((t) => t.id === p.audioId)?.kodi,
      subtitle: s ? s.kodi : -1,
      subtitleFile: s?.file && inSession(s.file, p.id),
    });
    return;
  }
  let stream;
  try {
    stream = await transcode(server, p.item.ratingKey, p.id, at, q, state.decoders, p.media);
  } catch (e) {
    notice(e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (store.current?.id !== p.id || overtaken()) return;
  console.log(`playback: transcode from ${Math.floor(at)} s at ${q.label}: ${stream.decision}`);
  setStore('current', 'transcoded', true);
  // Transcodes contain only the selected tracks, so subtitles use index 0
  // unless Plex burns them into the video.
  await call({
    cmd: 'play',
    path: stream.path,
    session: p.id,
    meta: { ...note(p), transcoded: true },
    title,
    position: Math.floor(at),
    streamOffset: Math.floor(at),
    duration: (p.item.duration ?? 0) / 1000,
    subtitle: s && !stream.burnt ? 0 : -1,
  });
}

const note = (p: Playback): Omit<PlaybackNote, 'transcoded'> => ({
  ratingKey: p.item.ratingKey,
  quality: p.quality,
  media: p.media,
  queue: p.entry !== undefined ? store.queue?.id : undefined,
  entry: p.entry,
});

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

/** Transcoded playback needs a new stream for each seek; the framework
 * keeps a paused session paused across the new stream. */
export function seekTo(seconds: number): void {
  if (!store.current?.transcoded) return send({ cmd: 'seek-to', seconds });
  launch(seconds).catch(warn('seek'));
}

/** Apply a bitrate limit in kbps at the current position; 0 requests Original. */
export function chooseQuality(kbps: number): void {
  const p = store.current;
  if (!p || p.quality === kbps) return;
  setStore('current', 'quality', kbps);
  launch(state.player.time).catch(warn('quality'));
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

/** Start the next entry; `fromCredits` reports this one complete. */
export function playNextNow(fromCredits = false): void {
  const next = nextEntry();
  if (next) playEntry(next, fromCredits);
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

/** Subtract elapsed playing time from Up next's credits countdown. */
function runNextDown(): void {
  if (nextLeft === undefined || nextSince === undefined) return;
  const now = performance.now();
  nextLeft = Math.max(0, nextLeft - (now - nextSince));
  nextSince = now;
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
/** The entry to start once Kodi has stopped the playing one. */
let playAfterStop: Metadata | undefined;
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
      playQueueItemID: p.entry,
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
        if (state.player.ended === 'error') notice(t('player.failed'));
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
        const next = playAfterStop ?? (ended && !store.nextCancelled ? nextEntry() : undefined);
        playAfterStop = undefined;
        // The queue lives with playback: it ends when nothing follows.
        setStore({ current: undefined, ...(next ? {} : { queue: undefined }) });
        if (next) stopped.then(() => begin(next, false, 0, store.queue)).catch(warn('next entry'));
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
    const duration = state.player.duration;
    const creditsAt = credits?.startTimeOffset ?? (duration === null ? Infinity : (duration - NEXT_BEFORE_END) * 1000);
    const inCredits = !autoNext && duration !== null && t >= creditsAt;
    // Leaving the intro or the credits clears Back on its prompt, so seeking
    // back shows it again; for Up next that brings the autoplay back too.
    if (!inIntro) dismissed.delete('intro');
    if (!inCredits && dismissed.delete('next')) setStore('nextCancelled', false);
    const want: Prompt = inIntro && !dismissed.has('intro') ? 'intro' : inCredits && nextEntry() && !dismissed.has('next') ? 'next' : null;
    if (want === prompt()) return;
    if (want === 'intro') {
      introLeft = prefs.autoSkipIntro ? INTRO_AFTER * 1000 : undefined;
      introSince = undefined;
    }
    if (want === 'next') {
      nextOnCredits = !!credits;
      setNextTimed(nextOnCredits);
      nextLeft = credits ? NEXT_AFTER * 1000 : undefined;
      nextSince = undefined;
      nextStarted = false;
    }
    setPrompt(want);
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
    } else if (nextEntry()) {
      console.log('playback: skipping the final credits to the next entry');
      playNextNow(true);
    } else {
      console.log('playback: skipping the final credits to the end');
      stopFinished = true;
      send({ cmd: 'stop' });
    }
  });

  // Up next in the credits counts playback on the clock, as Skip intro
  // does, so seeks don't stretch or cut it and pausing stops it. Without a
  // credits marker it counts Kodi's position to the end, where the next
  // entry follows.
  createEffect(() => {
    const showing = prompt() === 'next';
    const playing = state.player.state === 'playing';
    runNextDown();
    clearInterval(nextTimer);
    nextSince = undefined;
    if (!showing) {
      setNextIn(undefined);
      setNextShare(undefined);
      return;
    }
    if (!nextOnCredits) return;
    const publish = () => {
      setNextIn(Math.ceil(nextLeft! / 1000));
      setNextShare(nextLeft! / (NEXT_AFTER * 1000));
    };
    publish();
    if (!playing) return;
    nextSince = performance.now();
    nextTimer = setInterval(() => {
      runNextDown();
      publish();
      if (nextLeft === 0 && !nextStarted) {
        clearInterval(nextTimer);
        nextStarted = true;
        dismiss();
        playNextNow(true);
      }
    }, 100);
  });
  createEffect(() => {
    const { time, duration } = state.player;
    if (prompt() !== 'next' || nextOnCredits || duration === null) return;
    const left = Math.max(0, duration - time);
    setNextIn(Math.ceil(left));
    setNextShare(Math.min(1, left / NEXT_BEFORE_END));
  });
});
