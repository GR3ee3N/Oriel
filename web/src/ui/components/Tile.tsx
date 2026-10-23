import { Show } from 'solid-js';
import { play } from '../../actions';
import { focusable } from '@oriel/web';
import { isWatched, progress, tileSubtitle, tileTitle, unwatched } from '../../plex/format';
import { imageUrl } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
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
  autofocus?: boolean;
  /** Override the default title/year or show/episode caption pair. */
  lines?: (m: Metadata) => [string, string];
  index?: number;
  onFocus?: () => void;
  onSelect: () => void;
}

export function Tile(props: TileProps) {
  const shape = () => props.shape ?? 'poster';
  const size = () => SIZES[shape()];
  const src = () => {
    const path = props.item && tileImage(props.item, shape());
    return path ? imageUrl(currentServer(), path, size().w, size().h) : undefined;
  };
  return (
    <div
      class={`tile ${shape()}`}
      data-index={props.index}
      style={{ width: `${size().w}px` }}
      ref={(el) =>
        focusable(el, {
          group: props.group,
          autofocus: props.autofocus,
          onFocus: props.onFocus,
          onSelect: () => props.item && props.onSelect(),
          onPlay: () => props.item && play(props.item),
        })
      }
    >
      <Show when={props.item}>
        {(item) => (
          <>
            <div class="art" style={{ height: `${size().h}px` }}>
              <Show when={src()} fallback={<div class="noimg">{tileTitle(item())}</div>}>
                {(s) => <img src={s()} alt="" decoding="async" />}
              </Show>
              <Show when={progress(item()) > 0}>
                <div class="progress">
                  <div style={{ transform: `scaleX(${progress(item())})` }} />
                </div>
              </Show>
              <Show when={isWatched(item())}>
                <div class="watched">✓</div>
              </Show>
              <Show when={unwatched(item())}>{(n) => <div class="count">{n()}</div>}</Show>
            </div>
            <div class="caption">
              <b>{(props.lines?.(item()) ?? [tileTitle(item()), ''])[0]}</b>
              <span>{props.lines ? props.lines(item())[1] : tileSubtitle(item())}</span>
            </div>
          </>
        )}
      </Show>
      <Show when={!props.item}>
        <div class="art" style={{ height: `${size().h}px` }} />
      </Show>
    </div>
  );
}
