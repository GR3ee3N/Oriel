import { createEffect, createResource, createSignal, For, Match, on, Show as When, Switch } from 'solid-js';
import { firstSeason, open, openPerson } from '../../actions';
import { dataVersion, loaded } from '../../data';
import { t } from '../../i18n';
import { badges, clean, duration, hubTitle, remaining, shortCode } from '../../media/format';
import type { Item } from '../../media/model';
import { episodeText, episodeTitle, hidden, setRevealed } from '../../media/spoilers';
import { provider } from '../../media/servers';
import { Backdrop } from '../components/Backdrop';
import { Button, Message, Tab } from '../components/Controls';
import { Reader } from '../components/Dialog';
import { Info, logoReady, metaFor } from '../components/Info';
import { WatchedButton, WatchlistButton } from '../components/ItemActions';
import { Panel } from '../components/Panel';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { DetailSkeleton, SeasonsSkeleton } from '../components/Skeleton';
import { DetailHead } from '../components/Status';
import { usePlay } from './Movie';

// Seasons start at y=588 under the info; scrolled rows move up to y=182.
const SHOW_LEAD = 406;
import './details.css';

/** Show details with season tabs, an episode row, cast and related shows.
 * The main button names the episode it starts: the one the page was opened
 * for, else the server's next episode, else the first unwatched one. */
export function Show(props: { id: string; season?: string; episode?: string }) {
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
  const [requested] = createResource(
    () => (props.episode ? ([props.episode, dataVersion()] as const) : null),
    ([key]) => provider().item(key).catch(() => undefined),
  );
  const [more] = createResource(() => props.id, (key) => provider().related(key).catch(() => []));
  const next = () => current()?.item.next;

  // The requested season, else the next episode's: either starts its
  // episodes loading alongside the season list. Without both, wait for the list.
  const [season, setSeason] = createSignal(props.season);
  createEffect(
    on([() => seasonList(), () => current()], ([list, s]) => {
      if (season() || !s) return;
      setSeason(firstSeason(list, next()?.season?.id));
    }),
  );
  const [episodes] = createResource(
    () => (season() ? ([season()!, dataVersion()] as const) : null),
    async ([key]) => ({ season: key, list: await provider().children(key) }),
  );
  // Undefined until the season's own episodes arrive; another season's, or
  // a failed load, doesn't stand in for them.
  const episodeList = () => {
    if (episodes.error) return undefined;
    const e = episodes.latest;
    return e && e.season === season() ? e.list : undefined;
  };
  const [focusedEpisode, setFocusedEpisode] = createSignal<Item>();
  const [scroll, setScroll] = createSignal(0);
  // Season lists omit streams needed for badges. Fetch full episode metadata
  // and cache neighbours ahead of focus movement.
  const [episodeFull] = createResource(
    () => focusedEpisode()?.id,
    (key) => {
      const list = episodeList() ?? [];
      const i = list.findIndex((e) => e.id === key);
      for (const n of [list[i - 1], list[i + 1]]) if (n) void provider().item(n.id).catch(() => undefined);
      return provider().item(key).catch(() => undefined);
    },
  );
  const episodeBadges = () => {
    const full = episodeFull();
    return full && full.id === focusedEpisode()?.id ? badges(full) : [];
  };

  const firstUnwatched = () => episodeList()?.find((e) => !e.plays) ?? episodeList()?.[0];
  const target = () => requested() ?? next() ?? firstUnwatched();
  // Until the episodes name the main button's episode, it holds its place.
  const waiting = () => !target() && !episodes.error && !episodeList() && seasonList()?.length !== 0;
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
  // Spoiler protection applies to the focused episode, or the main button's.
  const subject = () => focusedEpisode() ?? target();
  const moreOptions = () => [
    ...(current()?.item.summary ? [{ label: t('action.description'), value: 'description', icon: 'info' as const }] : []),
    ...(hidden(subject()) ? [{ label: t('action.reveal'), value: 'reveal', icon: 'info' as const }] : []),
  ];
  const onMore = (value: string) => {
    if (value === 'description') return setPanel('description');
    setPanel(null);
    if (value === 'reveal') setRevealed(subject()?.id);
  };
  const summary = () => {
    const e = focusedEpisode();
    if (!e) return current()?.item.summary;
    return episodeText(e, e.summary);
  };
  const focusMeta = (item: Item) => {
    const e = focusedEpisode();
    return metaFor(e ?? item);
  };

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
                <Info item={s().item} logo={s().logo} meta={focusMeta(s().item)} badges={episodeBadges()} badgesLate summary={summary()}>
                  <div class="actions">
                    <When when={target() || waiting()} fallback={<span />}>
                      <Button
                        icon="play"
                        label={starting() ? t('action.starting') : playLabel()}
                        sub={starting() ? undefined : targetLength()}
                        busy={starting()}
                        group="actions"
                        autofocus={!props.episode}
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
                <div>
                  <When when={seasonList()} fallback={<SeasonsSkeleton />}>
                    <div class="seasons">
                      <For each={seasonList()}>
                        {(se) => (
                          <Tab
                            label={se.number === 0 ? t('details.specials') : clean(se.title)}
                            active={se.id === season()}
                            group="seasons"
                            entry={se.id === season()}
                            onFocus={() => setFocusedEpisode(undefined)}
                            onSelect={() => setSeason(se.id)}
                          />
                        )}
                      </For>
                    </div>
                  </When>
                  <Switch
                    fallback={
                      <Row
                        title=""
                        items={episodeList()}
                        shape="wide"
                        group="episodes"
                        autofocus={false}
                        lines={(e) => [[e.number !== undefined ? `${e.number}.` : '', clean(episodeTitle(e))].filter(Boolean).join(' '), remaining(e) || duration(e.duration)]}
                        onFocus={(e) => {
                          setFocusedEpisode(e);
                          setRevealed((r) => (r === e.id ? r : undefined));
                        }}
                        onSelect={(e) => start(e)}
                        focusKey={props.episode}
                      />
                    }
                  >
                    <Match when={seasonList()?.length === 0}>{null}</Match>
                    <Match when={episodes.error}>
                      <p class="episode-empty">{t('details.episodesFailed')}</p>
                    </Match>
                    <Match when={episodeList()?.length === 0}>
                      <p class="episode-empty">{t('details.noEpisodes', { season: clean(seasonList()?.find((x) => x.id === season())?.title) })}</p>
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
                <Panel title={clean(s().item.title)} options={moreOptions()} onChoose={onMore} onClose={() => setPanel(null)} />
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
