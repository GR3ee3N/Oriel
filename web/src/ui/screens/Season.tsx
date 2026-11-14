import { createEffect, createResource, createSignal, For, Index, Match, on, onCleanup, Show as When, Switch } from 'solid-js';
import { nextEpisode, openPerson, usePlay } from '../../actions';
import { dataVersion, loaded } from '../../data';
import { t } from '../../i18n';
import { airDate, badges, clean, duration, episodeCode, isWatched, progress, remaining, seasonName } from '../../media/format';
import type { Item } from '../../media/model';
import { episodeHeading, episodeText, hidden, setRevealed } from '../../spoilers';
import { provider } from '../../media/servers';
import { type Direction, focusable, focused, focusGroup, focusLater, focusOn } from '../../nav';
import { lastPlayed } from '../../player/playback';
import { Backdrop } from '../components/Backdrop';
import { Button, Message, Tab } from '../components/Controls';
import { Reader } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { createImage } from '../components/image';
import { logoFor, Meta } from '../components/Info';
import { TrackChips, WatchedButton, WatchlistButton } from '../components/ItemActions';
import { Panel } from '../components/Panel';
import { People } from '../components/People';
import { DetailHead } from '../components/Status';
import { tileImageUrl } from '../components/Tile';
import { pop, push, stack } from '../../router';
import { createItem } from './item';
import './details.css';
import './season.css';

/** The season each show's season screen showed last, so the show page can
 * return to its poster. */
export const lastSeason = new Map<string, string>();

// Stills are 400px wide with 32px between them. Four fit across the page.
const STEP = 432;
const VISIBLE = 4;
// Focus walks to the third still, then the strip moves under it.
const SLOT = 2;
// The strip sits 370px under the details; with focus on Cast & crew it
// moves up to y=182, and the buttons & cast with it.
const STRIP = 370;
const SCROLLED_TOP = 182;
// Details & buttons follow focus once it settles, as the hero does.
const SETTLE = 300;

type Zone = 'tabs' | 'strip' | 'actions' | 'cast';

/** One episode's still: its number, watched mark & progress. */
function Still(props: {
  item: Item;
  index: number;
  entry: boolean;
  current: boolean;
  onFocus: () => void;
  onSelect: () => void;
  onArrow: (d: Direction) => boolean;
}) {
  const image = createImage(() => tileImageUrl(props.item, 'wide'));
  return (
    <div
      class="still"
      classList={{ current: props.current }}
      data-index={props.index}
      ref={(el) =>
        focusable(el, {
          group: 'episodes',
          get entry() {
            return props.entry;
          },
          onFocus: props.onFocus,
          onSelect: props.onSelect,
          onPlay: props.onSelect,
          onArrow: props.onArrow,
        })
      }
    >
      <div class="art">
        <When when={image.src()} keyed>
          {(s) => <img src={s} alt="" decoding="async" onError={() => image.fail(s)} />}
        </When>
        <When when={props.item.number !== undefined}>
          <div class="num">{props.item.number}</div>
        </When>
        <When when={isWatched(props.item)}>
          <div class="watched">
            <Icon name="check" />
          </div>
        </When>
        <When when={progress(props.item) > 0}>
          <div class="progress">
            <div style={{ transform: `scaleX(${progress(props.item)})` }} />
          </div>
        </When>
      </div>
    </div>
  );
}

/** A season's episodes: tabs for the show's seasons, the shown episode's
 * details, a strip of stills and buttons for the shown episode and its
 * show, with the show's cast below. Opens on `episode`, else the season's part-watched,
 * first unwatched or first episode. */
export function Season(props: { show: string; season: string; episode?: string }) {
  const [show, { refetch: refetchShow }] = createItem(() => props.show);
  const loadedShow = loaded(show);
  const showItem = () => loadedShow()?.item;
  const [seasons] = createResource(
    () => [props.show, dataVersion()] as const,
    ([key]) => provider().children(key),
  );
  const seasonList = loaded(seasons);
  const tabbed = () => (seasonList()?.length ?? 0) > 1;

  const [season, setSeason] = createSignal(props.season);
  createEffect(() => lastSeason.set(props.show, season()));
  const [episodes, { refetch: refetchEpisodes }] = createResource(
    () => [season(), dataVersion()] as const,
    async ([key]) => ({ season: key, list: await provider().children(key) }),
  );
  // Undefined until the season's own episodes arrive; another season's, or
  // a failed load, doesn't stand in for them.
  const episodeList = () => {
    if (episodes.error) return undefined;
    const e = episodes.latest;
    return e && e.season === season() ? e.list : undefined;
  };

  // The still with the focus, or last had it; and the episode whose details
  // & buttons show, which follows it once focus settles.
  const [col, setCol] = createSignal(0);
  const [shownId, setShownId] = createSignal<string>();
  const shown = () => episodeList()?.find((e) => e.id === shownId());
  const first = () => Math.max(0, Math.min(col() - SLOT, (episodeList()?.length ?? 0) - VISIBLE));

  let box!: HTMLDivElement;
  let strip: HTMLDivElement | undefined;
  const [zone, setZone] = createSignal<Zone>('strip');
  // A panel takes the focus outside the page; the page keeps its look under it.
  createEffect(
    on(focused, (el) => {
      if (!el || !box.contains(el)) return;
      const z = (['tabs', 'strip', 'actions', 'cast'] as const).find((name) => el.closest(`.season-${name}`));
      if (z) setZone(z);
    }),
  );

  // The episode to land on when the season's episodes arrive: the one asked
  // for, else the season's next one. Focus moves to it; a reload of the same
  // season keeps the episode & the focus where they are.
  let pending: string | undefined = props.episode;
  let landing = true;
  const land = (list: Item[]) => {
    const want = pending;
    pending = undefined;
    const keep = !landing && !want && list.some((e) => e.id === shownId());
    landing = false;
    if (keep) return;
    const e = (want && list.find((x) => x.id === want)) || nextEpisode(list);
    if (!e) return;
    const i = list.indexOf(e);
    setCol(i);
    setShownId(e.id);
    // The stills render before this runs; focusing now keeps the buttons
    // that just appeared from taking the focus first.
    const still = () => strip?.querySelector<HTMLElement>(`.still[data-index="${i}"]`);
    const el = still();
    if (el) focusLater(el);
    else
      queueMicrotask(() => {
        const later = still();
        if (later) focusLater(later);
      });
  };
  createEffect(on(episodeList, (list) => list && land(list)));

  // Coming back from the player, show the episode that played last.
  createEffect(
    on(
      lastPlayed,
      (item) => {
        if (item?.kind !== 'episode' || item.show?.id !== props.show || !item.season) return;
        pending = item.id;
        landing = true;
        if (item.season.id !== season()) return setSeason(item.season.id);
        const list = episodeList();
        if (list) land(list);
      },
      { defer: true },
    ),
  );

  const choose = (id: string) => {
    if (id === season()) return;
    pending = undefined;
    landing = true;
    setShownId(undefined);
    setCol(0);
    setSeason(id);
  };

  let settle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settle));
  const focusStill = (i: number) => {
    setCol(i);
    const e = episodeList()?.[i];
    if (!e) return;
    // Show episode details lasts until focus leaves the episode.
    setRevealed((r) => (r === e.id ? r : undefined));
    clearTimeout(settle);
    settle = setTimeout(() => setShownId(e.id), SETTLE);
  };
  // Long season names can run past the Home button; the tabs move so the
  // focused or active one shows in full.
  let tabsBox: HTMLDivElement | undefined;
  const [tabShift, setTabShift] = createSignal(0);
  const showTab = (el: HTMLElement | null | undefined) => {
    if (!el || !tabsBox) return;
    const width = tabsBox.clientWidth;
    const right = el.offsetLeft + el.offsetWidth;
    if (right - tabShift() > width) setTabShift(right - width);
    else if (el.offsetLeft < tabShift()) setTabShift(el.offsetLeft);
  };
  createEffect(
    on([season, seasonList], () => queueMicrotask(() => showTab(tabsBox?.querySelector<HTMLElement>('.tab.active')))),
  );
  const focusHome = () => {
    const home = box.querySelector<HTMLElement>('.detail-head .button');
    if (home) focusOn(home);
    return !!home;
  };
  const stillArrow = (d: Direction) => d === 'up' && tabbed() && focusGroup('tabs');

  // Full details carry the streams the badges & track choices need.
  const [full] = createResource(
    () => shownId(),
    (key) => provider().item(key).catch(() => undefined),
  );
  const shownBadges = () => {
    const f = full();
    return f && f.id === shownId() ? badges(f) : [];
  };
  // Back from the full description returns to More, on that option.
  const [moreFocus, setMoreFocus] = createSignal<string>();
  const { starting, start } = usePlay();
  const [panel, setPanel] = createSignal<'more' | 'description' | null>(null);
  const moreOptions = () => {
    const e = shown();
    if (!e) return [];
    return [
      ...(hidden(e) ? [{ label: t('action.reveal'), value: 'reveal', icon: 'info' as const }] : []),
      ...(e.summary && !hidden(e) ? [{ label: t('action.description'), value: 'description', icon: 'info' as const }] : []),
      { label: t('action.goToShow'), value: 'show', icon: 'show' as const },
    ];
  };
  // The show page, returning to it when this screen was opened from it.
  const goToShow = () => {
    const below = stack().at(-2)?.route;
    if (below?.screen === 'show' && below.id === props.show) pop();
    else push({ screen: 'show', id: props.show });
  };
  const onMore = (value: string) => {
    setMoreFocus(value);
    if (value === 'description') return setPanel('description');
    setPanel(null);
    if (value === 'reveal') setRevealed(shownId());
    else if (value === 'show') goToShow();
  };

  const seasonTitle = () => {
    const s = seasonList()?.find((x) => x.id === season());
    return s ? seasonName(s) : '';
  };
  const top = () => (tabbed() ? 150 : 96);
  const scrolled = () => zone() === 'cast';
  const shift = () => (scrolled() ? top() + STRIP - SCROLLED_TOP : 0);
  const logo = createImage(() => logoFor(showItem()));

  return (
    <div
      class={`details season in-${zone()}${scrolled() ? ' scrolled' : ''}`}
      style={{ '--season-top': `${top()}px` }}
      ref={box}
    >
      <Backdrop art={showItem()?.art.backdrop} colors={showItem()?.art.colors} />
      <div class="scroll-dim" />
      <DetailHead />
      <When
        when={showItem() || !show.error}
        fallback={
          <Message class="details-message" icon="warning" title={t('details.loadFailed')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetchShow} />
          </Message>
        }
      >
        <When when={tabbed()}>
          <div class="season-tabs" ref={tabsBox}>
            <div class="season-tabs-inner" style={{ transform: `translateX(${-tabShift()}px)` }}>
              <For each={seasonList()}>
                {(se) => (
                  <Tab
                    label={seasonName(se)}
                    active={se.id === season()}
                    group="tabs"
                    entry={se.id === season()}
                    initial={false}
                    onArrow={(d) => d === 'up' && focusHome()}
                    onFocus={() => showTab(focused())}
                    onSelect={() => choose(se.id)}
                  />
                )}
              </For>
            </div>
          </div>
        </When>
        <div class="season-ep">
          <div class="season-logo">
            <When when={logo.src()} fallback={<b>{clean(showItem()?.title)}</b>}>
              {(src) => <img src={src()} alt="" onError={() => logo.fail(src())} />}
            </When>
          </div>
          <When
            when={shown()}
            fallback={
              <div class="skeleton season-ep-skeleton">
                <i class="title" />
                <i class="meta" />
                <i class="line" />
                <i class="line short" />
              </div>
            }
          >
            {(e) => (
              <>
                <h1>{episodeHeading(e())}</h1>
                <div class="info-meta">
                  <Meta
                    parts={[
                      episodeCode(e()),
                      airDate(e().released),
                      duration(e().duration),
                      isWatched(e()) && (
                        <span class="seen">
                          <Icon name="check" />
                          {t('episode.watched')}
                        </span>
                      ),
                    ]}
                    accent={remaining(e())}
                  />
                  <When when={shownBadges().length}>
                    <div class="badge-set">
                      <Index each={shownBadges()}>{(b) => <span class="badge">{b()}</span>}</Index>
                    </div>
                  </When>
                </div>
                <p class="info-summary" classList={{ removed: hidden(e()) }}>
                  {clean(episodeText(e(), e().summary))}
                </p>
              </>
            )}
          </When>
        </div>
        <div class="season-body" style={{ transform: `translateY(${-shift()}px)` }}>
          <div class="season-strip" ref={strip}>
            <Switch
              fallback={
                <div class="stills skeleton">
                  <For each={Array.from({ length: 5 })}>{() => <i />}</For>
                </div>
              }
            >
              <Match when={episodes.error}>
                <Message class="season-message" icon="warning" title={t('details.episodesFailed')}>
                  <Button icon="restart" label={t('action.retry')} initial={false} onSelect={refetchEpisodes} />
                </Message>
              </Match>
              <Match when={episodeList()?.length === 0}>
                <p class="episode-empty">
                  {t('details.noEpisodes', { season: seasonTitle() })}
                </p>
              </Match>
              <Match when={episodeList()}>
                {(list) => (
                  <div class="stills" style={{ transform: `translateX(${-first() * STEP}px)` }}>
                    <Index each={list()}>
                      {(e, i) => (
                        <Still
                          item={e()}
                          index={i}
                          entry={i === col()}
                          current={i === col()}
                          onFocus={() => focusStill(i)}
                          onSelect={() => start(e())}
                          onArrow={stillArrow}
                        />
                      )}
                    </Index>
                  </div>
                )}
              </Match>
            </Switch>
          </div>
          <When when={shown()}>
            {(e) => (
              <div class="season-actions">
                <Button
                  class="quiet"
                  icon="play"
                  label={starting() ? t('action.starting') : e().position ? t('action.resume') : t('action.play')}
                  busy={starting()}
                  group="ep-actions"
                  entry
                  onSelect={() => start(e())}
                />
                <When when={e().position}>
                  <Button class="quiet" icon="restart" label={t('action.fromStart')} group="ep-actions" onSelect={() => start(e(), true)} />
                </When>
                <When when={showItem()}>{(s) => <WatchlistButton item={s()} group="ep-actions" class="quiet" />}</When>
                <WatchedButton item={e()} group="ep-actions" class="quiet" />
                <When when={moreOptions().length}>
                  <Button
                    class="quiet"
                    icon="more"
                    group="ep-actions"
                    onSelect={() => {
                      setMoreFocus(undefined);
                      setPanel('more');
                    }}
                  />
                </When>
                <div class="season-tracks">
                  <TrackChips item={e()} group="ep-actions" />
                </div>
              </div>
            )}
          </When>
          <When when={showItem()?.cast?.length}>
            <div class="season-cast">
              <People title={t('details.cast')} people={showItem()!.cast!.slice(0, 20)} group="cast" initial={false} onSelect={(p) => openPerson(showItem()!, p)} />
            </div>
          </When>
        </div>
        <When when={panel() === 'more' && shown()}>
          {(e) => <Panel title={`${episodeCode(e())} · ${episodeHeading(e())}`} options={moreOptions()} focus={moreFocus()} onChoose={onMore} onClose={() => setPanel(null)} />}
        </When>
        <When when={panel() === 'description' && shown()}>
          {(e) => <Reader title={clean(e().title)} text={e().summary ?? ''} onClose={() => setPanel('more')} />}
        </When>
      </When>
    </div>
  );
}
