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

/** A show page's season tabs. */
export function SeasonsSkeleton() {
  return (
    <div class="seasons skeleton">
      <i />
      <i />
      <i />
    </div>
  );
}

/** A detail page's info and buttons; a show's adds season tabs and episodes. */
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
          <SeasonsSkeleton />
          <SkeletonCards count={5} width={400} height={225} />
        </div>
      </Show>
    </>
  );
}
