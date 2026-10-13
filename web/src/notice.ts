// A short message at the bottom of the screen (a playback that can't
// start, say), shown for a few seconds.

import { createSignal } from 'solid-js';

const [message, setMessage] = createSignal<string>();
export { message as noticeMessage };

let timer: ReturnType<typeof setTimeout> | undefined;

export function notice(text: string): void {
  console.error(`notice: ${text}`);
  setMessage(text);
  clearTimeout(timer);
  timer = setTimeout(() => setMessage(undefined), 6000);
}
