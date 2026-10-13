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
  /** A unique name in the screen: the row remembers its focus under it. */
  group: string;
  autofocus?: boolean;
  /** The ratingKey of a tile to take the focus (and scroll to) at first. */
  focusKey?: string;
  onFocus?: (item: Metadata) => void;
  onSelect: (item: Metadata) => void;
  /** Caption lines per tile (Tile's `lines`). */
  lines?: (m: Metadata) => [string, string];
}

/** A titled row of tiles that scrolls sideways with the focus, keeping one
 * tile of context to the left. */
export function Row(props: RowProps) {
  const [col, setCol] = createSignal(Math.max(0, props.items.findIndex((m) => m.ratingKey === props.focusKey)));
  const shape = () => props.shape ?? 'poster';
  const step = () => SIZES[shape()].w + GAP;

  let preloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(preloadTimer));
  const focused = (i: number, item: Metadata) => {
    setCol(i);
    props.onFocus?.(item);
    // Keep the next few images decoded ahead of the focus, once the slide
    // is over (loading and decoding them during it costs it frames).
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
