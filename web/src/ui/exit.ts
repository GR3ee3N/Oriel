// Confirm before Back exits the app.

import { createSignal } from 'solid-js';
import { send } from '../bridge';

const [asking, setAsking] = createSignal(false);

export const exitAsked = asking;

/** Request the exit confirmation rendered by App.tsx. */
export function askExit(): void {
  setAsking(true);
}

export function answerExit(leave: boolean): void {
  setAsking(false);
  if (leave) send({ cmd: 'exit' });
}
