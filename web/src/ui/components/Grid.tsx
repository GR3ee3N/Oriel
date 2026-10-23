import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { focusOn } from '@oriel/web';
import { dataVersion } from '../../data';
import type { MediaContainer, Metadata } from '../../plex/types';
import { SIZES, Tile } from './Tile';
import './grid.css';

const COLS = 7;
const GAP = 24;
const PITCH = 420;
const PAGE = 70;
/** Render extra rows above and below focus so tiles load posters in advance.
 * Avoid separate preloads: decoding a second copy can blank a visible poster. */
const BEFORE = 2;
const AFTER = 3;

export interface GridProps {
  /** Load `size` items at offset `start`; the response must include totalSize. */
  load: (start: number, size: number) => Promise<MediaContainer>;
  /** Reset pagination and focus when sort or filter changes this key. */
  key: string;
  onSelect: (item: Metadata) => void;
  onTotal?: (total: number) => void;
  /** Jump to an item from the A–Z rail; increment `n` to repeat the same index. */
  jump?: { index: number; n: number };
}

/** Virtualize library posters around the focused row, aligned at the top.
 * Load pages as focus approaches them and position tiles absolutely. */
export function Grid(props: GridProps) {
  // Keep metadata in plain objects to avoid deep reactive-store wrapping overhead.
  const [items, setItems] = createSignal<(Metadata | undefined)[]>([]);
  const [total, setTotal] = createSignal<number>();
  const [row, setRow] = createSignal(0);
  const [error, setError] = createSignal('');

  // Defer row creation until scrolling settles to keep layout and painting
  // out of the animation. Update immediately if focus would leave the rendered rows.
  const [around, setAround] = createSignal(0);
  let aroundTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(row, (r) => {
      clearTimeout(aroundTimer);
      if (Math.abs(r - around()) >= Math.min(BEFORE, AFTER)) setAround(r);
      else aroundTimer = setTimeout(() => setAround(r), 300);
    }),
  );
  onCleanup(() => clearTimeout(aroundTimer));
  let pages = new Set<number>();
  let body!: HTMLDivElement;
  let generation = 0;

  const loadPage = (page: number) => {
    if (pages.has(page)) return;
    pages.add(page);
    const gen = generation;
    props
      .load(page * PAGE, PAGE)
      .then((mc) => {
        if (gen !== generation) return;
        const size = mc.totalSize ?? mc.size;
        if (size !== total()) {
          setTotal(size);
          props.onTotal?.(size);
        }
        setItems((list) => {
          const next = list.slice();
          (mc.Metadata ?? []).forEach((m, i) => (next[page * PAGE + i] = m));
          return next;
        });
      })
      .catch((e) => {
        if (gen !== generation) return;
        pages.delete(page);
        setError(String(e));
      });
  };

  createEffect(
    on(
      () => props.key,
      () => {
        generation++;
        pages = new Set();
        setItems([]);
        setTotal(undefined);
        setRow(0);
        setAround(0);
        setError('');
        loadPage(0);
      },
    ),
  );

  // Load pages covering rendered rows and the next rows ahead.
  const loadAround = () => {
    const t = total();
    if (t === undefined) return;
    const first = Math.max(0, around() - BEFORE) * COLS;
    const last = Math.min(t - 1, (around() + AFTER + 2) * COLS);
    for (let p = Math.floor(first / PAGE); p <= Math.floor(last / PAGE); p++) loadPage(p);
  };
  createEffect(loadAround);

  // Reload watched state in place after playback; retain tile elements to preserve focus.
  createEffect(
    on(
      dataVersion,
      () => {
        generation++;
        pages = new Set();
        loadAround();
      },
      { defer: true },
    ),
  );

  // Render the jump target's row before focusing its tile on the next frame.
  createEffect(
    on(
      () => props.jump,
      (jump) => {
        if (!jump) return;
        const t = total() ?? 0;
        const index = Math.min(jump.index, Math.max(0, t - 1));
        setRow(Math.floor(index / COLS));
        setAround(Math.floor(index / COLS));
        requestAnimationFrame(() => {
          const el = body.querySelector<HTMLElement>(`[data-index="${index}"]`);
          if (el) focusOn(el);
        });
      },
      { defer: true },
    ),
  );

  const visible = () => {
    const t = total() ?? 0;
    const from = Math.max(0, around() - BEFORE) * COLS;
    const to = Math.min(t, (around() + AFTER + 1) * COLS);
    return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  };

  const { w } = SIZES.poster;

  return (
    <div class="grid">
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={total() === 0}>
        <p class="dim">Nothing here.</p>
      </Show>
      <div class="grid-body" ref={body} style={{ transform: `translateY(${-row() * PITCH}px)` }}>
        <For each={visible()}>
          {(index) => {
            const item = createMemo(() => items()[index]);
            return (
              <div
                class="cell"
                style={{ left: `${(index % COLS) * (w + GAP)}px`, top: `${Math.floor(index / COLS) * PITCH}px` }}
              >
                <Tile
                  item={item()}
                  index={index}
                  autofocus={index === 0}
                  onFocus={() => setRow(Math.floor(index / COLS))}
                  onSelect={() => props.onSelect(item()!)}
                />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
