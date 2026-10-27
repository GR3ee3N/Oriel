// Navigate by element position with remembered focus per scope. Left and
// right stay within the row; up and down go to the next row within the
// same area and keep to a column, or enter a group at its entry element.
// Apply the focused class independently of native DOM focus.

import { createSignal, onCleanup, untrack } from 'solid-js';
import { useScope } from './scope';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Options {
  scope?: string;
  group?: string;
  onSelect?: () => unknown;
  /** Return true to consume an arrow without moving focus, such as during scrubbing. */
  onArrow?: (direction: Direction) => boolean;
  onPlay?: () => unknown;
  onFocus?: () => void;
  autofocus?: boolean;
  /** False keeps a control out of automatic initial focus; arrows still reach it. */
  initial?: boolean;
  /** Target when entering the group from outside it. */
  entry?: boolean;
  /** Up and down stay among elements of the same area, such as an on-screen
   * keyboard beside its results; left and right cross areas. */
  area?: string;
}

interface Entry extends Options {
  scope: string;
}

const entries = new Map<HTMLElement, Entry>();
const last = new Map<string, HTMLElement>();
const [current, setCurrent] = createSignal<HTMLElement | null>(null);
const [activeScope, setActiveScope] = createSignal('main');
// Implicit focus may yield to an autofocus element that mounts later.
let implicit = false;

export { current as focused, activeScope };

function focus(el: HTMLElement | null): void {
  const prev = current();
  if (prev === el) return;
  prev?.classList.remove('focused');
  el?.classList.add('focused');
  if (el) {
    const e = entries.get(el)!;
    last.set(e.scope, el);
  }
  setCurrent(el);
  if (import.meta.env.DEV && el) console.debug(`focus: ${(el.textContent ?? '').trim().slice(0, 40) || el.className}`);
  if (el) entries.get(el)!.onFocus?.();
}

function inScope(scope: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const [el, e] of entries) if (e.scope === scope && el.isConnected) out.push(el);
  return out;
}

function restore(scope: string, manual = false): void {
  const remembered = last.get(scope);
  if (remembered?.isConnected && entries.has(remembered) && !implicit) return focus(remembered);
  const els = inScope(scope).filter((el) => manual || entries.get(el)!.initial !== false);
  const auto = els.find((el) => entries.get(el)!.autofocus);
  const entry = els.find((el) => entries.get(el)!.entry);
  focus(auto ?? entry ?? els[0] ?? null);
  implicit = !auto;
}

/** Register from a Solid ref; remove the entry on owner cleanup. Options are
 * read when used, so a getter such as `entry` can follow a signal. */
export function focusable(el: HTMLElement, options: Options = {}): void {
  const entry = Object.assign(options, { scope: options.scope ?? useScope() });
  entries.set(el, entry);
  const wanted = () => entry.scope === activeScope() && (!current() || (entry.autofocus && implicit));
  if (wanted()) {
    // An earlier element in the same mount can take focus first, so check again when the task runs.
    queueMicrotask(() => {
      if (wanted()) restore(entry.scope);
    });
  }
  onCleanup(() => {
    entries.delete(el);
    if (last.get(entry.scope) === el) last.delete(entry.scope);
    if (current() === el) {
      setCurrent(null);
      queueMicrotask(() => {
        if (!current()) restore(activeScope());
      });
    }
  });
}

/** Enter a focus scope; fresh clears its remembered focus. */
export function setScope(scope: string, fresh = false): void {
  // Do not subscribe calling effects to focus changes made during scope restoration.
  untrack(() => {
    if (fresh) last.delete(scope);
    if (scope === activeScope() && !fresh) return;
    setActiveScope(scope);
    restore(scope);
  });
}

/** Focus `el` as if it had just mounted with autofocus, such as a tile whose
 * item arrived after its placeholder: only while focus was never chosen. */
export function claimFocus(el: HTMLElement): void {
  if (entries.get(el)?.scope !== activeScope() || (current() && !implicit)) return;
  implicit = false;
  focus(el);
}

export function focusOn(el: HTMLElement): void {
  if (entries.get(el)?.scope !== activeScope()) return;
  implicit = false;
  focus(el);
}

function entryOf(group: string, scope: string): HTMLElement | undefined {
  for (const [el, e] of entries) if (e.entry && e.group === group && e.scope === scope && el.isConnected) return el;
}

/** Focus a group's entry element, such as a grid's tile from a strip in
 * another area beside it; false when the group has none. */
export function focusGroup(group: string): boolean {
  const el = entryOf(group, activeScope());
  if (!el) return false;
  column = null;
  focusOn(el);
  return true;
}

interface Box {
  el: HTMLElement;
  r: DOMRect;
}

const centre = (r: DOMRect) => r.left + r.width / 2;
// Horizontal distance from x to the box; zero when the box spans x.
const off = (r: DOMRect, x: number) => Math.max(r.left - x, x - r.right, 0);

/** Left and right: the nearest element sharing the row. */
function sideways(a: DOMRect, boxes: Box[], direction: 'left' | 'right'): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r: b } of boxes) {
    if (b.bottom <= a.top || b.top >= a.bottom) continue;
    const ahead = direction === 'right' ? b.left - a.right : a.left - b.right;
    if (ahead < -1) continue;
    const score = Math.max(ahead, 0) + 2 * Math.abs(b.top + b.height / 2 - (a.top + a.height / 2));
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Up and down: the next row, then the element in it closest to column x.
 * A row is every element that overlaps the nearest one vertically. */
function vertical(a: DOMRect, boxes: Box[], direction: 'up' | 'down', x: number): HTMLElement | null {
  const ahead = (b: DOMRect) => (direction === 'down' ? b.top - a.bottom : a.top - b.bottom);
  const candidates = boxes.filter(({ r }) => ahead(r) >= -1);
  if (!candidates.length) return null;
  const nearest = candidates.reduce((n, c) => (ahead(c.r) < ahead(n.r) ? c : n));
  const row = candidates.filter(({ r }) => r.top < nearest.r.bottom && r.bottom > nearest.r.top);
  let best = row[0];
  for (const c of row) {
    const d = off(c.r, x) - off(best.r, x) || Math.abs(centre(c.r) - x) - Math.abs(centre(best.r) - x);
    if (d < 0) best = c;
  }
  return best.el;
}

// The column a run of up and down moves keeps to, so passing through a short
// row returns to the same column. It holds while the focused element stays
// where it was when focused; a move sideways or a row scrolling resets it.
let column: { el: HTMLElement; left: number; x: number } | null = null;

export function move(direction: Direction): boolean {
  const from = current();
  if (!from?.isConnected) {
    restore(activeScope(), true);
    implicit = false;
    return current() !== null;
  }
  const fromEntry = entries.get(from);
  if (fromEntry?.onArrow?.(direction)) return true;
  const a = from.getBoundingClientRect();
  const upDown = direction === 'up' || direction === 'down';
  const boxes: Box[] = [];
  for (const el of inScope(activeScope())) {
    if (el === from || (upDown && entries.get(el)!.area !== fromEntry?.area)) continue;
    const r = el.getBoundingClientRect();
    if (r.width || r.height) boxes.push({ el, r });
  }
  const x = upDown && column?.el === from && Math.abs(column.left - a.left) < 1 ? column.x : centre(a);
  let best = upDown ? vertical(a, boxes, direction, x) : sideways(a, boxes, direction);
  if (!best) return false;
  const picked = best;
  const to = entries.get(best)!;
  if (to.group && to.group !== fromEntry?.group) best = entryOf(to.group, to.scope) ?? best;
  // Measure before focusing: a row that scrolls to the focused element moves it.
  const r = best.getBoundingClientRect();
  column = upDown ? { el: best, left: r.left, x: best === picked ? x : centre(r) } : null;
  implicit = false;
  focus(best);
  return true;
}

export function playFocused(): boolean {
  const el = current();
  const handler = el && entries.get(el)?.onPlay;
  if (!handler) return false;
  Promise.resolve(handler()).catch((e) => console.error(`play: ${e?.stack ?? e}`));
  return true;
}

export function select(): void {
  implicit = false;
  const el = current();
  if (!el) return;
  Promise.resolve(entries.get(el)?.onSelect?.()).catch((e) => console.error(`select: ${e?.stack ?? e}`));
}
