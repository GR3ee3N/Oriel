import { createEffect, createResource, createSignal, For, Match, on, Show as When, Switch } from 'solid-js';
import { firstSeason, nextEpisode, open, openPerson } from '../../actions';
import { dataVersion, loaded } from '../../data';
import { t } from '../../i18n';
import { badges, clean, duration, hubTitle, remaining, seasonName, shortCode } from '../../media/format';
import type { Item } from '../../media/model';
import { episodeTitle } from '../../media/spoilers';
import { provider } from '../../media/servers';
import { focused, focusOn, useScope } from '../../nav';
import { push, top } from '../../router';
import { Backdrop } from '../components/Backdrop';
import { Button, Message } from '../components/Controls';
import { Reader } from '../components/Dialog';
import { Info, logoReady, metaFor } from '../components/Info';
import { WatchedButton, WatchlistButton } from '../components/ItemActions';
import { Panel } from '../components/Panel';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { DetailSkeleton } from '../components/Skeleton';
import { DetailHead } from '../components/Status';
import { usePlay } from './Movie';
import { lastSeason } from './Season';
import './details.css';

// The first row's heading sits at y=566 under the info and stays there while
// the row has the focus; rows below scroll up to y=182.
const SHOW_LEAD = 384;

/** Season of a show's next episode, never Specials while there are other seasons. */
function seasonOf(seasons: Item[] | undefined, next: Item | undefined): string | undefined {
  const id = next?.season?.id;
  return (seasons?.find((s) => s.id === id && s.number !== 0) ?? seasons?.find((s) => s.number !== 0) ?? seasons?.[0])?.id;
}

/** "2 of 9 watched", or "9 episodes" before any is watched. */
function seasonCaption(season: Item): string {
  const e = season.episodes;
  if (!e?.total) return '';
  return e.watched ? t('count.watchedOf', { watched: e.watched, total: e.total }) : t('count.episodes', { n: e.total });
}

/** Show details with a row of seasons, cast and related shows. The main
 * button names the episode it starts: the server's next episode, else the
 * first season's part-watched or first unwatched one, else its first. A
 * show with one season lists its episodes in place of a single poster. */
export function Show(props: { id: string }) {
  const [show, { refetch: refetchShow }] = createResource(
    () => [props.id, dataVersion()] as const,
    async ([key]) => {
      const item = await provider().item(key);
      if (!item) throw new Error(`no metadata for ${key}`);
      return { item, logo: await logoReady(item) };
    },
  );
  const current = loaded(show);
  const [seasons, { refetch: refetchSeasons }] = createResource(
    () => [props.id, dataVersion()] as const,
    ([key]) => provider().children(key),
  );
  const seasonList = loaded(seasons);
  // Without its seasons the page has nothing to play, so either failure offers Retry.
  const failed = () => (!current() && show.error) || (!seasonList() && seasons.error);
  const retry = () => {
    if (show.error) refetchShow();
    if (seasons.error) refetchSeasons();
  };
  const [more] = createResource(() => props.id, (key) => provider().related(key).catch(() => []));
  const next = () => current()?.item.next;
  const single = () => seasonList()?.length === 1;

  // Episodes of the only season, for its row, or of the first season when
  // the server names no next episode, for the main button.
  const episodeSeason = () => {
    const list = seasonList();
    if (!list?.length || !current()) return undefined;
    if (list.length === 1) return list[0].id;
    return next() ? undefined : firstSeason(list);
  };
  const [episodes] = createResource(
    () => (episodeSeason() ? ([episodeSeason()!, dataVersion()] as const) : null),
    async ([key]) => ({ season: key, list: await provider().children(key) }),
  );
  // Undefined until that season's own episodes arrive.
  const episodeList = () => {
    if (episodes.error) return undefined;
    const e = episodes.latest;
    return e && e.season === episodeSeason() ? e.list : undefined;
  };

  const target = () => next() ?? nextEpisode(episodeList());
  // Until the episodes name the main button's episode, it holds its place.
  const waiting = () => !target() && !episodes.error && seasonList()?.length !== 0;
  // Season lists omit the streams the badges need.
  const [targetFull] = createResource(
    () => target()?.id,
    (key) => provider().item(key).catch(() => undefined),
  );
  const targetBadges = () => {
    const full = targetFull();
    return full && full.id === target()?.id ? badges(full) : [];
  };
  const targetLength = () => {
    const n = target();
    return n && (remaining(n) || duration(n.duration));
  };
  const playLabel = () => {
    const n = target();
    if (!n) return t('action.play');
    return t(n.position ? 'action.resumeEpisode' : 'action.playEpisode', { code: shortCode(n) });
  };
  const { starting, start } = usePlay();
  const [panel, setPanel] = createSignal<'more' | 'description' | null>(null);
  const moreOptions = () => (current()?.item.summary ? [{ label: t('action.description'), value: 'description', icon: 'info' as const }] : []);
  const openSeason = (season: Item, episode?: Item) =>
    push({ screen: 'season', show: props.id, season: season.id, episode: episode?.id });

  // Back from a season screen focuses the poster of the season it showed last.
  const scope = useScope();
  let seasonsBox: HTMLDivElement | undefined;
  createEffect(
    on(
      () => top().scope === scope,
      (shown) => {
        if (!shown) return;
        queueMicrotask(() => {
          const id = lastSeason.get(props.id);
          const el = focused();
          if (!id || !el || !seasonsBox?.contains(el) || single()) return;
          const i = seasonList()?.findIndex((s) => s.id === id) ?? -1;
          const tile = seasonsBox.querySelector<HTMLElement>(`.tile[data-index="${i}"]`);
          if (tile && tile !== el) focusOn(tile);
        });
      },
      { defer: true },
    ),
  );

  const [scroll, setScroll] = createSignal(0);
  return (
    <div class="details" classList={{ scrolled: scroll() > 0 }} style={{ '--detail-scroll': `${scroll()}px` }}>
      <Backdrop art={current()?.item.art.backdrop} colors={current()?.item.art.colors} />
      <div class="scroll-dim" />
      <DetailHead />
      <Switch fallback={<DetailSkeleton show />}>
        <Match when={failed()}>
          <Message class="details-message" icon="warning" title={t('details.loadFailed')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={retry} />
          </Message>
        </Match>
        <Match when={current()}>
          {(s) => (
            <>
              <div class="details-info show-info">
                <Info item={s().item} logo={s().logo} meta={metaFor(s().item)} badges={targetBadges()} badgesLate summary={s().item.summary}>
                  <div class="actions">
                    <When when={target() || waiting()} fallback={<span />}>
                      <Button
                        icon="play"
                        label={starting() ? t('action.starting') : playLabel()}
                        sub={starting() ? undefined : targetLength()}
                        busy={starting()}
                        group="actions"
                        autofocus
                        onSelect={() => {
                          const n = target();
                          if (n) start(n);
                        }}
                      />
                    </When>
                    <WatchlistButton item={s().item} />
                    <WatchedButton item={s().item} />
                    <When when={moreOptions().length}>
                      <Button icon="more" group="actions" onSelect={() => setPanel('more')} />
                    </When>
                  </div>
                </Info>
              </div>
              <Shelf class="show-shelf" lead={SHOW_LEAD} onScroll={setScroll}>
                <div ref={seasonsBox}>
                  <Switch
                    fallback={
                      <Row
                        title={t('details.seasons')}
                        items={seasonList()}
                        group="seasons"
                        autofocus={false}
                        enterKey={seasonOf(seasonList(), next())}
                        lines={(se) => [seasonName(se), seasonCaption(se)]}
                        onSelect={(se) => openSeason(se)}
                      />
                    }
                  >
                    <Match when={seasonList()?.length === 0}>{null}</Match>
                    <Match when={single() && episodes.error}>
                      <p class="episode-empty">{t('details.episodesFailed')}</p>
                    </Match>
                    <Match when={single() && episodeList()?.length === 0}>
                      <p class="episode-empty">{t('details.noEpisodes', { season: seasonName(seasonList()![0]) })}</p>
                    </Match>
                    <Match when={single()}>
                      <Row
                        title={t('details.episodes')}
                        items={episodeList()}
                        shape="wide"
                        group="episodes"
                        autofocus={false}
                        enterKey={target()?.id}
                        lines={(e) => [[e.number !== undefined ? `${e.number}.` : '', clean(episodeTitle(e))].filter(Boolean).join(' '), remaining(e) || duration(e.duration)]}
                        onSelect={(e) => openSeason(seasonList()![0], e)}
                      />
                    </Match>
                  </Switch>
                </div>
                <When when={s().item.cast?.length}>
                  <div>
                    <People title={t('details.cast')} people={s().item.cast!.slice(0, 20)} group="cast" onSelect={(p) => openPerson(s().item, p)} />
                  </div>
                </When>
                <For each={more()?.slice(0, 2)}>
                  {(hub) => (
                    <div>
                      <Row title={hubTitle(hub)} items={hub.items} group={`related-${hub.id}`} onSelect={open} />
                    </div>
                  )}
                </For>
              </Shelf>
              <When when={panel() === 'more'}>
                <Panel title={clean(s().item.title)} options={moreOptions()} onChoose={() => setPanel('description')} onClose={() => setPanel(null)} />
              </When>
              <When when={panel() === 'description'}>
                <Reader title={clean(s().item.title)} text={s().item.summary ?? ''} onClose={() => setPanel(null)} />
              </When>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
