// Titles, versions and tracks as the interface uses them, whichever media
// server they come from. Each server's adapter converts its replies into
// these types. Times are milliseconds; ids are the server's own, as strings.

export type Kind = 'movie' | 'show' | 'season' | 'episode' | 'collection' | 'playlist' | 'clip' | 'other';

/** A server image the adapter turns into a URL at a requested size. */
export type ArtRef = string;

/** Four artwork corner colours as hex values without '#'. */
export interface Corners {
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
}

export interface Artwork {
  /** The item's own poster; a still for episodes. */
  image?: ArtRef;
  backdrop?: ArtRef;
  logo?: ArtRef;
  /** The show's poster & backdrop, for seasons and episodes. */
  showImage?: ArtRef;
  showBackdrop?: ArtRef;
  /** The season's poster, for episodes. */
  seasonImage?: ArtRef;
  colors?: Corners;
}

export interface Tag {
  /** Absent when the server gives none; the tag then can't list its titles. */
  id?: string;
  title: string;
}

export interface Person {
  /** Absent when the server gives none; the person then can't list their titles. */
  id?: string;
  name: string;
  /** The character played. */
  role?: string;
  photo?: ArtRef;
}

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  /** The show of a season or episode. */
  show?: { id: string; title: string };
  /** The season of an episode. */
  season?: { id: string; title?: string; number?: number };
  /** Episode number, or season number for seasons. */
  number?: number;
  year?: number;
  /** The show's first year, for seasons. */
  showYear?: number;
  /** Release date as YYYY-MM-DD. */
  released?: string;
  summary?: string;
  tagline?: string;
  studio?: string;
  /** Age rating, e.g. { country: 'de', value: '12' } or { value: 'PG-13' }. */
  ageRating?: { country?: string; value: string };
  /** Audience score out of 10. */
  audienceRating?: number;
  duration?: number;
  /** Resume position. */
  position?: number;
  /** Times played to the end. */
  plays?: number;
  /** Episode counts for shows and seasons. */
  episodes?: { total: number; watched: number };
  /** Seasons of a show; items of a collection or playlist. */
  count?: number;
  /** The library holding the item. */
  library?: string;
  art: Artwork;
  genres?: string[];
  directors?: string[];
  cast?: Person[];
  collections?: Tag[];
  /** Server-wide identity, e.g. 'plex://movie/5d77…', for the Plex Watchlist. */
  guid?: string;
  /** Files of a movie or episode; detailed replies add their tracks. */
  versions?: Version[];
  markers?: Marker[];
  chapters?: Chapter[];
  /** Trailers and other extras. */
  extras?: Item[];
  /** The episode to watch next, for shows. */
  next?: Item;
}

export type Range = 'SDR' | 'HDR10' | 'HDR10+' | 'HLG' | 'DV';

export interface VideoStream {
  codec?: string;
  range: Range;
  /** Dolby Vision profile, e.g. 5, 7, 8 or 10, and the base layer's
   * compatibility ID, e.g. 1 for HDR10 in profile 8.1. */
  dvProfile?: number;
  dvCompat?: number;
}

/** What an audio track sounds like, for labels such as "TrueHD Atmos 7.1". */
export interface Sound {
  /** FFmpeg codec name, e.g. 'truehd', 'eac3' or 'dca'. */
  codec?: string;
  /** Layout such as '5.1' or '2.0'. */
  channels?: string;
  atmos: boolean;
  dtsx: boolean;
  /** DTS-HD Master Audio or High Resolution Audio. */
  dtsHd?: 'ma' | 'hra';
}

export interface AudioStream extends Sound {
  id: number;
  /** Position among all the file's streams; orders tracks as Kodi lists them. */
  index?: number;
  /** BCP 47 tag such as 'de' or 'pt-BR'. */
  language?: string;
  /** The server's name for the track, used when the language is unknown. */
  name?: string;
  /** The track's own title from the file. */
  title?: string;
  /** The server's format summary, e.g. 'EAC3 5.1'. */
  format?: string;
  selected: boolean;
}

export interface SubtitleStream {
  id: number;
  index?: number;
  language?: string;
  name?: string;
  title?: string;
  codec?: string;
  forced: boolean;
  hearingImpaired: boolean;
  /** Server path of a subtitle file next to the video. */
  file?: string;
  selected: boolean;
}

export interface Version {
  id: string;
  container?: string;
  /** kbps. */
  bitrate?: number;
  /** '4k', '1080', '720', 'sd' or another height. */
  resolution?: string;
  videoCodec?: string;
  /** Bytes. */
  size?: number;
  duration?: number;
  /** Seek previews are available. */
  thumbs: boolean;
  /** The file as the server's playback knows it: its id, and the server
   * path Kodi plays it from. */
  file?: { id: string; path: string };
  /** The main audio, from summaries that list no tracks. */
  sound?: Sound;
  /** Tracks, present in detailed replies only. */
  video?: VideoStream;
  audio?: AudioStream[];
  subtitles?: SubtitleStream[];
}

export interface Marker {
  kind: 'intro' | 'credits';
  start: number;
  end: number;
  /** Credits that run to the end, with nothing after them. */
  final: boolean;
}

export interface Chapter {
  /** The server's title, generic ones such as "Chapter 3" included. */
  title?: string;
  start: number;
  end?: number;
  image?: ArtRef;
  /** The version whose times these are, when the server says. */
  version?: string;
}

export interface Library {
  id: string;
  title: string;
  kind: 'movie' | 'show';
}

/** Orders for a library's titles; each server has its own name for them. */
export type Sort = 'title' | 'added' | 'released' | 'rating' | 'watched' | 'duration';

/** Fields a library's titles can be filtered by. */
export type FilterField = 'genre' | 'year' | 'resolution' | 'hdr' | 'contentRating';

/** A library listing: its order, and which titles it keeps. Filter values
 * are the keys `filterValues` lists; HDR's only value is 'on'. */
export interface TitleQuery {
  sort: Sort;
  unwatched: boolean;
  filters: Partial<Record<FilterField, string>>;
  /** Only titles featuring this person (a Person id). */
  person?: string;
  /** Only titles in this collection (a collection Tag id). */
  collection?: string;
}

/** A value to filter by, with its label. */
export interface Choice {
  key: string;
  title: string;
}

/** Which part of a longer list to load. */
export interface Page {
  start: number;
  size: number;
}

/** A page of a longer list, such as a library or a collection's items. */
export interface Paged<T> {
  total: number;
  items: T[];
}

/** A row of titles, such as Continue Watching or Recently Added. */
export interface Row {
  /** Plex hub identifiers, e.g. 'home.continue'; other servers use the same
   * ids for the same rows, so they share their translated titles. */
  id: string;
  title: string;
  /** The row's item type, e.g. 'movie', 'episode' or 'mixed'. */
  type: string;
  items: Item[];
}
