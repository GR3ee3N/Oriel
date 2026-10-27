import { createSignal, For, type JSX, Show } from 'solid-js';
import { t } from '../../i18n';
import { ageRating, clean, duration, episodeCode, remaining, seasonCount } from '../../plex/format';
import { logoOf, logoUrl, preload } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { episodeTitle } from '../spoilers';
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
 * season title, episode count and the show's year, or year, duration/season
 * count and ratings for other items. */
export function metaFor(m: Metadata, showRemaining = true): JSX.Element {
  const left = showRemaining ? remaining(m) : undefined;
  if (m.type === 'episode') {
    return <Meta parts={[episodeCode(m), clean(episodeTitle(m)), duration(m.duration)]} accent={left} />;
  }
  if (m.type === 'season') {
    return <Meta parts={[clean(m.title), m.leafCount && t('count.episodes', { n: m.leafCount }), m.parentYear]} accent={left} />;
  }
  const length = m.type === 'show' ? seasonCount(m) : duration(m.duration);
  return (
    <Meta
      parts={[m.year, length, ageRating(m.contentRating), m.audienceRating ? `★ ${m.audienceRating.toFixed(1)}` : '']}
      accent={left}
    />
  );
}

/** Reduce long title text from the layout's --title-size to fit within two lines. */
function Title(props: { text: string }) {
  const scale = () => {
    const n = props.text.length;
    return n > 40 ? 0.62 : n > 24 ? 0.78 : 1;
  };
  return (
    <h1 class="info-title" style={{ 'font-size': `calc(var(--title-size) * ${scale()})` }}>
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
          fallback={<Title text={props.title ?? clean(props.item.title)} />}
        >
          {(src) => <img class="info-logo" src={src()} alt="" onError={() => setFailedLogo(src())} />}
        </Show>
      </div>
      <Show when={props.meta || props.badges?.length}>
        <div class="info-meta">
          {props.meta}
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
          {clean(props.summary)}
        </p>
      </Show>
      {props.children}
    </div>
  );
}
