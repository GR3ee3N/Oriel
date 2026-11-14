// Spoiler protection: with the profile's setting on, unwatched episodes show
// their number, "[Spoilers removed]" for their title, summary and chapter
// names, and stills blurred by the server. Seeking shows no preview pictures.
// Partial progress doesn't count as watched. Reveal on the show page lifts it
// for one episode until focus leaves it.

import { createSignal } from 'solid-js';
import { t } from '../i18n';
import { hidesUnwatched } from '../prefs';
import { session } from '../session';
import { clean } from './format';
import type { Item } from './model';

type Episode = Pick<Item, 'id' | 'kind' | 'plays'>;

const [revealed, setRevealed] = createSignal<string>();
export { setRevealed };

export function hidden(item: Episode | undefined): boolean {
  if (!item || item.kind !== 'episode' || (item.plays ?? 0) > 0) return false;
  return hidesUnwatched(session.user?.id) && revealed() !== item.id;
}

/** Episode title as shown. */
export function episodeTitle(item: Episode & Pick<Item, 'title'>): string {
  return hidden(item) ? t('episode.spoilers') : item.title;
}

/** An episode's heading on its own screen: its title, or its number while
 * its title is removed. */
export function episodeHeading(item: Episode & Pick<Item, 'title' | 'number'>): string {
  return hidden(item) ? t('episode.number', { n: item.number ?? '' }) : clean(item.title);
}

/** An episode's summary or chapter name as shown; absent text stays absent. */
export function episodeText(item: Episode | undefined, text: string | undefined): string | undefined {
  return text && hidden(item) ? t('episode.spoilers') : text;
}
