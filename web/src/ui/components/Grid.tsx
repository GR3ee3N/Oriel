import { createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, Show } from 'solid-js';
import { focusOn } from '../../nav';
import { dataVersion } from '../../data';
import { t } from '../../i18n';
import { tileSubtitle, tileTitle } from '../../plex/format';
import type { MediaContainer, Metadata } from '../../plex/types';
import { Button, Message } from './Controls';
import { SIZES, Tile } from './Tile';
import './grid.css';

export const COLS = 6;
const GAP = 24;
// Poster, caption and row gap.
const PITCH = 436;
const PAGE = 72;
/** Render extra rows above and below focus so tiles load posters in advance.
 * Avoid separate preloads: decoding a second copy can blank a visible poster. */
const BEFORE = 2;
const AFTER = 3;

export interface GridProps {
  /** Load `size` items at offset `start`; the response must include totalSize. */
  load: (start: number, size: number) => Promise<MediaContainer>;
  /** A new key reloads from the first page; the old items stay until it arrives. */
  key: string;
  onSelect: (item: Metadata) => void;
  onTotal?: (total: number) => void;
  /** True while a new key's first page is loading. */
  onPending?: (pending: boolean) => void;
  /** Jump to an item from the A–Z strip; increment `n` to repeat the same index. */
  jump?: { index: number; n: number };
  /** Shown when the server returns no items. */
  empty?: JSX.Element;
  /** Dim an item's poster, e.g. a Watchlist title missing from the server. */
  dim?: (m: Metadata) => boolean;
  /** Caption override, as for Tile. */
  lines?: (m: Metadata) => [string, string] | undefined;
  class?: string;
}

/** Virtualize posters around the focused row, aligned at the top.
 * Load pages as focus approaches them and position tiles absolutely. */
export function Grid(props: GridProps) {
  // Keep metadata in plain objects to avoid deep reactive-store wrapping overhead.
  const [items, setItems] = createSignal<(Metadata | undefined)[]>([]);
  const [total, setTotal] = createSignal<number>();
  const [row, setRow] = createSignal(0);
  const [failed, setFailed] = createSignal(false);

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
  // A new key's first page replaces the previous items in one step.
  let replacing = false;

  const loadPage = (page: number) => {
    if (pages.has(page)) return;
    pages.add(page);
    const gen = generation;
    props
      .load(page * PAGE, PAGE)
      .then((mc) => {
        if (gen !== generation) return;
        const size = mc.totalSize ?? mc.size;
        const fresh = replacing;
        if (fresh) {
          replacing = false;
          setRow(0);
          setAround(0);
          props.onPending?.(false);
        }
        if (fresh || size !== total()) {
          setTotal(size);
          props.onTotal?.(size);
        }
        setItems((list) => {
          const next = fresh ? [] : list.slice();
          (mc.Metadata ?? []).forEach((m, i) => (next[page * PAGE + i] = m));
          return next;
        });
        setFailed(false);
      })
      .catch((e) => {
        if (gen !== generation) return;
        console.error(`grid: ${e}`);
        pages.delete(page);
        setFailed(true);
      });
  };

  createEffect(
    on(
      () => props.key,
      (_, previous) => {
        generation++;
        pages = new Set();
        setFailed(false);
        replacing = previous !== undefined;
        if (replacing) props.onPending?.(true);
        else {
          setItems([]);
          setTotal(undefined);
        }
        loadPage(0);
      },
    ),
  );

  // Load pages covering rendered rows and the next rows ahead.
  const loadAround = () => {
    const n = total();
    if (n === undefined || replacing) return;
    const first = Math.max(0, around() - BEFORE) * COLS;
    const last = Math.min(n - 1, (around() + AFTER + 2) * COLS);
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

  const retry = () => {
    generation++;
    pages = new Set();
    setFailed(false);
    if (total() === undefined || replacing) loadPage(0);
    else loadAround();
  };

  // Render the jump target's row before focusing its tile on the next frame.
  createEffect(
    on(
      () => props.jump,
      (jump) => {
        if (!jump) return;
        const n = total() ?? 0;
        const index = Math.min(jump.index, Math.max(0, n - 1));
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
    const n = total() ?? 0;
    const from = Math.max(0, around() - BEFORE) * COLS;
    const to = Math.min(n, (around() + AFTER + 1) * COLS);
    return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  };

  const { w } = SIZES.poster;
  // Arrows from outside the grid return to the tile focused last.
  const [last, setLast] = createSignal(0);

  return (
    <div class={props.class ? `grid ${props.class}` : 'grid'}>
      <Show when={failed() && !items().length}>
        <Message icon="warning" title={t('error.page')}>
          <Button icon="restart" label={t('action.retry')} autofocus onSelect={retry} />
        </Message>
      </Show>
      <Show when={total() === 0 && !replacing}>{props.empty}</Show>
      <div class="grid-body" ref={body} style={{ transform: `translateY(${-row() * PITCH}px)` }}>
        <For each={visible()}>
          {(index) => {
            const item = createMemo(() => items()[index]);
            return (
              <div class="cell" style={{ left: `${(index % COLS) * (w + GAP)}px`, top: `${Math.floor(index / COLS) * PITCH}px` }}>
                <Tile
                  item={item()}
                  index={index}
                  group="grid"
                  entry={index === last()}
                  autofocus={index === 0}
                  dim={!!item() && props.dim?.(item()!)}
                  lines={props.lines && ((m) => props.lines!(m) ?? [tileTitle(m), tileSubtitle(m)])}
                  onFocus={() => {
                    setLast(index);
                    setRow(Math.floor(index / COLS));
                    if (failed()) retry();
                  }}
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
