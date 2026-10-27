import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { Direction } from '../../nav';
import { preload } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { SIZES, Tile, tileImageUrl, type TileShape } from './Tile';
import './row.css';

const GAP = 32;

export interface RowProps {
  title: string;
  items: Metadata[];
  shape?: TileShape;
  /** Screen-unique key used to restore row focus. */
  group: string;
  autofocus?: boolean;
  /** Initial tile ratingKey to focus and scroll into view. */
  focusKey?: string;
  onFocus?: (item: Metadata) => void;
  onSelect: (item: Metadata) => void;
  /** Number of caption lines passed to Tile. */
  lines?: (m: Metadata) => [string, string];
  /** Return true to handle an arrow on a tile, as for Tile. */
  onArrow?: (d: Direction) => boolean;
}

/** Scroll the focused tile to the row's first slot; Up and Down enter the row there. */
export function Row(props: RowProps) {
  const [col, setCol] = createSignal(Math.max(0, props.items.findIndex((m) => m.ratingKey === props.focusKey)));
  const shape = () => props.shape ?? 'poster';
  const step = () => SIZES[shape()].w + GAP;

  let preloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(preloadTimer));
  const focused = (i: number, item: Metadata) => {
    setCol(i);
    props.onFocus?.(item);
    // Decode nearby images after scrolling settles to keep loading work out of the animation.
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
      for (const m of props.items.slice(i + 1, i + 7)) {
        const url = tileImageUrl(m, shape());
        if (url) preload(url);
      }
    }, 300);
  };

  return (
    <section class="row">
      <Show when={props.title}>
        <h2>{props.title}</h2>
      </Show>
      <div class="tiles" style={{ transform: `translateX(${-col() * step()}px)`, gap: `${GAP}px` }}>
        <For each={props.items}>
          {(item, i) => (
            <Tile
              item={item}
              shape={shape()}
              group={props.group}
              entry={i() === col()}
              autofocus={props.focusKey ? item.ratingKey === props.focusKey : props.autofocus && i() === 0}
              index={i()}
              lines={props.lines}
              onArrow={props.onArrow}
              onFocus={() => focused(i(), item)}
              onSelect={() => props.onSelect(item)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
