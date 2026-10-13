// Playback quality: the original file, or a transcode at most this many
// kbps (Plex's own ladder, as in PM4K and Plex's apps).

export interface Quality {
  kbps: number;
  label: string;
  /** The largest picture for the transcoder. */
  resolution: string;
}

export const ORIGINAL = 0;

export const QUALITIES: Quality[] = [
  { kbps: ORIGINAL, label: 'Original', resolution: '' },
  { kbps: 20000, label: '20 Mbps, 1080p', resolution: '1920x1080' },
  { kbps: 12000, label: '12 Mbps, 1080p', resolution: '1920x1080' },
  { kbps: 8000, label: '8 Mbps, 1080p', resolution: '1920x1080' },
  { kbps: 4000, label: '4 Mbps, 720p', resolution: '1280x720' },
  { kbps: 2000, label: '2 Mbps, 720p', resolution: '1280x720' },
  { kbps: 1500, label: '1.5 Mbps, 480p', resolution: '720x480' },
  { kbps: 720, label: '720 kbps, 360p', resolution: '640x360' },
];

export function quality(kbps: number): Quality {
  return QUALITIES.find((q) => q.kbps === kbps) ?? QUALITIES[0];
}
