// The optional extra fonts: colour emoji and scripts the built-in fonts lack.
// The add-on downloads them (addon/fonts.py) and serves them under
// /files/fonts, whose fonts.css sets the --extra-fonts list in theme.css.
// Oriel offers the download once, when Plex first sends text in one of the
// scripts they add.

import { ORIGIN } from '@oriel/web';
import { createEffect, createSignal } from 'solid-js';
import { send, state } from './bridge';
import { save, type Saved } from './store';

// Built from the scripts the add-on reports, so text that arrives before its
// first state goes unchecked.
let pattern: { scripts: string; test: RegExp } | undefined;

function missing(): RegExp | undefined {
  const scripts = state.fonts?.scripts ?? [];
  if (!scripts.length) return undefined;
  const key = scripts.join();
  if (pattern?.scripts !== key) pattern = { scripts: key, test: new RegExp(`[${scripts.map((s) => `\\p{Script=${s}}`).join('')}]`, 'u') };
  return pattern.test;
}

const [seen, setSeen] = createSignal(false);
const [asked, setAsked] = createSignal(true);

/** Check text from Plex for characters only the extra fonts draw. */
export function noteText(text: string): void {
  if (!seen() && missing()?.test(text)) setSeen(true);
}

export function loadFontsAsked(saved: Saved): void {
  setAsked(!!saved.fontsAsked);
}

/** Offer the download: Plex sent such text, the fonts are missing and Oriel hasn't asked before. */
export const fontsOffered = () => seen() && !asked() && state.fonts?.status === 'missing';

export function answerFonts(download: boolean): void {
  setAsked(true);
  save({ fontsAsked: true }).catch((e) => console.error(`fonts: ${e}`));
  if (download) send({ cmd: 'fonts-install' });
}

export const fontsSize = () => Math.round((state.fonts?.size ?? 0) / 1e6);

/** Link fonts.css while fonts are installed, including an older version. */
export function linkFonts(): void {
  createEffect(() => {
    const version = state.fonts?.version;
    let link = document.getElementById('fonts') as HTMLLinkElement | null;
    if (link?.dataset.version === version) return;
    link?.remove();
    if (!version) return;
    link = document.createElement('link');
    link.id = 'fonts';
    link.rel = 'stylesheet';
    link.href = `${ORIGIN}/files/fonts/fonts.css?v=${version}`;
    link.dataset.version = version;
    document.head.append(link);
  });
  createEffect(() => {
    const error = state.fonts?.error;
    if (error) console.error(`fonts: ${error}`);
  });
}
