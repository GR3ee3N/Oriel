// An image URL that is offered until it fails to load.

import { createSignal } from 'solid-js';

/** `src()` is the URL while it hasn't failed, then undefined, so a fallback
 * shows. Only the failed URL is remembered: a different URL, such as a
 * reused tile's next item, loads. `fail` takes the URL that failed. */
export function createImage(url: () => string | undefined) {
  const [failed, setFailed] = createSignal<string>();
  return {
    src: () => {
      const u = url();
      return u !== failed() ? u : undefined;
    },
    fail: setFailed,
  };
}
