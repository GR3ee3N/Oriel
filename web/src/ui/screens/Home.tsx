import { createEffect, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { open } from '../../actions';
import { markHomeReady } from '../../boot';
import { dataVersion, loaded } from '../../data';
import { t } from '../../i18n';
import { hubTitle } from '../../media/format';
import type { Row as RowModel } from '../../media/model';
import { provider } from '../../media/servers';
import { session } from '../../session';
import { preload } from '../preload';
import { Backdrop, backdropUrl } from '../components/Backdrop';
import { Button, Message } from '../components/Controls';
import { backdropOf, createHero, HeroInfo, neighbours } from '../components/hero';
import { openRail, Rail } from '../components/Rail';
import { Row } from '../components/Row';
import { ServerPicker } from '../components/ServerPicker';
import { Shelf } from '../components/Shelf';
import { SkeletonCards } from '../components/Skeleton';
import { Status } from '../components/Status';
import './home.css';

const PLAYABLE_HUBS = ['movie', 'show', 'episode', 'season', 'mixed', 'collection'];

// Continue Watching and On Deck can contain the same item; deduplicate by id.
function homeRows(hubs: RowModel[]): RowModel[] {
  const rows = hubs.filter((h) => h.items.length && PLAYABLE_HUBS.includes(h.type));
  const started = new Set(rows.find((h) => h.id === 'home.continue')?.items.map((m) => m.id));
  return rows
    .map((h) => (h.id === 'home.ondeck' && started.size ? { ...h, items: h.items.filter((m) => !started.has(m.id)) } : h))
    .filter((h) => h.items.length);
}

// Show "Still loading" with Try again after this long without Home data.
const SLOW = 8000;

// Home's place in this run of Oriel, for the profile and server it belongs
// to. Home rebuilt after visiting another root page returns to it; a fresh
// start or a profile picked in the picker focuses the first card.
let anchor: { owner: string; hub: string; key: string } | undefined;
const owner = () => `${session.picks}/${session.user?.id}/${session.serverId}`;

export function Home() {
  const [hubs, { refetch }] = createResource(dataVersion, () => provider().home());
  const current = loaded(hubs);
  const rows = () => homeRows(current() ?? []);
  // Release the splash when Home has no rows or failed to load.
  createEffect(() => {
    if (hubs.error || (current() && !rows().length)) markHomeReady();
  });
  const [slow, setSlow] = createSignal(false);
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => hubs.loading,
      (loading) => {
        clearTimeout(slowTimer);
        setSlow(false);
        if (loading) slowTimer = setTimeout(() => setSlow(true), SLOW);
      },
    ),
  );
  onCleanup(() => clearTimeout(slowTimer));

  // Release the splash after the first backdrop is decoded so it can reuse
  // the cached image when Home appears.
  const hero = createHero((item) => {
    const path = backdropOf(item);
    (path ? preload(backdropUrl(path), true) : Promise.resolve()).then(markHomeReady);
  });

  const shapeOf = (hub: RowModel) =>
    hub.id.includes('continue') || hub.id === 'home.ondeck' || hub.type === 'episode' ? 'wide' : 'poster';
  const [picking, setPicking] = createSignal(false);
  // The anchored item, if it's still on Home.
  const anchored = () => {
    const a = anchor;
    if (!a || a.owner !== owner()) return undefined;
    return rows().some((h) => h.id === a.hub && h.items.some((m) => m.id === a.key)) ? a : undefined;
  };
  // Decided once, when the rows first render; later focus moves update the anchor.
  let decided = false;
  let first: ReturnType<typeof anchored>;
  const start = () => {
    if (!decided && rows().length) {
      first = anchored();
      decided = true;
    }
    return first;
  };

  return (
    <div class="home">
      <Backdrop art={hero.art()} colors={hero.colors()} />
      <Rail />
      <Status />
      <Switch>
        <Match when={hubs.error && !current()}>
          <Message class="home-message" icon="warning" title={t('error.server', { server: session.serverName ?? '' })} body={t('error.serverHint')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetch} />
            <Show when={session.servers.length > 1}>
              <Button icon="server" label={t('action.switchServer')} onSelect={() => setPicking(true)} />
            </Show>
          </Message>
        </Match>
        <Match when={!current()}>
          <HomeSkeleton />
          <Show when={slow()}>
            <Message class="home-slow" icon="server" title={t('error.slow', { server: session.serverName ?? '' })}>
              <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetch} />
            </Message>
          </Show>
        </Match>
        <Match when={!rows().length}>
          <Message class="home-message" icon="home" title={t('home.empty')}>
            <Button icon="movie" label={t('home.browse')} autofocus onSelect={openRail} />
          </Message>
        </Match>
        <Match when={rows().length}>
          <div class="hero">
            <HeroInfo hero={hero} />
          </div>
          <Shelf class="home-shelf">
            <For each={rows()}>
              {(hub, i) => (
                <div>
                  <Row
                    title={hubTitle(hub)}
                    items={hub.items}
                    shape={shapeOf(hub)}
                    group={`hub-${hub.id}`}
                    autofocus={!start() && i() === 0}
                    focusKey={start()?.hub === hub.id ? start()!.key : undefined}
                    onFocus={(item) => {
                      anchor = { owner: owner(), hub: hub.id, key: item.id };
                      hero.show(item, neighbours(hub.items, item));
                    }}
                    onSelect={open}
                  />
                </div>
              )}
            </For>
          </Shelf>
        </Match>
      </Switch>
      <Show when={picking()}>
        <ServerPicker onClose={() => setPicking(false)} />
      </Show>
    </div>
  );
}

/** Home's hero and first row while it loads. */
function HomeSkeleton() {
  return (
    <div class="skeleton home-skeleton">
      <div class="hero-skeleton">
        <i class="logo" />
        <i class="line" />
        <i class="line long" />
      </div>
      <div class="rows-skeleton">
        <h2>{t('hub.home.continue')}</h2>
        <SkeletonCards count={4} width={400} height={225} />
      </div>
    </div>
  );
}
