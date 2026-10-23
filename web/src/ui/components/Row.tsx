import { createSignal, For, onCleanup, Show } from 'solid-js';
import { imageUrl, preload } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { SIZES, Tile, tileImage, type TileShape } from './Tile';
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
}

/** Scroll tiles with focus, retaining one tile of context on the left. */
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
      const { w, h } = SIZES[shape()];
      for (const m of props.items.slice(i + 1, i + 7)) {
        const path = tileImage(m, shape());
        if (path) preload(imageUrl(currentServer(), path, w, h));
      }
    }, 300);
  };

  return (
    <section class="row">
      <Show when={props.title}>
        <h2>{props.title}</h2>
      </Show>
      <div class="tiles" style={{ transform: `translateX(${-Math.max(0, col() - 1) * step()}px)`, gap: `${GAP}px` }}>
        <For each={props.items}>
          {(item, i) => (
            <Tile
              item={item}
              shape={shape()}
              group={props.group}
              autofocus={props.focusKey ? item.ratingKey === props.focusKey : props.autofocus && i() === 0}
              index={i()}
              lines={props.lines}
              onFocus={() => focused(i(), item)}
              onSelect={() => props.onSelect(item)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
