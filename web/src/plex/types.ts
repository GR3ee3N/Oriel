// The parts of Plex's JSON this client reads. Plex returns much more; fields
// are added here as the UI needs them.

export interface MediaContainer<T = Metadata> {
  size: number;
  totalSize?: number;
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
  summary?: string;
  year?: number;
  thumb?: string;
  art?: string;
  /** Episodes: the show's poster and art. */
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
  /** Artwork by kind (includeImages): 'clearLogo', 'background', … */
  Image?: Image[];
  /** Plex's four corner colours of the art, as hex without '#'. */
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
}

export interface Role extends Tag {
  id?: number;
  role?: string;
  thumb?: string;
  /** The library filter for this person, e.g. 'actor=184505'. */
  filter?: string;
}

export interface Media {
  id: number;
  duration?: number;
  bitrate?: number;
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
  /** 'sd' when the server has preview thumbnails (BIF) for it. */
  indexes?: string;
  Stream?: Stream[];
}

export interface Stream {
  id: number;
  /** 1 video, 2 audio, 3 subtitle. */
  streamType: 1 | 2 | 3;
  codec?: string;
  /** Position in the container; Kodi lists streams in this order. */
  index?: number;
  languageCode?: string;
  languageTag?: string;
  title?: string;
  displayTitle?: string;
  channels?: number;
  /** Audio: "lc", "ma", "hra", "ma + dts:x", "dolby truehd + dolby atmos". */
  profile?: string | null;
  selected?: boolean;
  forced?: boolean;
  /** Sidecar subtitle files: their path on the server. */
  key?: string;
  hearingImpaired?: boolean;
  /** Video: Dolby Vision, and the transfer (smpte2084 is PQ, arib-std-b67
   * HLG). */
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

/** A library section, from /library/sections. */
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

/** A server from plex.tv's /api/v2/resources. */
export interface Resource {
  name: string;
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  /** The owner's name, for a server shared with the user. */
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

/** A Plex Home user, from /api/v2/home/users. */
export interface HomeUser {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  protected: boolean;
}

/** The signed-in account or user, from /api/v2/user or a user switch. */
export interface User {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  authToken: string;
  home?: boolean;
}
