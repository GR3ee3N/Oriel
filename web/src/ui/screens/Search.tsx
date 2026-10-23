import { createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { open } from '../../actions';
import { activeScope, focusable, useScope } from '@oriel/web';
import { search } from '../../plex/api';
import { clean } from '../../plex/format';
import { currentServer } from '../../session';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { TopNav } from '../components/TopNav';
import './search.css';

const KEYS = [...'abcdefghijklmnopqrstuvwxyz1234567890'];
const TITLES: Record<string, string> = { movie: 'Movies', show: 'Shows', episode: 'Episodes', collection: 'Collections' };

/** Debounce typed searches and show result rows beside the on-screen keyboard. */
export function Search() {
  const [query, setQuery] = createSignal('');
  const [settled, setSettled] = createSignal('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(query, (q) => {
      clearTimeout(timer);
      timer = setTimeout(() => setSettled(q.trim()), 400);
    }),
  );
  onCleanup(() => clearTimeout(timer));
  const [results] = createResource(
    () => settled() || null,
    (q) => search(currentServer(), q),
  );

  const type = (k: string) => setQuery((q) => (k === 'del' ? q.slice(0, -1) : k === 'clear' ? '' : q + k));
  // Accept remote keyboard input only while Search is the active screen.
  const scope = useScope();
  const onKey = (e: KeyboardEvent) => {
    if (activeScope() !== scope) return;
    if (e.key.length === 1 && /[\p{L}\p{N} ]/u.test(e.key)) type(e.key.toLowerCase());
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const key = (k: string, label: string, wide = false) => (
    <div class="key" classList={{ wide }} ref={(el) => focusable(el, { group: 'keyboard', autofocus: k === 'a', onSelect: () => type(k) })}>
      {label}
    </div>
  );

  return (
    <div class="search">
      <div class="screen-bg" />
      <TopNav />
      <div class="keyboard">
        <div class="query">
          {query() || <span class="dim">Search</span>}
          <span class="caret" />
        </div>
        <div class="keys">
          <For each={KEYS}>{(k) => key(k, k)}</For>
          {key(' ', 'Space', true)}
          {key('del', 'Delete', true)}
          {key('clear', 'Clear', true)}
        </div>
      </div>
      <div class="results">
        <Show when={!settled()}>
          <div class="search-hint">
            <h2>Find movies, shows, episodes and collections</h2>
            <p class="dim">Results come as you type. A remote with a keyboard types straight in.</p>
          </div>
        </Show>
        <Show when={settled() && results() && !results()!.length}>
          <p class="dim">Nothing found for “{settled()}”.</p>
        </Show>
        <Show when={results.error}>
          <p class="error">Search failed: {String(results.error)}</p>
        </Show>
        <Shelf class="results-shelf">
          <For each={results()}>
            {(hub) => (
              <div>
                <Row
                  title={TITLES[hub.type] ?? clean(hub.title)}
                  items={hub.Metadata ?? []}
                  shape={hub.type === 'episode' ? 'wide' : 'poster'}
                  group={`results-${hub.type}`}
                  onSelect={open}
                />
              </div>
            )}
          </For>
        </Shelf>
      </div>
    </div>
  );
}
