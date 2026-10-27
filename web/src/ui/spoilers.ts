// Spoiler protection: with the profile's setting on, unwatched episodes show
// their number, "[Spoilers removed]" for their title, summary and chapter
// names, and stills blurred by Plex. Seeking shows no preview pictures.
// Partial progress doesn't count as watched. Reveal on the show page lifts it
// for one episode until focus leaves it.

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

/** Episode title as shown. */
export function episodeTitle(m: Metadata): string {
  return hidden(m) ? t('episode.spoilers') : m.title;
}

/** An episode's summary or chapter name as shown; absent text stays absent. */
export function episodeText(m: Metadata | undefined, text: string | undefined): string | undefined {
  return text && hidden(m) ? t('episode.spoilers') : text;
}
