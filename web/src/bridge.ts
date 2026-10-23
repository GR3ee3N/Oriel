import { createBridge, IDLE, type VideoCommand, type VideoState } from '@oriel/web';
import type { PlaybackNote } from './player/playback';

export type State = VideoState<PlaybackNote> & {
  /** Enables page-side key handling for the simulated add-on in tools/desktop.py. */
  desktop?: boolean;
};
export type Command = VideoCommand<PlaybackNote>;

export const { state, send, call, connect, ready } = createBridge<State, Command>({ mode: 'browse', player: IDLE, decoders: null });
