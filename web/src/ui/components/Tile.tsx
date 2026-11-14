import { createSignal, Show } from 'solid-js';
import { play, prefetch } from '../../actions';
import type { Item } from '../../media/model';
import { provider } from '../../media/servers';
import { isWatched, progress, tileSubtitle, tileTitle, unwatched } from '../../media/format';
import { type Direction, focusable } from '../../nav';
import { episodeTitle, hidden } from '../../media/spoilers';
import { Icon } from './Icon';
import './tile.css';

export type TileShape = 'poster' | 'wide';

export const SIZES: Record<TileShape, { w: number; h: number }> = {
  poster: { w: 220, h: 330 },
  wide: { w: 400, h: 225 },
};

/** Use posters for portrait tiles, including the show's poster for episodes.
 * Wide tiles use episode stills or item artwork. */
export function tileImage(item: Item, shape: TileShape): string | undefined {
  const art = item.art;
  if (shape === 'wide') return item.kind === 'episode' ? (art.image ?? art.backdrop) : (art.backdrop ?? art.image);
  if (item.kind === 'episode') return art.showImage ?? art.seasonImage ?? art.image;
  if (item.kind === 'season') return art.image ?? art.showImage;
  return art.image;
}

export function tileImageUrl(item: Item, shape: TileShape): string | undefined {
  const path = tileImage(item, shape);
  const { w, h } = SIZES[shape];
  return path
    ? provider().image(path, w, h, { blur: hidden(item) && (shape === 'wide' || !(item.art.showImage || item.art.seasonImage)) })
    : undefined;
}

export interface TileProps {
  /** Undefined items render focusable placeholders while loading. */
  item?: Item;
  shape?: TileShape;
  group?: string;
  /** Enter the group here, as at a scrolling row's first visible tile. */
  entry?: boolean;
  autofocus?: boolean;
  /** Override the default title/year or show/episode caption pair. */
  lines?: (item: Item) => [string, string] | undefined;
  /** Dim the artwork, e.g. for a Watchlist title the server doesn't have. */
  dim?: boolean;
  index?: number;
  onFocus?: () => void;
  onSelect: () => void;
  /** Return true to handle an arrow instead of moving to the nearest element. */
  onArrow?: (d: Direction) => boolean;
}

export function Tile(props: TileProps) {
  const shape = () => props.shape ?? 'poster';
  const size = () => SIZES[shape()];
  // The URL that failed, so a placeholder or a reused tile's new item still loads.
  const [failed, setFailed] = createSignal<string>();
  const src = () => {
    const url = props.item && tileImageUrl(props.item, shape());
    return url !== failed() ? url : undefined;
  };
  const lines = (item: Item): [string, string] =>
    props.lines?.(item) ?? [tileTitle(item), tileSubtitle(hidden(item) ? { ...item, title: episodeTitle(item) } : item, shape() === 'wide')];
  return (
    <div
      class={`tile ${shape()}`}
      classList={{ dim: props.dim }}
      data-index={props.index}
      style={{ width: `${size().w}px` }}
      ref={(el) =>
        focusable(el, {
          group: props.group,
          get entry() {
            return props.entry;
          },
          autofocus: props.autofocus,
          onFocus: () => {
            props.onFocus?.();
            if (props.item) prefetch(props.item);
          },
          onArrow: props.onArrow,
          onSelect: () => props.item && props.onSelect(),
          onPlay: () => props.item && play(props.item),
        })
      }
    >
      <div class="art" style={{ height: `${size().h}px` }}>
        <Show when={props.item}>
          {(item) => (
            <>
              <Show when={src()} keyed fallback={<div class="noimg">{tileTitle(item())}</div>}>
                {(s) => <img src={s} alt="" decoding="async" onError={() => setFailed(s)} />}
              </Show>
              <Show when={progress(item()) > 0}>
                <div class="progress">
                  <div style={{ transform: `scaleX(${progress(item())})` }} />
                </div>
              </Show>
              <Show when={isWatched(item())}>
                <div class="watched">
                  <Icon name="check" />
                </div>
              </Show>
              <Show when={unwatched(item())}>{(n) => <div class="count">{n()}</div>}</Show>
            </>
          )}
        </Show>
      </div>
      <Show
        when={props.item}
        fallback={
          <div class="caption placeholder">
            <b>
              <i />
            </b>
            <span>
              <i />
            </span>
          </div>
        }
      >
        {(item) => (
          <div class="caption">
            <b>{lines(item())[0]}</b>
            <span>{lines(item())[1]}</span>
          </div>
        )}
      </Show>
    </div>
  );
}
