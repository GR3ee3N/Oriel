// Spoiler protection: with the profile's setting on, unwatched episodes show
// their number but not their title, summary or still. Partial progress
// doesn't count as watched. Reveal on the show page lifts it for one
// episode until focus leaves it.

import { createSignal } from 'solid-js';
import { t } from '../i18n';
import type { Metadata } from '../plex/types';
import { hidesUnwatched } from '../prefs';
import { session } from '../session';

const [revealed, setRevealed] = createSignal<string>();
export { setRevealed };

export function hidden(m: Metadata | undefined): boolean {
  if (!m || m.type !== 'episode' || (m.viewCount ?? 0) > 0) return false;
  return hidesUnwatched(session.user?.uuid) && revealed() !== m.ratingKey;
}

/** Episode title as shown: "Episode 3" while hidden. */
export function episodeTitle(m: Metadata): string {
  return hidden(m) ? t('episode.number', { n: m.index ?? '' }) : m.title;
}
