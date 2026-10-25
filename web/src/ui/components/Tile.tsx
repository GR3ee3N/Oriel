import { createSignal, Show } from 'solid-js';
import { play } from '../../actions';
import { type Direction, focusable } from '../../nav';
import { isWatched, progress, tileSubtitle, tileTitle, unwatched } from '../../plex/format';
import { imageUrl } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { episodeTitle, hidden } from '../spoilers';
import { Icon } from './Icon';
import './tile.css';

export type TileShape = 'poster' | 'wide';

export const SIZES: Record<TileShape, { w: number; h: number }> = {
  poster: { w: 220, h: 330 },
  wide: { w: 400, h: 225 },
};

/** Use posters for portrait tiles, including the show's poster for episodes.
 * Wide tiles use episode stills or item artwork. */
export function tileImage(m: Metadata, shape: TileShape): string | undefined {
  if (shape === 'wide') return m.type === 'episode' ? (m.thumb ?? m.art) : (m.art ?? m.thumb);
  if (m.type === 'episode') return m.grandparentThumb ?? m.parentThumb ?? m.thumb;
  if (m.type === 'season') return m.thumb ?? m.parentThumb;
  return m.thumb;
}

export interface TileProps {
  /** Undefined items render focusable placeholders while loading. */
  item?: Metadata;
  shape?: TileShape;
  group?: string;
  /** Enter the group here, as at a scrolling row's first visible tile. */
  entry?: boolean;
  autofocus?: boolean;
  /** Override the default title/year or show/episode caption pair. */
  lines?: (m: Metadata) => [string, string];
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
  const [failed, setFailed] = createSignal(false);
  // Spoiler protection swaps an unwatched episode's still for the show's art.
  const src = () => {
    const m = props.item;
    const path = m && (hidden(m) && shape() === 'wide' ? (m.grandparentArt ?? m.grandparentThumb) : tileImage(m, shape()));
    return path && !failed() ? imageUrl(currentServer(), path, size().w, size().h) : undefined;
  };
  const lines = (m: Metadata): [string, string] =>
    props.lines?.(m) ?? [tileTitle(m), tileSubtitle(hidden(m) ? { ...m, title: episodeTitle(m) } : m, shape() === 'wide')];
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
          onFocus: props.onFocus,
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
              <Show when={src()} fallback={<div class="noimg">{tileTitle(item())}</div>}>
                {(s) => <img src={s()} alt="" decoding="async" onError={() => setFailed(true)} />}
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
      <Show when={props.item} fallback={<div class="caption placeholder"><i /><i /></div>}>
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
