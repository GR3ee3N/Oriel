import { createBridge, IDLE, type VideoCommand, type VideoState } from '@oriel/web';
import { createStore, reconcile } from 'solid-js/store';
import type { PlaybackNote } from './player/playback';

/** The optional fonts' download (addon/fonts.py); null when the build has none. */
export interface Fonts {
  status: 'missing' | 'downloading' | 'installed' | 'outdated' | 'failed';
  /** Download size in bytes. */
  size: number;
  received: number;
  /** Installed version, also while an update is available or downloading. */
  version: string | null;
  error: string | null;
  /** Unicode scripts the fonts add that no built-in font draws, e.g. 'Han'. */
  scripts: string[];
}

export type State = VideoState<PlaybackNote> & {
  /** Enables page-side key handling for the simulated add-on in tools/desktop.py. */
  desktop?: boolean;
  fonts: Fonts | null;
};
export type Command = VideoCommand<PlaybackNote> | { cmd: 'fonts-install' } | { cmd: 'fonts-remove' };

const bridge = createBridge<State, Command>({ mode: 'browse', player: IDLE, decoders: null, fonts: null });
const [store, setStore] = createStore<State>(bridge.state());
bridge.onState((next) => setStore(reconcile(next)));

export const state: State = store;
export const { send, call, connect, ready } = bridge;

/** The add-on's id for this app run, once the first state has arrived. */
export function runId(): Promise<string> {
  return new Promise((resolve) => {
    if (bridge.state().run) return resolve(bridge.state().run);
    const stop = bridge.onState((next) => {
      if (!next.run) return;
      stop();
      resolve(next.run);
    });
  });
}
