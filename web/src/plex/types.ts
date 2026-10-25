// Plex response fields used by this client; other server fields are omitted.

export interface MediaContainer<T = Metadata> {
  size: number;
  totalSize?: number;
  /** Play queue replies (plex/playqueue.ts). */
  playQueueID?: number;
  playQueueSelectedItemID?: number;
  /** Position of the selected entry in the whole queue. */
  playQueueSelectedItemOffset?: number;
  playQueueTotalCount?: number;
  playQueueShuffled?: boolean;
  Metadata?: T[];
  Directory?: Directory[];
  Hub?: Hub[];
}

export type MetadataType = 'movie' | 'show' | 'season' | 'episode' | 'collection' | 'clip' | string;

export interface Metadata {
  ratingKey: string;
  key: string;
  type: MetadataType;
  title: string;
  /** Plex agent identity, e.g. 'plex://movie/5d77…'; matches Watchlist items to library copies. */
  guid?: string;
  studio?: string;
  originallyAvailableAt?: string;
  /** Collections containing the item. */
  Collection?: Tag[];
  /** Trailers and other extras from includeExtras. */
  Extras?: { Metadata?: Metadata[] };
  /** Extra kind for clips, e.g. 1 for trailers. */
  extraType?: number;
  summary?: string;
  year?: number;
  thumb?: string;
  art?: string;
  /** Show poster and artwork for episodes. */
  grandparentThumb?: string;
  grandparentArt?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  /** Milliseconds. */
  duration?: number;
  viewOffset?: number;
  viewCount?: number;
  leafCount?: number;
  viewedLeafCount?: number;
  childCount?: number;
  tagline?: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  parentThumb?: string;
  Genre?: Tag[];
  Director?: Tag[];
  Role?: Role[];
  contentRating?: string;
  audienceRating?: number;
  librarySectionID?: number;
  Media?: Media[];
  Marker?: Marker[];
  /** From includeChapters; the times belong to one version (player/chapters.ts). */
  Chapter?: Chapter[];
  /** The entry's own ID in a play queue, distinct for each copy of a title. */
  playQueueItemID?: number;
  /** Artwork from includeImages, labelled by kind such as 'clearLogo' or 'background'. */
  Image?: Image[];
  /** Four artwork corner colours as hex values without '#'. */
  UltraBlurColors?: UltraBlurColors;
}

export interface Image {
  type: 'clearLogo' | 'background' | 'coverPoster' | 'snapshot' | 'backgroundSquare' | string;
  url: string;
}

export interface UltraBlurColors {
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
}

export interface Tag {
  tag: string;
  id?: number;
  /** Library filter for the tag, e.g. 'collection=1234'. */
  filter?: string;
}

export interface Role extends Tag {
  id?: number;
  role?: string;
  thumb?: string;
  /** Person filter for library queries, e.g. 'actor=184505'. */
  filter?: string;
}

export interface Media {
  id: number;
  duration?: number;
  bitrate?: number;
  container?: string;
  videoCodec?: string;
  videoResolution?: string;
  audioCodec?: string;
  audioChannels?: number;
  audioProfile?: string;
  Part: Part[];
}

export interface Part {
  id: number;
  key: string;
  duration?: number;
  /** Bytes. */
  size?: number;
  /** 'sd' indicates available BIF preview thumbnails. */
  indexes?: string;
  Stream?: Stream[];
}

export interface Stream {
  id: number;
  /** Plex stream kind: 1 video, 2 audio, 3 subtitles. */
  streamType: 1 | 2 | 3;
  codec?: string;
  /** Container position used to derive Kodi track indexes. */
  index?: number;
  languageCode?: string;
  languageTag?: string;
  title?: string;
  displayTitle?: string;
  channels?: number;
  /** Plex audio profile, e.g. "lc", "ma", "hra" or "dolby truehd + dolby atmos". */
  profile?: string | null;
  selected?: boolean;
  forced?: boolean;
  /** Server path for sidecar subtitles. */
  key?: string;
  hearingImpaired?: boolean;
  /** Dolby Vision flag and transfer function: smpte2084 is PQ, arib-std-b67 is HLG. */
  DOVIPresent?: boolean;
  colorTrc?: string;
}

export interface Marker {
  type: 'intro' | 'credits' | string;
  /** Milliseconds. */
  startTimeOffset: number;
  endTimeOffset: number;
  final?: boolean;
}

export interface Chapter {
  index?: number;
  /** Title; often generic, e.g. 'Kapitel 01'. */
  tag?: string;
  /** Milliseconds. */
  startTimeOffset: number;
  endTimeOffset?: number;
  /** '/library/media/<mediaId>/chapterImages/<n>'. */
  thumb?: string;
}

/** Library section returned by /library/sections. */
export interface Directory {
  key: string;
  type: MetadataType;
  title: string;
}

export interface Hub {
  hubIdentifier: string;
  key: string;
  title: string;
  type: MetadataType;
  size: number;
  Metadata?: Metadata[];
}

/** Server resource returned by plex.tv at /api/v2/resources. */
export interface Resource {
  name: string;
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  /** Owner name for a shared server. */
  sourceTitle?: string | null;
  home?: boolean;
  accessToken?: string;
  httpsRequired?: boolean;
  connections: Connection[];
}

export interface Connection {
  protocol: 'http' | 'https';
  address: string;
  port: number;
  uri: string;
  local: boolean;
  relay: boolean;
  IPv6?: boolean;
}

/** Plex Home profile returned by /api/v2/home/users. */
export interface HomeUser {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  protected: boolean;
}

/** Account or profile returned by /api/v2/user or a profile switch. */
export interface User {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  authToken: string;
  home?: boolean;
}
