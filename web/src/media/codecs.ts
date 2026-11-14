// Codecs the box plays, by FFmpeg name, for the device profiles Oriel and
// Dormer send their servers. Kodi decodes the audio and subtitle formats
// itself; video needs a hardware decoder.

/** Video codecs the box may decode in hardware. The box reports which it
 * has; files in other codecs need a conversion. */
export const HARDWARE_CODECS = ['h264', 'hevc', 'av1', 'vp9', 'mpeg1video', 'mpeg2video', 'mpeg4', 'vc1'];

export const AUDIO_CODECS = ['aac', 'ac3', 'eac3', 'dca', 'truehd', 'flac', 'opus', 'mp3', 'mp2', 'pcm'];

export const SUBTITLE_CODECS = ['srt', 'ass', 'ssa', 'pgs', 'vobsub', 'dvd_subtitle', 'mov_text', 'webvtt'];
