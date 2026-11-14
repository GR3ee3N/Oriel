// Playback on Kodi of what the server streams: what to play next, when to
// convert, Skip intro & Up next, and reports of how far playback got, which
// update the server's resume position and watched state.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { call, send, state } from '../bridge';
import { refresh } from '../data';
import { t } from '../i18n';
import { notice } from '../notice';
import { prefs } from '../prefs';
import { clean, episodeCode } from '../media/format';
import type { AudioStream, Item, Marker, SubtitleStream, Version } from '../media/model';
import type { Provider, Queue, QueueEntry, QueueSource, Thumbs } from '../media/provider';
import { provider } from '../media/servers';
import { uuid } from '../uuid';
import { type ChapterMark, chaptersFor } from './chapters';
import { after, merge } from './queue';
import { HARDWARE_CODECS } from '../media/codecs';
import { ORIGINAL, QUALITIES, quality } from './quality';
import { hidePrompt, resetPrompts, startPrompts } from './prompts';
import { audioTracks, kodiSubtitle, subtitleTracks, SUBTITLES_OFF, type Track } from './tracks';

export interface Playback {
  id: string;
  item: Item;
  /** Show or movie title; episodes also have a code and title in subheading. */
  heading: string;
  subheading: string;
  audio: Track<AudioStream>[];
  subtitles: Track<SubtitleStream>[];
  audioId: number;
  subtitleId: number;
  intro?: Marker;
  /** Up next uses the final credits marker, falling back to the first. */
  credits?: Marker;
  /** Include every credits marker so skipping preserves scenes after credits. */
  allCredits: Marker[];
  /** The playing queue entry; undefined without a play queue. */
  entry?: string;
  /** Chapters of the playing version, in time order. */
  chapters: ChapterMark[];
  /** Whether scrub previews are available; fetched on the first scrub. */
  hasThumbs: boolean;
  /** Selected bitrate limit in kbps; 0 requests the original file. */
  quality: number;
  transcoded: boolean;
  /** Index of the playing version in item.versions. */
  version: number;
}

const [store, setStore] = createStore<{ current?: Playback; nextCancelled: boolean; queue?: Queue }>({ nextCancelled: false });
export const playback = () => store.current;
// The item played last, kept after it stops, so a page can show where viewing got to.
const [lastPlayed, setLastPlayed] = createSignal<Item>();
export { lastPlayed };
/** The play queue the playing item belongs to; its loaded window only. */
export const playQueue = () => store.queue;
/** The entry after the playing one, which Next, Up Next & the end of the item start. */
export const nextEntry = () => after(store.queue, store.current?.entry);

let previews: Promise<Thumbs | undefined> | undefined;
/** The server the playing item comes from. */
let source: Provider | undefined;
/** The newest request to play something: a selection, a restore or an
 * automatic next entry. Deferred and async steps drop out once it is superseded. */
let requests = 0;
/** Start a new request. It also cancels a stop waiting to start an earlier one. */
function newRequest(): number {
  playAfterStop = undefined;
  return ++requests;
}

/** What starting an item reads from it. */
type PlayRef = Pick<Item, 'id' | 'kind'>;

/** Play an item in a new play queue: an episode with the rest of its show,
 * anything else on its own. `version` picks one of an item's files, e.g. 4K
 * or 1080p. */
export function startPlayback(item: PlayRef, fromStart = false, version = 0): Promise<void> {
  return startQueue({ item: item.id, continuous: item.kind === 'episode' }, fromStart, version, item);
}

/** Play a new play queue from its first entry, e.g. a shuffled collection.
 * Without one from the server, `fallback` plays on its own. */
export async function startQueue(from: QueueSource, fromStart = false, version = 0, fallback?: PlayRef): Promise<void> {
  const request = newRequest();
  source = provider();
  const built = await source.playback.queue(from).catch((e) => {
    console.warn(`playback: no play queue: ${e}`);
    return undefined;
  });
  // A newer selection arrived while the queue was being created.
  if (request !== requests) return;
  const first = built?.first.item.id ?? fallback?.id;
  if (!first) throw new Error('nothing to play');
  // A version chosen on the detail page applies to that item only.
  await begin(first, built?.first.entry, fromStart, first === fallback?.id ? version : 0, built?.queue, request);
}

/** Play `entry` of the current queue, resuming where it has a saved position. */
export function playEntry(entry: QueueEntry, fromCredits = false): void {
  const request = newRequest();
  if (state.player.state === 'idle' || !store.current) {
    begin(entry.item.id, entry.entry, false, 0, store.queue, request).catch(warn('entry'));
    return;
  }
  playAfterStop = { entry, request };
  stopFinished = fromCredits;
  send({ cmd: 'stop' });
}

async function begin(
  id: string,
  entry: string | undefined,
  fromStart: boolean,
  version: number,
  queue: Queue | undefined,
  request: number,
): Promise<void> {
  // A deferred start, such as one after a stop, may be superseded before it runs.
  if (request !== requests) return;
  source = provider();
  const quality = source.server.local ? prefs.qualityLocal : prefs.qualityRemote;
  const p = await prepare(source, id, uuid(), quality, version, queue, entry, request);
  if (!p) return;
  try {
    await launch(fromStart ? 0 : (p.item.position ?? 0) / 1000);
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
export function loadAround(entry: string | undefined): void {
  const q = store.queue;
  if (!q || !source || entry === undefined) return;
  source.playback
    .around(q.id, entry)
    .then((w) => store.queue?.id === w.id && setStore('queue', reconcile(merge(store.queue, w), { key: 'entry', merge: true })))
    .catch(warn('queue'));
}

/** Metadata retained by the add-on to restore playback after a page reload. */
export interface PlaybackNote {
  /** The playing item. */
  id: string;
  quality: number;
  transcoded: boolean;
  /** Version index; omission selects the first version. */
  version?: number;
  /** Play queue & the playing entry. */
  queue?: string;
  entry?: string;
}

/** Restore page state for the existing Kodi playback without restarting it.
 * A note from an older Oriel, which named the item differently, is dropped. */
export async function adoptPlayback(note: PlaybackNote, id: string): Promise<void> {
  if (typeof note.id !== 'string') return console.log('playback: the playing item is unknown; its note is from an older Oriel');
  const request = newRequest();
  const s = (source = provider());
  const queue = note.queue ? await s.playback.around(note.queue, note.entry).catch(() => undefined) : undefined;
  const p = await prepare(s, note.id, id, note.quality, note.version ?? 0, queue, queue && note.entry, request);
  if (!p) return;
  setStore('current', 'transcoded', note.transcoded);
  // The next position update triggers a timeline report for the restored session.
  console.log(`playback: picked up ${p.heading} (${id})`);
}

/** Prepare the current item as `entry` of `queue`; return undefined if
 * `request` has been superseded by a newer one. */
async function prepare(
  server: Provider,
  itemId: string,
  id: string,
  quality: number,
  version: number,
  queue: Queue | undefined,
  entry: string | undefined,
  request: number,
): Promise<Playback | undefined> {
  const item = await server.item(itemId);
  if (request !== requests) {
    console.log(`playback: a newer playback replaced ${itemId}`);
    return undefined;
  }
  // Fall back to the first version if the chosen one is gone.
  const index = item?.versions?.[version] ? version : 0;
  const file = item?.versions?.[index];
  if (!item || !file) throw new Error(`${itemId} has nothing to play`);
  const audio = audioTracks(file);
  const subtitles = subtitleTracks(file);
  const a = audio.find((t) => t.selected) ?? audio[0];
  const s = subtitles.find((t) => t.selected);
  const markers = item.markers ?? [];
  previews?.then((b) => b?.dispose());
  previews = undefined;
  const sameQueue = !!queue && queue === store.queue;
  setLastPlayed(item);
  setStore({
    nextCancelled: false,
    queue,
    current: {
      id,
      item,
      heading: item.kind === 'episode' ? clean(item.show?.title) : clean(item.title),
      subheading: item.kind === 'episode' ? `${episodeCode(item)} · ${clean(item.title)}` : '',
      audio,
      subtitles,
      audioId: a?.id ?? 0,
      subtitleId: s?.id ?? 0,
      intro: markers.find((m) => m.kind === 'intro'),
      credits: markers.find((m) => m.kind === 'credits' && m.final) ?? markers.find((m) => m.kind === 'credits'),
      allCredits: markers.filter((m) => m.kind === 'credits'),
      entry,
      chapters: chaptersFor(item, index),
      hasThumbs: file.thumbs,
      quality,
      transcoded: false,
      version: index,
    },
  });
  resetPrompts();
  lastReport = { state: '', at: 0 };
  // A new queue arrives with its window; moving along one refreshes it.
  if (sameQueue) loadAround(entry);
  return store.current!;
}

/** Prevent a launch waiting on the server from replacing a newer launch, such as a
 * seek, or from starting once a newer request is under way. */
let launches = 0;

/** Start or replace Kodi playback at `at` seconds. Request a transcode when
 * the file exceeds the bitrate limit or the box lacks a decoder for its video codec. */
async function launch(at: number): Promise<void> {
  const p = store.current;
  const server = source;
  if (!p || !server) return;
  const ours = ++launches;
  const request = requests;
  const overtaken = () => {
    if (ours === launches && request === requests) return false;
    console.log(`playback: a newer launch or request replaced the one from ${Math.floor(at)} s`);
    return true;
  };
  let q = quality(p.quality);
  const file: Version | undefined = p.item.versions?.[p.version];
  const bitrate = file?.bitrate ?? Infinity;
  if (!decodes(file?.videoCodec)) {
    // Software decoding is too slow for 4K. For Original quality, fall back
    // to the highest configured transcode bitrate when hardware decoding is absent.
    if (q.kbps === ORIGINAL) {
      q = QUALITIES[1];
      setStore('current', 'quality', q.kbps);
    }
    if (!p.transcoded) notice(t('player.noDecoder', { codec: file?.videoCodec?.toUpperCase() ?? '' }));
  }
  const title =
    p.item.kind === 'episode' ? `${clean(p.item.show?.title)} · ${episodeCode(p.item)} · ${clean(p.item.title)}` : clean(p.item.title);
  const s = p.subtitles.find((t) => t.id === p.subtitleId);
  const direct = decodes(file?.videoCodec) && (q.kbps === ORIGINAL || bitrate <= q.kbps);
  if (p.transcoded === direct && state.player.session === p.id && state.player.state !== 'idle') {
    // End the old stream and report it stopped before switching playback type;
    // the server can reject the replacement under a one-stream limit.
    await Promise.all([
      p.transcoded ? server.playback.stopStream(p.id) : undefined,
      report(p, 'stopped', state.player.time, state.player.duration),
    ]);
    lastReport = { state: '', at: 0 };
    if (overtaken()) return;
  }
  const want = {
    item: p.item,
    version: p.version,
    session: p.id,
    at: at * 1000,
    quality: q,
    decoders: state.decoders,
    audio: p.audioId,
    subtitle: p.subtitleId,
  };
  if (direct) {
    setStore('current', 'transcoded', false);
    tracksChecked = undefined;
    const stream = await server.playback.stream({ ...want, direct: true });
    if (stream.note) console.warn(`playback: ${stream.note}`);
    if (store.current?.id !== p.id || overtaken()) return;
    await call({
      cmd: 'play',
      path: stream.path,
      session: p.id,
      meta: { ...note(p), transcoded: false },
      title,
      position: at,
      audio: p.audio.find((t) => t.id === p.audioId)?.kodi,
      subtitle: s ? s.kodi : -1,
      subtitleFile: s?.file && server.playback.sessionPath(s.file, p.id),
    });
    return;
  }
  let stream;
  try {
    stream = await server.playback.stream({ ...want, direct: false });
  } catch (e) {
    notice(e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (store.current?.id !== p.id || overtaken()) return;
  console.log(`playback: transcode from ${Math.floor(at)} s at ${q.label}: ${stream.note}`);
  setStore('current', 'transcoded', true);
  // Transcodes contain only the selected tracks, so subtitles use index 0
  // unless the server burns them into the video.
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
  id: p.item.id,
  quality: p.quality,
  version: p.version,
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

/** Fetch scrub previews once per playback session. */
export function thumbs(): Promise<Thumbs | undefined> {
  const p = store.current;
  if (!p?.hasThumbs || !source) return Promise.resolve(undefined);
  previews ??= source.playback.thumbs(p.item, p.version).catch(() => undefined);
  return previews;
}

export function chooseAudio(track: Track<AudioStream>): void {
  const p = store.current;
  if (!p || !source) return;
  setStore('current', 'audioId', track.id);
  const saved = source.playback.saveTrack(p.item, p.version, 'audio', track.id);
  saved.catch(warn('save audio'));
  // Save the choice before restarting, for servers that convert with the saved track.
  if (p.transcoded) saved.then(() => restart(p)).catch(warn('audio'));
  else send({ cmd: 'audio', index: track.kodi });
}

export function chooseSubtitle(track: Track<SubtitleStream>): void {
  const p = store.current;
  if (!p || !source) return;
  setStore('current', 'subtitleId', track.id);
  const saved = source.playback.saveTrack(p.item, p.version, 'subtitle', track.id);
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

/** Start the next entry; `fromCredits` reports this one complete. */
export function playNextNow(fromCredits = false): void {
  const next = nextEntry();
  if (next) playEntry(next, fromCredits);
}

const warn = (what: string) => (e: unknown) => console.error(`playback: ${what}: ${e}`);

/** After the final report, mark the item watched only if the server did not count it. */
async function ensureWatched(s: Provider, p: Playback): Promise<void> {
  if (!(await s.playback.ensureWatched(p.item))) return;
  console.log(`playback: the server did not count ${p.heading}; marked it watched`);
  // Refresh again because the reload after the stop report preceded this update.
  refresh();
}

let lastReport = { state: '', at: 0 };
/** The entry to start once Kodi has stopped the playing one. */
let playAfterStop: { entry: QueueEntry; request: number } | undefined;
/** Report a stop during final credits as completion; long credits can start
 * before the server's watched threshold. */
let stopFinished = false;

/** `time` and `duration` in seconds, as Kodi reports them. */
function report(p: Playback, now: 'playing' | 'paused' | 'stopped', time: number, duration: number | null): Promise<void> {
  lastReport = { state: now, at: Date.now() };
  if (!source) return Promise.resolve();
  const total = duration !== null ? duration * 1000 : (p.item.duration ?? 0);
  return source.playback
    .report({ item: p.item, session: p.id, entry: p.entry, state: now, time: time * 1000, duration: total })
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

  // Report the final position before starting the next queue entry.
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
        // Reload watch state and progress once the server has the final position.
        const s = source;
        report(p, 'stopped', end, state.player.duration)
          .then(() => {
            refresh();
            if (finished && s) return ensureWatched(s, p);
          })
          .catch(warn('watched'));
        hidePrompt();
        // Delay transcode cleanup until Kodi releases the stream; a late reconnect
        // would otherwise start the stopped transcode again.
        const ending = source;
        const stopped =
          p.transcoded && ending
            ? new Promise((done) => setTimeout(done, 2000)).then(() => ending.playback.stopStream(p.id))
            : Promise.resolve();
        const queued = playAfterStop;
        playAfterStop = undefined;
        const auto = !queued && ended && !store.nextCancelled ? nextEntry() : undefined;
        const next = queued ?? (auto ? { entry: auto, request: newRequest() } : undefined);
        // The queue lives with playback: it ends when nothing follows.
        setStore({ current: undefined, ...(next ? {} : { queue: undefined }) });
        if (next) stopped.then(() => begin(next.entry.item.id, next.entry.entry, false, 0, store.queue, next.request)).catch(warn('next entry'));
      },
    ),
  );

  startPrompts({
    playing: () => store.current,
    hasNext: () => !!nextEntry(),
    cancelNext: (cancelled) => setStore('nextCancelled', cancelled),
    seekTo,
    playNext: playNextNow,
    finish: () => {
      stopFinished = true;
      send({ cmd: 'stop' });
    },
  });
});
