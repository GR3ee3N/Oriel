import { createEffect, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { activeScope, focusable, useScope } from '../../nav';
import { open } from '../../actions';
import { type Key, t } from '../../i18n';
import { search } from '../../plex/api';
import { clean, episodeCode, hubTitle } from '../../plex/format';
import { currentServer, session } from '../../session';
import { episodeTitle } from '../spoilers';
import { Button } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Rail } from '../components/Rail';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { Status } from '../components/Status';
import './library.css';
import './search.css';

const KEYS = [...'abcdefghijklmnopqrstuvwxyz1234567890'];
const GROUPS: Record<string, Key> = {
  movie: 'search.movies',
  show: 'search.shows',
  episode: 'search.episodes',
  collection: 'search.collections',
};
const ORDER = ['movie', 'show', 'episode', 'collection'];

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
  const [results, { refetch }] = createResource(
    () => settled() || null,
    async (q) => (await search(currentServer(), q)).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)),
  );

  // Delete removes the last character, including one outside the BMP.
  const type = (k: string) => setQuery((q) => (k === 'del' ? [...q].slice(0, -1).join('') : k === 'clear' ? '' : q + k));
  // A keyboard types into the query while Search is the active screen; its
  // Backspace deletes.
  const scope = useScope();
  const onKey = (e: KeyboardEvent) => {
    if (activeScope() !== scope) return;
    if (e.key === 'Backspace') type('del');
    else if (e.key.length === 1 && /[\p{L}\p{N} ]/u.test(e.key)) type(e.key.toLowerCase());
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const key = (k: string, label: string, wide = false) => (
    <div class="key" classList={{ wide }} ref={(el) => focusable(el, { group: 'keyboard', area: 'keyboard', autofocus: k === 'a', onSelect: () => type(k) })}>
      {label}
    </div>
  );
  const server = () => session.serverName ?? '';

  return (
    <div class="search">
      <div class="screen-bg" />
      <Rail />
      <Status />
      <header class="page-head">
        <h1>{t('nav.search')}</h1>
      </header>
      <div class="keyboard">
        <div class="query">
          <Icon name="search" />
          <Show when={query()} fallback={<span class="placeholder">{t('search.placeholder')}</span>}>
            <span class="text">
              <span>{query()}</span>
            </span>
          </Show>
          <span class="caret" />
        </div>
        <div class="keys">
          <For each={KEYS}>{(k) => key(k, k)}</For>
          {key(' ', t('search.space'), true)}
          {key('del', t('search.delete'), true)}
          {key('clear', t('search.clear'), true)}
        </div>
      </div>
      <Switch>
        <Match when={!settled()}>
          <div class="search-note">
            <h2>{t('search.hint', { server: server() })}</h2>
          </div>
        </Match>
        <Match when={results.state === 'errored'}>
          <div class="search-note">
            <h2>{t('search.failed')}</h2>
            <div class="message-actions">
              <Button icon="restart" label={t('action.retry')} onSelect={refetch} />
            </div>
          </div>
        </Match>
        <Match when={results.state === 'ready' && !results()!.length}>
          <div class="search-note">
            <h2>{t('search.none', { server: server(), query: settled() })}</h2>
          </div>
        </Match>
      </Switch>
      <Shelf class="results-shelf">
        <For each={!settled() || results.state === 'errored' ? [] : results.latest}>
          {(hub) => (
            <div>
              <Row
                title={GROUPS[hub.type] ? t(GROUPS[hub.type]) : hubTitle(hub)}
                items={hub.Metadata ?? []}
                shape={hub.type === 'episode' ? 'wide' : 'poster'}
                group={`results-${hub.type}`}
                lines={hub.type === 'episode' ? (e) => [clean(e.grandparentTitle), [episodeCode(e), clean(episodeTitle(e))].filter(Boolean).join(' · ')] : undefined}
                onSelect={open}
              />
            </div>
          )}
        </For>
      </Shelf>
    </div>
  );
}
