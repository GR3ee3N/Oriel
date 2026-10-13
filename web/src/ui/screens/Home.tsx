import { createEffect, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { open } from '../../actions';
import { markHomeReady } from '../../boot';
import { dataVersion } from '../../data';
import { homeHubs, metadata } from '../../plex/api';
import { badges, clean } from '../../plex/format';
import { imageUrl, preload } from '../../plex/images';
import type { Hub, Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Info, logoReady, metaFor } from '../components/Info';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { TopNav } from '../components/TopNav';
import './home.css';

const PLAYABLE_HUBS = ['movie', 'show', 'episode', 'season', 'mixed', 'collection'];

// Plex can send the same item in Continue Watching and On Deck.
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

const backdropOf = (m: Metadata | undefined) => (m?.type === 'episode' ? (m.grandparentArt ?? m.art) : m?.art);

export function Home() {
  const [hubs] = createResource(dataVersion, () => homeHubs(currentServer()));
  const rows = () => homeRows(hubs() ?? []);
  // Nothing to wait for: no rows, or no Home at all.
  createEffect(() => {
    if (hubs.error || (hubs() && !rows().length)) markHomeReady();
  });

  // Delay metadata layout until the row stops sliding to avoid dropped frames.
  // Decode the logo before swapping the hero; hubs omit the streams needed for HDR badges.
  const [hero, setHero] = createSignal<{ item: Metadata; logo?: string; full?: Metadata; late?: boolean }>();
  let wanted: Metadata | undefined;
  let heroTimer: ReturnType<typeof setTimeout> | undefined;
  const fullOf = (item: Metadata) => metadata(currentServer(), item.ratingKey).catch(() => undefined);
  const showHero = (item: Metadata, around: Metadata[]) => {
    wanted = item;
    clearTimeout(heroTimer);
    heroTimer = setTimeout(
      async () => {
        const first = !hero();
        const pending = fullOf(item);
        const [logo, full] = await Promise.all([
          logoReady(item),
          Promise.race([pending, new Promise<undefined>((done) => setTimeout(done, 350))]),
        ]);
        if (wanted !== item) return;
        setHero({ item, logo, full });
        if (!full) {
          // Late: its badges fade in when it comes.
          pending.then((f) => {
            const h = hero();
            if (f && h?.item === item) setHero({ ...h, full: f, late: true });
          });
        }
        // The neighbours', so moving on finds them in the cache (a minute).
        for (const m of around) void fullOf(m);
        // The splash goes once the first item's picture is in too (the
        // backdrop then decodes it from the cache, at once).
        if (first) {
          const path = backdropOf(item);
          const ready = path ? preload(imageUrl(currentServer(), path, 960, 540)) : Promise.resolve();
          ready.then(markHomeReady);
        }
      },
      hero() ? 230 : 0,
    );
  };
  onCleanup(() => clearTimeout(heroTimer));
  const heroBadges = () => {
    const f = hero()?.full;
    return f ? badges(f) : [];
  };

  const art = () => backdropOf(hero()?.item);
  const colors = () => hero()?.item.UltraBlurColors ?? hero()?.full?.UltraBlurColors;
  const shapeOf = (hub: Hub) =>
    hub.hubIdentifier.includes('continue') || hub.hubIdentifier === 'home.ondeck' || hub.type === 'episode'
      ? 'wide'
      : 'poster';

  return (
    <div class="home">
      <Backdrop art={art()} colors={colors()} />
      <TopNav />
      <div class="hero">
        <Show when={hero()}>
          {(h) => (
            <Info
              item={h().item}
              logo={h().logo}
              title={clean(h().item.type === 'episode' ? h().item.grandparentTitle : h().item.title)}
              meta={metaFor(h().item)}
              badges={heroBadges()}
              reserveBadges
              badgesLate={h().late}
              summary={h().item.summary}
              size="hero"
            />
          )}
        </Show>
      </div>
      <Show when={hubs.error}>
        <p class="error home-error">Could not load the home screen: {String(hubs.error)}</p>
      </Show>
      <Shelf class="home-shelf">
        <For each={rows()}>
          {(hub, i) => (
            <div>
              <Row
                title={clean(hub.title)}
                items={hub.Metadata!}
                shape={shapeOf(hub)}
                group={`hub-${hub.hubIdentifier}`}
                autofocus={i() === 0}
                onFocus={(item) => {
                  const items = hub.Metadata!;
                  const at = items.indexOf(item);
                  showHero(item, [...items.slice(at + 1, at + 3), ...items.slice(Math.max(0, at - 2), at)]);
                }}
                onSelect={open}
              />
            </div>
          )}
        </For>
      </Shelf>
    </div>
  );
}
