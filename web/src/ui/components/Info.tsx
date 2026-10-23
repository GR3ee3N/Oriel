import { createSignal, For, type JSX, Show } from 'solid-js';
import { clean, duration, episodeCode, remaining, seasonCount } from '../../plex/format';
import { logoOf, logoUrl, preload } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import './info.css';

export const LOGO = { w: 720, h: 240 };

/** Sized title-logo URL when supplied by Plex; episodes use the show logo. */
export function logoFor(m: Metadata | undefined): string | undefined {
  const path = logoOf(m);
  return path ? logoUrl(currentServer(), path, LOGO.w, LOGO.h) : undefined;
}

/** Wait for a logo decode attempt before changing item information.
 * Decode failure still returns the URL; absence or timeout returns undefined. */
export function logoReady(m: Metadata | undefined, wait = 500): Promise<string | undefined> {
  const url = logoFor(m);
  if (!url) return Promise.resolve(undefined);
  return Promise.race([
    preload(url).then(() => url),
    new Promise<undefined>((done) => setTimeout(done, wait)),
  ]);
}

/** Separate nonempty metadata values with dots. */
export function Meta(props: { parts: (JSX.Element | string | number | undefined | false)[]; accent?: string }) {
  const parts = () => props.parts.filter((p) => p !== undefined && p !== false && p !== '' && p !== 0);
  return (
    <>
      <For each={parts()}>
        {(p, i) => (
          <>
            <Show when={i() > 0}>
              <span class="sep">·</span>
            </Show>
            {p}
          </>
        )}
      </For>
      <Show when={props.accent}>
        <span class="sep" />
        <span class="accent">{props.accent}</span>
      </Show>
    </>
  );
}

/** Format item metadata and remaining time: episode code, title and duration,
 * or year, duration/season count and ratings for other items. */
export function metaFor(m: Metadata): JSX.Element {
  if (m.type === 'episode') {
    return <Meta parts={[episodeCode(m), clean(m.title), duration(m.duration)]} accent={remaining(m)} />;
  }
  const length = m.type === 'show' || m.type === 'season' ? seasonCount(m) : duration(m.duration);
  return (
    <Meta
      parts={[m.year, length, m.contentRating, m.audienceRating ? `★ ${m.audienceRating.toFixed(1)}` : '']}
      accent={remaining(m)}
    />
  );
}

/** Reduce long title text to fit within two lines. */
function Title(props: { text: string; size: 'hero' | 'page' }) {
  const scale = () => {
    const n = props.text.length;
    const base = props.size === 'hero' ? 76 : 60;
    return n > 40 ? base * 0.66 : n > 24 ? base * 0.8 : base;
  };
  return (
    <h1 class="info-title" style={{ 'font-size': `${scale()}px` }}>
      {props.text}
    </h1>
  );
}

export interface InfoProps {
  item: Metadata;
  /** Fall back to title text when the logo is absent or fails to load. */
  logo?: string;
  /** Optional title override, such as the show title for an episode. */
  title?: string;
  meta?: JSX.Element;
  badges?: string[];
  /** Reserve badge space so late metadata does not move the summary. */
  reserveBadges?: boolean;
  /** Fade in badges that arrive after the other metadata. */
  badgesLate?: boolean;
  summary?: string;
  size?: 'hero' | 'page';
  children?: JSX.Element;
}

/** Shared logo/title, metadata, badges and summary for Home and detail screens. */
export function Info(props: InfoProps) {
  const size = () => props.size ?? 'page';
  const [failedLogo, setFailedLogo] = createSignal<string>();
  return (
    <div class={`info info-${size()}`}>
      <div class="info-head">
        <Show
          when={props.logo !== failedLogo() ? props.logo : undefined}
          fallback={<Title text={props.title ?? clean(props.item.title)} size={size()} />}
        >
          {(src) => <img class="info-logo" src={src()} alt="" onError={() => setFailedLogo(src())} />}
        </Show>
      </div>
      <Show when={props.meta}>
        <div class="info-meta">{props.meta}</div>
      </Show>
      <Show when={props.badges?.length || props.reserveBadges}>
        <div class="badges">
          <Show when={props.badges?.length}>
            {/* Remount changed badge sets so they fade in together. */}
            <Show when={props.badges!.join(' ')} keyed>
              <div class="badge-set" classList={{ late: props.badgesLate }}>
                <For each={props.badges}>{(b) => <span class="badge">{b}</span>}</For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={props.summary}>
        <p class="info-summary">
          {props.summary}
        </p>
      </Show>
      {props.children}
    </div>
  );
}
