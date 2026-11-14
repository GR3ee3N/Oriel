import { For, Show } from 'solid-js';
import './skeleton.css';

// Blocks in the loaded page's geometry while it loads. They don't shimmer:
// an animation costs a raster every frame on the boxes.

/** A row of cards: artwork and two caption lines. */
export function SkeletonCards(props: { count: number; width: number; height: number }) {
  return (
    <div class="skeleton skeleton-cards">
      <For each={Array.from({ length: props.count })}>
        {() => (
          <div style={{ width: `${props.width}px` }}>
            <i style={{ height: `${props.height}px` }} />
            <i class="line" />
            <i class="line short" />
          </div>
        )}
      </For>
    </div>
  );
}

/** A detail page's info and buttons; a show's adds season posters. */
export function DetailSkeleton(props: { show?: boolean }) {
  return (
    <>
      <div class="details-info skeleton detail-skeleton" classList={{ 'show-info': props.show }}>
        <i class="logo" />
        <i class="meta" />
        <i class="line" />
        <i class="line" />
        <Show when={!props.show}>
          <i class="line short" />
          <i class="genres" />
        </Show>
        <div class="buttons">
          <i class="play" />
          <i />
          <i />
        </div>
      </div>
      <Show when={props.show}>
        <div class="skeleton episodes-skeleton">
          <SkeletonCards count={3} width={220} height={330} />
        </div>
      </Show>
    </>
  );
}
