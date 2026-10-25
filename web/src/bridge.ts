import { createBridge, IDLE, type VideoCommand, type VideoState } from '@oriel/web';
import { createStore, reconcile } from 'solid-js/store';
import type { PlaybackNote } from './player/playback';

export type State = VideoState<PlaybackNote> & {
  /** Enables page-side key handling for the simulated add-on in tools/desktop.py. */
  desktop?: boolean;
};
export type Command = VideoCommand<PlaybackNote>;

const bridge = createBridge<State, Command>({ mode: 'browse', player: IDLE, decoders: null });
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
