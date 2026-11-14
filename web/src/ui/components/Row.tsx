import { createEffect, createSignal, Index, on, onCleanup, Show } from 'solid-js';
import type { Item } from '../../media/model';
import { claimFocus, type Direction, focused as focusedEl, focusOn } from '../../nav';
import { preload } from '../preload';
import { SIZES, Tile, tileImageUrl, type TileShape } from './Tile';
import './row.css';

const GAP = 32;

export interface RowProps {
  title: string;
  /** Undefined while loading: placeholder tiles hold the row's place and
   * take focus, and the same tiles show the items when they arrive. */
  items: Item[] | undefined;
  shape?: TileShape;
  /** Screen-unique key used to restore row focus. */
  group: string;
  autofocus?: boolean;
  /** Initial tile id to focus and scroll into view. */
  focusKey?: string;
  /** Tile id that Up and Down enter the row at until it has had the focus;
   * the row stays where it is and takes no focus. */
  enterKey?: string;
  onFocus?: (item: Item) => void;
  onSelect: (item: Item) => void;
  /** Number of caption lines passed to Tile. */
  lines?: (item: Item) => [string, string];
  /** Return true to handle an arrow on a tile, as for Tile. */
  onArrow?: (d: Direction) => boolean;
}

/** Scroll the focused tile to the row's first slot; Up and Down enter the row there. */
export function Row(props: RowProps) {
  const [col, setCol] = createSignal(Math.max(0, props.items?.findIndex((m) => m.id === props.focusKey) ?? 0));
  const [visited, setVisited] = createSignal(false);
  const shape = () => props.shape ?? 'poster';
  const step = () => SIZES[shape()].w + GAP;
  const placeholders = () => Array.from<undefined>({ length: Math.ceil(window.innerWidth / step()) });
  let section!: HTMLElement;
  // Read from key handlers through the tile's `entry` getter: a plain function,
  // since a conditional written in the JSX would compile to a memo there.
  const isEntry = (i: number, item: Item | undefined) => {
    const key = props.enterKey;
    if (!visited() && key && props.items?.some((m) => m.id === key)) return item?.id === key;
    return i === col();
  };

  let preloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(preloadTimer));
  // The placeholder focused last, while the row waits for its items.
  let placeholder: number | undefined;
  const focused = (i: number, item: Item | undefined) => {
    setCol(i);
    setVisited(true);
    placeholder = item ? undefined : i;
    if (!item || !props.items) return;
    props.onFocus?.(item);
    // Decode nearby images after scrolling settles to keep loading work out of the animation.
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
      for (const m of props.items?.slice(i + 1, i + 7) ?? []) {
        const url = tileImageUrl(m, shape());
        if (url) preload(url);
      }
    }, 300);
  };

  // Placeholders start the row over. When items replace them, a focused
  // placeholder shows its item, or the last item if there are fewer items
  // than placeholders; otherwise the row moves to focusKey's tile, which
  // takes the focus as an autofocus tile would.
  let waiting = !props.items;
  createEffect(
    on(
      () => props.items,
      (items) => {
        if (!items) {
          waiting = true;
          return setCol(0);
        }
        if (!waiting) {
          // A reload can change the focused tile's item without moving focus;
          // report the new one so the page's information follows.
          const held = focusedEl();
          const i = held && section.contains(held) ? Number(held.dataset.index) : -1;
          if (items[i]) focused(i, items[i]);
          return;
        }
        waiting = false;
        // A focused placeholder that had no item is gone, and nothing has the focus.
        const held = focusedEl();
        const at = held ? (section.contains(held) ? Number(held.dataset.index) : undefined) : placeholder;
        placeholder = undefined;
        if (at !== undefined) {
          const i = Math.min(at, items.length - 1);
          const tile = section.querySelector<HTMLElement>(`[data-index="${i}"]`);
          if (tile === held) focused(i, items[i]);
          else if (tile) focusOn(tile);
          return;
        }
        const i = items.findIndex((m) => m.id === props.focusKey);
        const tile = props.focusKey ? section.querySelector<HTMLElement>(`[data-index="${i}"]`) : null;
        if (!tile) return;
        setCol(i);
        claimFocus(tile);
      },
      { defer: true },
    ),
  );

  return (
    <section class="row" ref={section}>
      <Show when={props.title}>
        <h2>{props.title}</h2>
      </Show>
      <div class="tiles" style={{ transform: `translateX(${-col() * step()}px)`, gap: `${GAP}px` }}>
        <Index each={props.items ?? placeholders()}>
          {(item, i) => (
            <Tile
              item={item()}
              shape={shape()}
              group={props.group}
              entry={isEntry(i, item())}
              autofocus={props.focusKey ? item()?.id === props.focusKey : props.autofocus && i === 0}
              index={i}
              lines={props.lines}
              onArrow={props.onArrow}
              onFocus={() => focused(i, item())}
              onSelect={() => props.onSelect(item()!)}
            />
          )}
        </Index>
      </div>
    </section>
  );
}
