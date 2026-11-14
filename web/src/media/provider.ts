// What screens ask a media server for. Each server's adapter implements
// Provider; media/servers.ts holds the one in use.

import type { Accessor } from 'solid-js';
import type { Quality } from '../player/quality';
import type { ArtRef, Choice, FilterField, Item, Library, Page, Paged, Row, TitleQuery } from './model';

export interface Provider {
  /** The connected server. `local` picks the local playback quality;
   * `address` is shown in Settings. */
  server: { id: string; name: string; local: boolean; address: string };
  /** Where Kodi fetches media, and the headers the proxy adds to authorise it. */
  mediaSource(): { base: string; headers: Record<string, string> };
  features: Features;
  /** Movie and show libraries. */
  libraries(): Promise<Library[]>;
  /** Drop cached replies, so screens reload watch state and progress. */
  invalidate(): void;
  /** The profile's home rows, such as Continue Watching and Recently Added. */
  home(): Promise<Row[]>;
  /** Recommendation rows for one library, such as Top Unwatched. */
  libraryRows(library: string): Promise<Row[]>;
  /** An empty `library` means the whole server, for a person's titles when
   * items don't name their library. */
  titles(library: string, q: TitleQuery, page?: Page): Promise<Paged<Item>>;
  /** Values a field can be filtered by, in the server's order. */
  filterValues(library: string, field: Exclude<FilterField, 'hdr'>): Promise<Choice[]>;
  /** Title counts by first character, for titles sorted by title. */
  letters(library: string, q: TitleQuery): Promise<{ key: string; size: number }[]>;
  /** A library's collections, in the server's order. */
  collections(library: string, page?: Page): Promise<Paged<Item>>;
  collection(id: string, page?: Page): Promise<Paged<Item>>;
  playlists(page?: Page): Promise<Paged<Item>>;
  playlist(id: string, page?: Page): Promise<Paged<Item>>;
  /** Full details: versions with their tracks, markers, chapters, extras,
   * and a show's next episode. */
  item(id: string): Promise<Item | undefined>;
  /** Seasons of a show, episodes of a season. */
  children(id: string): Promise<Item[]>;
  /** Rows of titles like this one. */
  related(id: string): Promise<Row[]>;
  search(text: string): Promise<Row[]>;
  setWatched(id: string, watched: boolean): Promise<void>;
  /** A URL for a server image at w×h pixels. `blur` hides spoilers; `logo`
   * fits a title logo inside the size and keeps its transparency. */
  image(ref: ArtRef, w: number, h: number, o?: { blur?: boolean; logo?: boolean }): string;
  playback: PlaybackBackend;
  watchlist?: Watchlist;
}

/** What a server supports beyond the Provider's calls. Screens leave out
 * what it lacks; a server without a Watchlist has no `watchlist`. */
export interface Features {
  /** Each library has its own collections, which its Collections tab lists. */
  collectionsPerLibrary: boolean;
  /** Titles can be filtered by HDR. */
  hdrFilter: boolean;
  /** Track choices are saved on the server, for every client that plays the title. */
  savedTracks: boolean;
}

/** What a play queue starts from. */
export type QueueSource =
  /** One item; with `continuous`, an episode and the rest of its show. */
  | { item: string; continuous?: boolean }
  | { collection: string; shuffle?: boolean }
  | { playlist: string; shuffle?: boolean };

/** The order of what plays, kept by the server. Each entry has its own id,
 * so a title can appear twice. A reply holds a window of entries around one
 * of them; `start` is the first loaded entry's position in the whole queue. */
export interface Queue {
  id: string;
  total: number;
  shuffled: boolean;
  start: number;
  entries: QueueEntry[];
}

export interface QueueEntry {
  entry: string;
  item: Item;
}

/** A stream for Kodi to play: a server path, which the proxy authorises. */
export interface Stream {
  path: string;
  /** The selected subtitles are burnt into the video. */
  burnt: boolean;
  /** The server's decision, for the log; blank when it has nothing to say. */
  note: string;
}

/** A scrub preview: an image, or one tile of a sheet of them. */
export interface Frame {
  url: string;
  /** The frame's place in a sheet `columns` tiles wide, and a tile's size in pixels. */
  tile?: { column: number; row: number; columns: number; width: number; height: number };
}

/** Scrub previews of one version. */
export interface Thumbs {
  /** The last frame at or before `seconds`. */
  frameAt(seconds: number): Frame | undefined;
  dispose(): void;
}

/** How the player talks to the server. Times are milliseconds; `session`
 * names one playback, and `version` indexes `item.versions`. */
export interface PlaybackBackend {
  /** Build a queue; `first` is the entry to play first. */
  queue(source: QueueSource): Promise<{ queue: Queue; first: QueueEntry }>;
  /** The queue's entries around `entry`, or around its first entry to play. */
  around(queue: string, entry?: string): Promise<Queue>;
  /** The file itself when `direct`, otherwise a conversion from `at` within
   * the quality's limits, using only video codecs in `decoders` when known.
   * `audio` and `subtitle` are the chosen stream ids; subtitle 0 is off. */
  stream(o: {
    item: Item;
    version: number;
    session: string;
    at: number;
    direct: boolean;
    quality: Quality;
    decoders?: string[] | null;
    audio: number;
    subtitle: number;
  }): Promise<Stream>;
  /** A server path, such as a subtitle file, as Kodi requests it within `session`. */
  sessionPath(path: string, session: string): string;
  /** End a conversion so it stops counting against the server's stream limit. */
  stopStream(session: string): Promise<void>;
  /** Tell the server how far playback got, for resume and watched state. */
  report(o: { item: Item; session: string; entry?: string; state: 'playing' | 'paused' | 'stopped'; time: number; duration: number }): Promise<void>;
  /** Remember a track choice for the version, for the next playback. */
  saveTrack(item: Item, version: number, kind: 'audio' | 'subtitle', id: number): Promise<void>;
  thumbs(item: Item, version: number): Promise<Thumbs | undefined>;
  /** After playing to the end and reporting the stop: mark the item watched
   * if the server didn't count the play. True when it had to. */
  ensureWatched(item: Item): Promise<boolean>;
}

/** Titles the profile wants to watch, kept by the server's account service
 * rather than the server, so they may be missing from its libraries.
 * Titles are matched to the server's copies by guid. */
export interface Watchlist {
  /** Changes with the list; read it in a resource source to reload. */
  version: Accessor<number>;
  /** Most recently added first. */
  items(): Promise<Item[]>;
  /** The server's copies of listed titles, by guid; titles no library has
   * are missing from the map. */
  copies(guids: string[]): Promise<Map<string, Item>>;
  /** Whether the service knows the title, so it can be listed. */
  accepts(guid: string | undefined): boolean;
  has(guid: string | undefined): Promise<boolean>;
  /** Add or remove a title; throws when the service refuses. */
  set(guid: string, on: boolean): Promise<void>;
  /** The service's details for a title the server doesn't have. */
  details(guid: string): Promise<Item | undefined>;
}
