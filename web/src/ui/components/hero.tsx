// Focused-item information above rows on Home and a library's Recommended
// view. Changes wait for focus to settle and for the title logo to decode,
// so the hero and backdrop change together and stay out of row animation.

import { createSignal, onCleanup, Show } from 'solid-js';
import { metadata } from '../../plex/api';
import { badges, clean } from '../../plex/format';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { episodeTitle, hidden } from '../spoilers';
import { Info, logoReady, metaFor } from './Info';

export interface HeroState {
  item: Metadata;
  logo?: string;
  /** Full metadata with streams, for HDR and audio badges. */
  full?: Metadata;
  /** Badges arrived after the rest and fade in. */
  late?: boolean;
}

export const backdropOf = (m: Metadata | undefined) => (m?.type === 'episode' ? (m.grandparentArt ?? m.art) : m?.art);

/** `onFirst` runs once the first item is shown, e.g. to release the splash. */
export function createHero(onFirst?: (item: Metadata) => void) {
  const [hero, setHero] = createSignal<HeroState>();
  let wanted: Metadata | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fullOf = (item: Metadata) => metadata(currentServer(), item.ratingKey).catch(() => undefined);

  /** Show `item` after focus settles; `around` are neighbours to fetch ahead. */
  const show = (item: Metadata, around: Metadata[] = []) => {
    wanted = item;
    clearTimeout(timer);
    timer = setTimeout(
      async () => {
        const first = !hero();
        const pending = fullOf(item);
        const [logo, full] = await Promise.all([
          logoReady(item),
          Promise.race([pending, new Promise<undefined>((done) => setTimeout(done, 350))]),
        ]);
        if (wanted !== item) return;
        setHero({ item, logo, full });
        if (!full) {
          pending.then((f) => {
            const h = hero();
            if (f && h?.item === item) setHero({ ...h, full: f, late: true });
          });
        }
        // Cache neighbouring metadata for the next focus move; entries last one minute.
        for (const m of around) void fullOf(m);
        if (first) onFirst?.(item);
      },
      hero() ? 300 : 0,
    );
  };
  onCleanup(() => clearTimeout(timer));

  return {
    hero,
    show,
    art: () => backdropOf(hero()?.item),
    colors: () => hero()?.item.UltraBlurColors ?? hero()?.full?.UltraBlurColors,
  };
}

export type Hero = ReturnType<typeof createHero>;

/** The hero's item information: the show's title for episodes, and no
 * episode title or summary while spoilers are hidden. */
export function HeroInfo(props: { hero: Hero }) {
  return (
    <Show when={props.hero.hero()}>
      {(h) => (
        <Info
          item={h().item}
          logo={h().logo}
          title={clean(h().item.type === 'episode' ? h().item.grandparentTitle : h().item.title)}
          meta={metaFor(hidden(h().item) ? { ...h().item, title: episodeTitle(h().item) } : h().item)}
          badges={h().full ? badges(h().full) : []}
          badgesLate={h().late}
          summary={hidden(h().item) ? undefined : h().item.summary}
          size="hero"
        />
      )}
    </Show>
  );
}

/** Neighbours of `item` in `items` worth fetching before focus reaches them. */
export function neighbours(items: Metadata[], item: Metadata): Metadata[] {
  const at = items.indexOf(item);
  return [...items.slice(at + 1, at + 3), ...items.slice(Math.max(0, at - 2), at)];
}
