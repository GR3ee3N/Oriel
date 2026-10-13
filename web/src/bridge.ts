import { createBridge, IDLE, type VideoCommand, type VideoState } from '@oriel/web';
import type { PlaybackNote } from './player/playback';

export type State = VideoState<PlaybackNote>;
export type Command = VideoCommand<PlaybackNote>;

export const { state, send, call, connect, ready } = createBridge<State, Command>({ mode: 'browse', player: IDLE, decoders: null });
