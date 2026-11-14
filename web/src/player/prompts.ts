// Skip intro and Up next: when each prompt shows, how its countdown runs and
// what accepting it does. playback.ts starts this with the few things it
// needs from the playing item and its queue.

import { createEffect, createSignal } from 'solid-js';
import { send, state } from '../bridge';
import type { Marker } from '../media/model';
import { prefs } from '../prefs';
import type { Playback } from './playback';

/** Prompt displayed when playback opens the OSD without a key press. */
export type Prompt = 'intro' | 'next' | null;
const [prompt, setPrompt] = createSignal<Prompt>(null);
export { prompt };

/** Automatic intro skip delay in seconds; pausing also pauses the countdown. */
export const INTRO_AFTER = 5;
/** Up next counts down this many seconds of playback in the final credits,
 * then starts the next entry; Back cancels that. Without a credits marker
 * it shows NEXT_BEFORE_END s before the end and the next entry follows the end. */
const NEXT_AFTER = 10;
const NEXT_BEFORE_END = 30;

const [introIn, setIntroIn] = createSignal<number>();
const [nextIn, setNextIn] = createSignal<number>();
const [nextShare, setNextShare] = createSignal<number>();
const [nextTimed, setNextTimed] = createSignal(false);
/** Remaining intro countdown in seconds, undefined when inactive. */
export { introIn };
/** Seconds until the next entry starts, and the share of the countdown
 * left (0–1); undefined while Up next isn't showing. `nextTimed`: the
 * countdown runs on the clock (credits), updating every 100 ms rather than
 * with Kodi's position. */
export { nextIn, nextShare, nextTimed };

/** What the prompts need from playback. */
export interface PromptHost {
  /** The playing item; read in effects, so a change reruns them. */
  playing(): Playback | undefined;
  /** Whether a queue entry follows the playing one. */
  hasNext(): boolean;
  /** Back on Up next cancels the next entry's start at the end of the item. */
  cancelNext(cancelled: boolean): void;
  /** Seek to a position in seconds. */
  seekTo(seconds: number): void;
  /** Start the next entry; `fromCredits` reports this one complete. */
  playNext(fromCredits: boolean): void;
  /** Stop the playing item as completed. */
  finish(): void;
}

let host!: PromptHost;
const dismissed = new Set<Prompt>();
/** Skip each marker once so seeking back allows it to play. */
const skipped = new Set<Marker>();
/** A credits countdown starts the next entry before this one ends. */
let nextOnCredits = false;
let nextStarted = false;

/** Show Skip intro within the marker, excluding its last 3 s. `t` is in ms. */
function duringIntro(p: Playback, t: number): boolean {
  return !!p.intro && t >= p.intro.start && t < p.intro.end - 3000;
}

/** Treat a final flag or a marker ending within 5 s of the duration as final credits. */
function finalCredits(m: Marker, p: Playback): boolean {
  const end = (p.item.duration ?? 0) - 5000;
  return !!m.final || (end > 0 && m.end >= end);
}

/** Forget what the last item's prompts were doing, for a new item. */
export function resetPrompts(): void {
  setPrompt(null);
  dismissed.clear();
  skipped.clear();
}

/** Remove the prompt without dismissing it. */
export function hidePrompt(): void {
  setPrompt(null);
}

/** Accept the active prompt: skip the intro or start the next queue entry. */
export function acceptPrompt(): void {
  const p = host.playing();
  const which = prompt();
  if (!p || !which) return;
  dismiss();
  if (which === 'intro' && p.intro) host.seekTo(p.intro.end / 1000);
  if (which === 'next') host.playNext(true);
}

/** Dismiss the prompt and cancel its countdown; Up next also cancels autoplay. */
export function dismiss(): void {
  const which = prompt();
  if (!which) return;
  dismissed.add(which);
  if (which === 'next') host.cancelNext(true);
  setPrompt(null);
}

/** A countdown counted on the clock while playing, so seeks don't stretch
 * or cut it and pausing stops it. Kodi's position only moves in whole seconds. */
function createCountdown() {
  /** Milliseconds left, the last time they ran down (performance.now()) and the timer. */
  let left: number | undefined;
  let since: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Subtract the playing time since the last call. */
  const runDown = () => {
    if (left === undefined || since === undefined) return;
    const now = performance.now();
    left = Math.max(0, left - (now - since));
    since = now;
  };
  return {
    /** Milliseconds left; undefined when there is no countdown. */
    get left() {
      return left;
    },
    /** Start counting from `ms`, or have no countdown with undefined. */
    set(ms: number | undefined) {
      left = ms;
      since = undefined;
    },
    /** Run the countdown while `counting()`. `changed` gets the milliseconds
     * left every 100 ms, `stopped` runs when it isn't counting, and `end`
     * runs when the time is up; it returns whether the countdown is over. */
    watch(o: { counting: () => boolean; changed: (left: number) => void; stopped: () => void; end: () => boolean }) {
      createEffect(() => {
        const counting = o.counting();
        const playing = state.player.state === 'playing';
        runDown();
        clearInterval(timer);
        since = undefined;
        if (!counting) return o.stopped();
        o.changed(left!);
        if (!playing) return;
        since = performance.now();
        timer = setInterval(() => {
          runDown();
          o.changed(left!);
          if (left === 0 && o.end()) clearInterval(timer);
        }, 100);
      });
    },
  };
}

/** Begin choosing prompts for the playing item. Call once, after the
 * effects that must run before these, as the order of effects is the order
 * they are created in. */
export function startPrompts(h: PromptHost): void {
  host = h;
  const intro = createCountdown();
  const next = createCountdown();

  // Use markers for Skip intro and Up next; without credits, offer the next
  // queue entry during the final 30 s.
  createEffect(() => {
    const p = host.playing();
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state === 'idle' || state.player.state === 'loading') return;
    // Automatic final-credit skipping replaces Up next. If only intermediate
    // credits exist, offer Up next during the final 30 s.
    const auto = prefs.autoSkipCredits;
    const autoNext = auto && p.allCredits.some((m) => finalCredits(m, p));
    const credits = auto ? undefined : p.credits;
    const inIntro = duringIntro(p, t);
    const duration = state.player.duration;
    const creditsAt = credits?.start ?? (duration === null ? Infinity : (duration - NEXT_BEFORE_END) * 1000);
    const inCredits = !autoNext && duration !== null && t >= creditsAt;
    // Leaving the intro or the credits clears Back on its prompt, so seeking
    // back shows it again; for Up next that brings the autoplay back too.
    if (!inIntro) dismissed.delete('intro');
    if (!inCredits && dismissed.delete('next')) host.cancelNext(false);
    const want: Prompt = inIntro && !dismissed.has('intro') ? 'intro' : inCredits && host.hasNext() && !dismissed.has('next') ? 'next' : null;
    if (want === prompt()) return;
    if (want === 'intro') intro.set(prefs.autoSkipIntro ? INTRO_AFTER * 1000 : undefined);
    if (want === 'next') {
      nextOnCredits = !!credits;
      setNextTimed(nextOnCredits);
      next.set(credits ? NEXT_AFTER * 1000 : undefined);
      nextStarted = false;
    }
    setPrompt(want);
    if (want && state.mode === 'video') send({ cmd: 'osd-on' });
  });

  // Recheck the marker before skipping because seek effects can run in either order.
  intro.watch({
    counting: () => prompt() === 'intro' && intro.left !== undefined,
    changed: (left) => setIntroIn(Math.ceil(left / 1000)),
    stopped: () => setIntroIn(undefined),
    end: () => {
      const p = host.playing();
      if (!p || !duringIntro(p, state.player.time * 1000)) return false;
      intro.set(undefined);
      console.log('playback: skipping the intro');
      acceptPrompt();
      return true;
    },
  });

  // Skip credits only while playing. Preserve scenes after intermediate credits;
  // final credits complete the item and start the next queue entry when available.
  createEffect(() => {
    const p = host.playing();
    const t = state.player.time * 1000;
    if (!p || state.player.session !== p.id || state.player.state !== 'playing') return;
    const inside = (m: Marker) => t >= m.start && t < m.end - 3000 && !skipped.has(m);
    const credits = prefs.autoSkipCredits ? p.allCredits.find(inside) : undefined;
    if (!credits) return;
    skipped.add(credits);
    if (!finalCredits(credits, p)) {
      console.log('playback: skipping credits');
      host.seekTo(credits.end / 1000);
    } else if (host.hasNext()) {
      console.log('playback: skipping the final credits to the next entry');
      host.playNext(true);
    } else {
      console.log('playback: skipping the final credits to the end');
      host.finish();
    }
  });

  // Up next in the credits counts playback on the clock, as Skip intro
  // does. Without a credits marker it counts Kodi's position to the end,
  // where the next entry follows.
  next.watch({
    counting: () => prompt() === 'next' && nextOnCredits,
    changed: (left) => {
      setNextIn(Math.ceil(left / 1000));
      setNextShare(left / (NEXT_AFTER * 1000));
    },
    stopped: () => {
      if (prompt() === 'next') return;
      setNextIn(undefined);
      setNextShare(undefined);
    },
    end: () => {
      if (nextStarted) return false;
      nextStarted = true;
      dismiss();
      host.playNext(true);
      return true;
    },
  });
  createEffect(() => {
    const { time, duration } = state.player;
    if (prompt() !== 'next' || nextOnCredits || duration === null) return;
    const left = Math.max(0, duration - time);
    setNextIn(Math.ceil(left));
    setNextShare(Math.min(1, left / NEXT_BEFORE_END));
  });
}
