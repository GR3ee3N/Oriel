// The parts of Jellyfin's replies Dormer reads. Times are ticks: 10,000 per
// millisecond.

export interface UserData {
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  Played?: boolean;
  UnplayedItemCount?: number;
}

export interface MediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle' | string;
  Index: number;
  Codec?: string;
  Language?: string;
  Title?: string;
  DisplayTitle?: string;
  Profile?: string;
  Channels?: number;
  ChannelLayout?: string;
  VideoRangeType?: string;
  DvProfile?: number;
  DvBlSignalCompatibilityId?: number;
  Width?: number;
  Height?: number;
  IsForced?: boolean;
  IsHearingImpaired?: boolean;
  IsExternal?: boolean;
  DeliveryUrl?: string;
}

export interface MediaSource {
  Id: string;
  Container?: string;
  Bitrate?: number;
  Size?: number;
  RunTimeTicks?: number;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  MediaStreams?: MediaStream[];
  /** A conversion's path, from PlaybackInfo. */
  TranscodingUrl?: string;
}

/** Scrub previews at one width: sheets of `TileWidth`×`TileHeight` frames,
 * one every `Interval` ms. */
interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
}

export interface Person {
  Id: string;
  Name: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface Chapter {
  StartPositionTicks: number;
  Name?: string;
  ImageTag?: string;
}

export interface BaseItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  Overview?: string;
  Taglines?: string[];
  Studios?: { Name: string }[];
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  UserData?: UserData;
  ChildCount?: number;
  RecursiveItemCount?: number;
  Genres?: string[];
  People?: Person[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ParentPrimaryImageItemId?: string;
  ParentPrimaryImageTag?: string;
  SeriesPrimaryImageTag?: string;
  ImageBlurHashes?: Record<string, Record<string, string>>;
  MediaSources?: MediaSource[];
  Chapters?: Chapter[];
  /** Trickplay sizes by media source id, then by width. */
  Trickplay?: Record<string, Record<string, TrickplayInfo>>;
}

export interface Items {
  Items: BaseItem[];
  TotalRecordCount?: number;
}
