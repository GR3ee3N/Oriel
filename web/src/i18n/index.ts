// Look up interface text. Only English exists; another language adds a
// table with the same keys and selects it in `strings`.

import { en, type Key } from './en';

export type { Key };

/** Interface language, sent to Plex so server-made titles such as
 * "Continue Watching" match the rest of the interface. */
export const LANGUAGE = 'en';

const strings: Record<string, string | { one: string; other: string }> = en;
const plural = new Intl.PluralRules('en');

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const entry = strings[key];
  const text = typeof entry === 'string' ? entry : entry[plural.select(Number(vars.n ?? 0)) === 'one' ? 'one' : 'other'];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
}
