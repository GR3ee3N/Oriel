// The strip under the OSD controls: the playing item's chapters and its play
// queue, a page each.

import { createEffect, createSignal, For, on, onMount, Show } from 'solid-js';
import { state } from '../bridge';
import { t } from '../i18n';
import { clean, clock, duration as length, episodeCode, remaining } from '../media/format';
import type { Item } from '../media/model';
import { provider } from '../media/servers';
import { type Direction, focusable, focused, focusOn, onBack } from '../nav';
import { currentChapter } from '../player/chapters';
import { loadAround, playback, playEntry, playQueue, seekTo } from '../player/playback';
import { more, position } from '../player/queue';
import { episodeText, episodeTitle, hidden } from '../spoilers';
import { CHEVRON, Icon } from './OsdIcon';

export type StripPage = 'chapters' | 'queue';

// Strip cards: 304 px wide with 24 px between them; five fit the panel.
const PITCH = 328;
const SHOWN = 5;

/** Show or movie title of a queue entry. */
export const entryTitle = (m: Item) => clean(m.kind === 'episode' ? m.show?.title : m.title);
/** An episode's number & title, or a movie's
 * year & length; with `left`, the number or year & the time left. */
export function entryLine(m: Item, left = false): string {
  const episode = m.kind === 'episode';
  const parts = left ? [episode ? episodeCode(m) : m.year, remaining(m)] : episode ? [episodeCode(m), clean(episodeTitle(m))] : [m.year, length(m.duration)];
  return parts.filter(Boolean).join(' · ');
}
/** A 16:9 picture of an entry: an episode's still, a movie's backdrop. */
export const still = (m: Item) => (m.kind === 'episode' ? m.art.image : (m.art.backdrop ?? m.art.image));

/** One page of chapters or queue entries under the OSD controls, under its
 * name, with a Down chevron when another page follows. It opens on the
 * current chapter or the playing entry; Left/Right move along it, Up and Down
 * change page, and Up from the first page or Back closes it. */
export function Strip(props: { page: StripPage; pages: StripPage[]; onPage: (page: StripPage) => void; onClose: () => void }) {
  const p = playback()!;
  const server = provider();
  const cards: HTMLElement[] = [];
  const [first, setFirst] = createSignal(0);
  onBack(props.onClose);

  const at = props.pages.indexOf(props.page);
  const arrow = (el: HTMLElement) => (d: Direction) => {
    if (d === 'left' || d === 'right') {
      // The neighbouring card, which stays right as queue entries load before the window.
      const to = d === 'left' ? el.previousElementSibling : el.nextElementSibling;
      if (to) focusOn(to as HTMLElement);
    } else if (d === 'up') {
      if (at > 0) props.onPage(props.pages[at - 1]);
      else props.onClose();
    } else if (props.pages[at + 1]) props.onPage(props.pages[at + 1]);
    return true;
  };
  // Keep the focused card in view with one card of context on either side.
  const place = (i: number) => setFirst((f) => (i <= f ? Math.max(0, i - 1) : i >= f + SHOWN - 1 ? i - SHOWN + 2 : f));
  const card = (i: () => number, onSelect: () => void, onFocus?: () => void) => (el: HTMLElement) => {
    cards[i()] = el;
    // Entries loaded before the window move the focused card along; keep it where it is on screen.
    createEffect(on(i, (n, was) => focused() === el && setFirst((f) => f + n - was!), { defer: true }));
    focusable(el, {
      scope: 'osd',
      group: 'osd-strip',
      onSelect,
      onArrow: arrow(el),
      onFocus: () => {
        place(i());
        onFocus?.();
      },
    });
  };
  const open = (i: number) =>
    onMount(() => {
      setFirst(Math.max(0, i - 1));
      if (cards[i]) focusOn(cards[i]);
    });

  if (props.page === 'chapters') {
    const now = () => currentChapter(p.chapters, state.player.time);
    open(Math.max(0, now()));
    return (
      <div class="strip">
        <StripHead pages={props.pages} page={props.page} count={t('player.position', { n: Math.max(1, now() + 1), total: p.chapters.length })} />
        <div class="strip-row" style={{ transform: `translateX(${-first() * PITCH}px)` }}>
          <For each={p.chapters}>
            {(c, i) => (
              <div
                class="s-card"
                ref={card(i, () => {
                  seekTo(c.start);
                  props.onClose();
                })}
              >
                <div class="pic">
                  <Show when={c.thumb} fallback={<div class="num">{c.n}</div>}>
                    {(thumb) => <img src={server.image(thumb(), 304, 171, { blur: hidden(p.item) })} alt="" />}
                  </Show>
                  <Show when={i() === now()}>
                    <span class="tag">{t('player.now')}</span>
                  </Show>
                </div>
                <b>{episodeText(p.item, c.title) || t('player.chapter', { n: c.n })}</b>
                <span>{clock(c.start)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    );
  }

  const q = () => playQueue()!;
  const playingAt = () => q().entries.findIndex((e) => e.entry === p.entry);
  const count = () => {
    const n = position(q(), p.entry) ?? 1;
    return t(q().shuffled ? 'player.shuffled' : 'player.position', { n, total: q().total });
  };
  // Load more of the queue as focus nears either end of the loaded window.
  const near = (i: number) => {
    const entries = q().entries;
    if (i >= entries.length - 4 && more(q(), 'after')) loadAround(entries[entries.length - 1].entry);
    if (i <= 3 && more(q(), 'before')) loadAround(entries[0].entry);
  };
  open(Math.max(0, playingAt()));
  return (
    <div class="strip">
      <StripHead pages={props.pages} page={props.page} count={count()} />
      <div class="strip-row" style={{ transform: `translateX(${-first() * PITCH}px)` }}>
        <For each={q().entries}>
          {(e, i) => {
            const m = e.item;
            const playing = () => e.entry === p.entry;
            const progress = () => (playing() ? state.player.time / (state.player.duration || 1) : m.position && m.duration ? m.position / m.duration : 0);
            return (
              <div class="s-card" ref={card(i, () => (playing() ? props.onClose() : playEntry(e)), () => near(i()))}>
                <div class="pic">
                  <Show when={still(m)} fallback={<div class="num">{m.kind === 'episode' ? `E${m.number ?? ''}` : ''}</div>}>
                    {(path) => <img src={server.image(path(), 304, 171, { blur: hidden(m) })} alt="" />}
                  </Show>
                  <Show when={playing()}>
                    <span class="tag">{t('player.playing')}</span>
                  </Show>
                  <Show when={i() === playingAt() + 1}>
                    <span class="tag soft">{t('player.nextTag')}</span>
                  </Show>
                  <Show when={progress() > 0}>
                    <div class="bar">
                      <i style={{ transform: `scaleX(${progress()})` }} />
                    </div>
                  </Show>
                </div>
                <b>{entryTitle(m)}</b>
                <span>{entryLine(m, !playing() && !!m.position)}</span>
              </div>
            );
          }}
        </For>
        <Show when={more(q(), 'after')}>
          <div class="s-card skel">
            <div class="pic" />
          </div>
        </Show>
      </div>
    </div>
  );
}

/** The page's name and count; the chevron at the panel's foot shows while a
 * page follows. */
function StripHead(props: { pages: StripPage[]; page: StripPage; count: string }) {
  const more = props.pages.indexOf(props.page) < props.pages.length - 1;
  return (
    <>
      <div class="strip-head">
        <b>{t(props.page === 'chapters' ? 'player.chapters' : 'player.queue')}</b>
        <small>{props.count}</small>
      </div>
      <Show when={more}>
        <Icon d={CHEVRON} class="strip-hint" />
      </Show>
    </>
  );
}
