// Leaving the app with Back asks first.

import { createSignal } from 'solid-js';
import { send } from '../bridge';

const [asking, setAsking] = createSignal(false);

export const exitAsked = asking;

/** Back with nowhere left to go: shows the question (App.tsx). */
export function askExit(): void {
  setAsking(true);
}

export function answerExit(leave: boolean): void {
  setAsking(false);
  if (leave) send({ cmd: 'exit' });
}
