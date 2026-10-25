// The profile's plex.tv Watchlist. Titles the server has open their page;
// the others are dimmed and open an information page.

import { createEffect, createResource, createSignal, on, Show, untrack } from 'solid-js';
import { open } from '../../actions';
import { t } from '../../i18n';
import type { Metadata } from '../../plex/types';
import { localCopies, watchlist, watchlistVersion } from '../../plex/watchlist';
import { push, tab } from '../../router';
import { currentServer, session } from '../../session';
import { Button, Chip, Message } from '../components/Controls';
import { Grid } from '../components/Grid';
import { Panel } from '../components/Panel';
import { Rail } from '../components/Rail';
import { Status } from '../components/Status';
import './library.css';

const SORTS = [
  { label: t('sort.watchlistAdded'), value: 'added' },
  { label: t('sort.title'), value: 'title' },
];

export function Watchlist() {
  const [items] = createResource(watchlistVersion, () => watchlist());
  // guid → the server's copy, or null when no library has the title.
  const [copies, setCopies] = createSignal(new Map<string, Metadata | null>());
  const [sort, setSort] = createSignal('added');
  const [localOnly, setLocalOnly] = createSignal(false);
  const [panel, setPanel] = createSignal(false);

  // Look up every title not yet matched, 50 to a request.
  createEffect(
    on(
      () => items.latest,
      async (list) => {
        if (!list) return;
        const guids = untrack(() => list.map((m) => m.guid).filter((g): g is string => !!g && !copies().has(g)));
        if (!guids.length) return;
        const found = await localCopies(currentServer(), guids).catch(() => undefined);
        if (!found) return;
        setCopies((map) => {
          const next = new Map(map);
          for (const g of guids) next.set(g, found.get(g) ?? null);
          return next;
        });
      },
    ),
  );

  const list = () => items.latest ?? [];
  const failed = () => items.state === 'errored' && !items.latest;
  const shown = () => {
    let list = items.latest ?? [];
    if (localOnly()) list = list.filter((m) => copies().get(m.guid!));
    if (sort() === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  };
  const localCount = () => list().filter((m) => copies().get(m.guid!)).length;
  const known = () => list().every((m) => !m.guid || copies().has(m.guid));
  const select = (m: Metadata) => {
    const copy = copies().get(m.guid!);
    if (copy) return open(copy);
    push({ screen: 'remote', guid: m.guid!, title: m.title });
  };
  const firstLibrary = () => session.sections[0];

  return (
    <div class="library">
      <div class="screen-bg" />
      <Rail />
      <Status />
      <header class="page-head">
        <h1>{t('nav.watchlist')}</h1>
        <Show when={list().length && known()}>
          <span>
            {t('watchlist.summary', { total: t('count.titles', { n: list().length }), local: localCount(), server: session.serverName ?? '' })}
          </span>
        </Show>
      </header>
      <Show
        when={list().length}
        fallback={
          <Show when={items.state === 'ready' || failed()}>
            <Message
              class="lib-message watchlist-empty"
              icon={failed() ? 'warning' : 'watchlist'}
              title={failed() ? t('watchlist.loadFailed') : t('watchlist.empty')}
              body={failed() ? undefined : t('watchlist.emptyHint')}
            >
              <Show when={!failed() && firstLibrary()}>
                {(lib) => (
                  <Button
                    icon="movie"
                    label={t('action.browse', { library: lib().title })}
                    autofocus
                    onSelect={() => tab({ screen: 'library', section: lib().key, title: lib().title, type: lib().type })}
                  />
                )}
              </Show>
            </Message>
          </Show>
        }
      >
        <div class="lib-toolbar watchlist-toolbar">
          <Chip icon="sort" label={t('library.sort')} value={SORTS.find((s) => s.value === sort())?.label} group="tools" onSelect={() => setPanel(true)} />
          <Chip
            label={t('library.show')}
            value={localOnly() ? session.serverName : t('library.all')}
            on={localOnly()}
            group="tools"
            onSelect={() => setLocalOnly(!localOnly())}
          />
        </div>
        <Grid
          key={`${sort()}/${localOnly()}/${list().length}`}
          load={(start, size) => Promise.resolve({ size: shown().length, totalSize: shown().length, Metadata: shown().slice(start, start + size) })}
          onSelect={select}
          dim={(m) => copies().get(m.guid!) === null}
          lines={(m) => (copies().get(m.guid!) === null ? [m.title, t('details.notOnServer', { server: session.serverName ?? '' })] : undefined)}
          class="watchlist-grid"
        />
      </Show>
      <Show when={panel()}>
        <Panel
          title={t('library.sort')}
          options={SORTS}
          selected={sort()}
          onChoose={(v) => {
            setPanel(false);
            setSort(v);
          }}
          onClose={() => setPanel(false)}
        />
      </Show>
    </div>
  );
}
