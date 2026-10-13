import { createSignal, For, type JSX, Show } from 'solid-js';
import { clean, duration, episodeCode, remaining, seasonCount } from '../../plex/format';
import { logoOf, logoUrl, preload } from '../../plex/images';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import './info.css';

export const LOGO = { w: 720, h: 240 };

/** The logo URL of `m` (an episode's is its show's), if it has one. */
export function logoFor(m: Metadata | undefined): string | undefined {
  const path = logoOf(m);
  return path ? logoUrl(currentServer(), path, LOGO.w, LOGO.h) : undefined;
}

/** Waits for a decode attempt before swapping the info. Returns the URL even
 * if decoding fails; undefined means no logo or a timeout. */
export function logoReady(m: Metadata | undefined, wait = 500): Promise<string | undefined> {
  const url = logoFor(m);
  if (!url) return Promise.resolve(undefined);
  return Promise.race([
    preload(url).then(() => url),
    new Promise<undefined>((done) => setTimeout(done, wait)),
  ]);
}

/** Parts of a meta line with dots between them; empty parts are left out. */
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

/** The usual meta line of an item: an episode's code and title, a movie's
 * year, length, rating; and how much is left of a started one. */
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

/** A title as text: smaller the longer it is, two lines at most. */
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
  /** A logo URL; missing or failed images fall back to the title. */
  logo?: string;
  /** Overrides the title (an episode shows its show's). */
  title?: string;
  meta?: JSX.Element;
  badges?: string[];
  /** Keep the badges' line even while there are none (they may come a
   * moment later, and the summary must not move then). */
  reserveBadges?: boolean;
  /** The badges came after the rest: they fade in. */
  badgesLate?: boolean;
  summary?: string;
  size?: 'hero' | 'page';
  children?: JSX.Element;
}

/** Logo or title, meta line, badges, summary: the top of Home and of the
 * details pages. */
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
            {/* Keyed on the set: a new set fades in as one. */}
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
