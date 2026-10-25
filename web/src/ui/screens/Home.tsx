import { createEffect, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { open } from '../../actions';
import { markHomeReady } from '../../boot';
import { dataVersion } from '../../data';
import { t } from '../../i18n';
import { homeHubs } from '../../plex/api';
import { hubTitle } from '../../plex/format';
import { preload } from '../../plex/images';
import type { Hub } from '../../plex/types';
import { currentServer, session } from '../../session';
import { Backdrop, backdropUrl } from '../components/Backdrop';
import { Button, Message } from '../components/Controls';
import { backdropOf, createHero, HeroInfo, neighbours } from '../components/hero';
import { openRail, Rail } from '../components/Rail';
import { Row } from '../components/Row';
import { ServerPicker } from '../components/ServerPicker';
import { Shelf } from '../components/Shelf';
import { Status } from '../components/Status';
import './home.css';

const PLAYABLE_HUBS = ['movie', 'show', 'episode', 'season', 'mixed', 'collection'];

// Continue Watching and On Deck can contain the same item; deduplicate by ratingKey.
function homeRows(hubs: Hub[]): Hub[] {
  const rows = hubs.filter((h) => h.Metadata?.length && PLAYABLE_HUBS.includes(h.type));
  const started = new Set(rows.find((h) => h.hubIdentifier === 'home.continue')?.Metadata?.map((m) => m.ratingKey));
  return rows
    .map((h) =>
      h.hubIdentifier === 'home.ondeck' && started.size
        ? { ...h, Metadata: h.Metadata!.filter((m) => !started.has(m.ratingKey)) }
        : h,
    )
    .filter((h) => h.Metadata!.length);
}

// Show "Still loading" with Try again after this long without Home data.
const SLOW = 8000;

// Home's place in this run of Oriel, for the profile and server it belongs
// to. Home rebuilt after visiting another root page returns to it; a fresh
// start or a profile picked in the picker focuses the first card.
let anchor: { owner: string; hub: string; key: string } | undefined;
const owner = () => `${session.picks}/${session.user?.uuid}/${session.serverId}`;

export function Home() {
  const [hubs, { refetch }] = createResource(dataVersion, () => homeHubs(currentServer()));
  const rows = () => homeRows(hubs.latest ?? []);
  // Release the splash when Home has no rows or failed to load.
  createEffect(() => {
    if (hubs.error || (hubs.latest && !rows().length)) markHomeReady();
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

  const shapeOf = (hub: Hub) =>
    hub.hubIdentifier.includes('continue') || hub.hubIdentifier === 'home.ondeck' || hub.type === 'episode'
      ? 'wide'
      : 'poster';
  const [picking, setPicking] = createSignal(false);
  // The anchored item, if it's still on Home.
  const anchored = () => {
    const a = anchor;
    if (!a || a.owner !== owner()) return undefined;
    return rows().some((h) => h.hubIdentifier === a.hub && h.Metadata!.some((m) => m.ratingKey === a.key)) ? a : undefined;
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
        <Match when={hubs.error && !hubs.latest}>
          <Message class="home-message" icon="warning" title={t('error.server', { server: session.serverName ?? '' })} body={t('error.serverHint')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetch} />
            <Show when={session.servers.length > 1}>
              <Button icon="server" label={t('action.switchServer')} onSelect={() => setPicking(true)} />
            </Show>
          </Message>
        </Match>
        <Match when={!hubs.latest}>
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
                    items={hub.Metadata!}
                    shape={shapeOf(hub)}
                    group={`hub-${hub.hubIdentifier}`}
                    autofocus={!start() && i() === 0}
                    focusKey={start()?.hub === hub.hubIdentifier ? start()!.key : undefined}
                    onFocus={(item) => {
                      anchor = { owner: owner(), hub: hub.hubIdentifier, key: item.ratingKey };
                      hero.show(item, neighbours(hub.Metadata!, item));
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

/** Final-geometry blocks while Home loads; no shimmer, which costs a raster per frame. */
function HomeSkeleton() {
  const cards = (n: number, w: number, h: number) => (
    <div class="skeleton-cards">
      <For each={Array.from({ length: n })}>
        {() => (
          <div style={{ width: `${w}px` }}>
            <i style={{ height: `${h}px` }} />
            <i class="line" />
            <i class="line short" />
          </div>
        )}
      </For>
    </div>
  );
  return (
    <div class="home-skeleton">
      <div class="hero-skeleton">
        <i class="logo" />
        <i class="line" />
        <i class="line long" />
      </div>
      <div class="rows-skeleton">
        <h2>{t('hub.home.continue')}</h2>
        {cards(4, 400, 225)}
      </div>
    </div>
  );
}
