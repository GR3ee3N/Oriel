import { createEffect, createResource, createSignal, For, Match, on, Show as When, Switch } from 'solid-js';
import { open, openPerson } from '../../actions';
import { dataVersion } from '../../data';
import { t } from '../../i18n';
import { children, metadata, related } from '../../plex/api';
import { badges, clean, duration, hubTitle, remaining, shortCode } from '../../plex/format';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { episodeTitle, hidden, setRevealed } from '../spoilers';
import { Backdrop } from '../components/Backdrop';
import { Button, Message, Tab } from '../components/Controls';
import { Reader } from '../components/Dialog';
import { Info, logoReady, metaFor } from '../components/Info';
import { WatchedButton, WatchlistButton } from '../components/ItemActions';
import { Panel } from '../components/Panel';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { DetailHead } from '../components/Status';
import { usePlay } from './Movie';

// Seasons start at y=588 under the info; scrolled rows move up to y=182.
const SHOW_LEAD = 406;
import './details.css';

/** Show details with season tabs, an episode row, cast and related shows.
 * The main button names the episode it starts: the one the page was opened
 * for, else the server's next episode, else the first unwatched one. */
export function Show(props: { ratingKey: string; season?: string; episode?: string }) {
  const [show, { refetch }] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    async ([key]) => {
      const m = await metadata(currentServer(), key);
      if (!m) throw new Error(`no metadata for ${key}`);
      return { item: m, logo: await logoReady(m) };
    },
  );
  const [seasons] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    ([key]) => children(currentServer(), key),
  );
  const [requested] = createResource(
    () => (props.episode ? ([props.episode, dataVersion()] as const) : null),
    ([key]) => metadata(currentServer(), key).catch(() => undefined),
  );
  const [more] = createResource(() => props.ratingKey, (key) => related(currentServer(), key).catch(() => []));
  const next = () => show.latest?.item.OnDeck?.Metadata?.[0];

  const [season, setSeason] = createSignal<string>();
  // Prefer the requested season, then the next episode's season, then a
  // non-Specials season. Reevaluate when show metadata arrives after the season list.
  createEffect(
    on([() => seasons.latest, () => show.latest], ([list, s]) => {
      if (!list?.length || !s || season()) return;
      setSeason(props.season ?? next()?.parentRatingKey ?? (list.find((x) => x.index !== 0) ?? list[0]).ratingKey);
    }),
  );
  const [episodes] = createResource(
    () => (season() ? ([season()!, dataVersion()] as const) : null),
    ([key]) => children(currentServer(), key),
  );
  const [focusedEpisode, setFocusedEpisode] = createSignal<Metadata>();
  const [scroll, setScroll] = createSignal(0);
  // Season lists omit streams needed for badges. Fetch full episode metadata
  // and cache neighbours ahead of focus movement.
  const [episodeFull] = createResource(
    () => focusedEpisode()?.ratingKey,
    (key) => {
      const list = episodes() ?? [];
      const i = list.findIndex((e) => e.ratingKey === key);
      for (const n of [list[i - 1], list[i + 1]]) if (n) void metadata(currentServer(), n.ratingKey).catch(() => undefined);
      return metadata(currentServer(), key).catch(() => undefined);
    },
  );
  const episodeBadges = () => {
    const full = episodeFull();
    return full && full.ratingKey === focusedEpisode()?.ratingKey ? badges(full) : [];
  };

  const firstUnwatched = () => episodes()?.find((e) => !e.viewCount) ?? episodes()?.[0];
  const target = () => requested() ?? next() ?? firstUnwatched();
  const playLabel = () => {
    const n = target();
    if (!n) return t('action.play');
    return t(n.viewOffset ? 'action.resumeEpisode' : 'action.playEpisode', { code: shortCode(n) });
  };
  const { starting, start } = usePlay();
  const [panel, setPanel] = createSignal<'more' | 'description' | null>(null);
  // Spoiler protection applies to the focused episode, or the main button's.
  const subject = () => focusedEpisode() ?? target();
  const moreOptions = () => [
    ...(show.latest?.item.summary ? [{ label: t('action.description'), value: 'description', icon: 'info' as const }] : []),
    ...(hidden(subject()) ? [{ label: t('action.reveal'), value: 'reveal', icon: 'info' as const }] : []),
  ];
  const onMore = (value: string) => {
    if (value === 'description') return setPanel('description');
    setPanel(null);
    if (value === 'reveal') setRevealed(subject()?.ratingKey);
  };
  const shown = (list: Metadata[]) =>
    list.map((e) => (hidden(e) ? { ...e, thumb: e.grandparentArt ?? show.latest?.item.art, summary: undefined } : e));
  const summary = () => {
    const e = focusedEpisode();
    if (!e) return show.latest?.item.summary;
    return hidden(e) ? undefined : e.summary;
  };
  const focusMeta = (item: Metadata) => {
    const e = focusedEpisode();
    return metaFor(e ? { ...e, title: episodeTitle(e) } : item);
  };

  return (
    <div class="details" classList={{ scrolled: scroll() > 0 }} style={{ '--detail-scroll': `${scroll()}px` }}>
      <Backdrop art={show.latest?.item.art} colors={show.latest?.item.UltraBlurColors} delay={0} />
      <div class="scroll-dim" />
      <DetailHead />
      <Switch>
        <Match when={!show.latest && show.error}>
          <Message class="details-message" icon="warning" title={t('details.loadFailed')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetch} />
          </Message>
        </Match>
        <Match when={show.latest}>
          {(s) => (
            <>
              <div class="details-info show-info">
                <Info item={s().item} logo={s().logo} meta={focusMeta(s().item)} badges={episodeBadges()} badgesLate summary={summary()}>
                  <div class="actions">
                    <When when={target()} fallback={<span />}>
                      {(n) => (
                        <Button
                          icon="play"
                          label={starting() ? t('action.starting') : playLabel()}
                          sub={starting() ? undefined : remaining(n()) || duration(n().duration)}
                          busy={starting()}
                          group="actions"
                          autofocus={!props.episode}
                          onSelect={() => start(n())}
                        />
                      )}
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
                  <div class="seasons">
                    <For each={seasons.latest}>
                      {(se) => (
                        <Tab
                          label={se.index === 0 ? t('details.specials') : clean(se.title)}
                          active={se.ratingKey === season()}
                          group="seasons"
                          entry={se.ratingKey === season()}
                          onFocus={() => setFocusedEpisode(undefined)}
                          onSelect={() => setSeason(se.ratingKey)}
                        />
                      )}
                    </For>
                  </div>
                  <When when={episodes.latest} keyed>
                    {(list) => (
                      <When
                        when={list.length}
                        fallback={<p class="episode-empty">{t('details.noEpisodes', { season: clean(seasons.latest?.find((x) => x.ratingKey === season())?.title) })}</p>}
                      >
                        <Row
                          title=""
                          items={shown(list)}
                          shape="wide"
                          group={`episodes-${season()}`}
                          autofocus={false}
                          lines={(e) => [[e.index !== undefined ? `${e.index}.` : '', clean(episodeTitle(e))].filter(Boolean).join(' '), remaining(e) || duration(e.duration)]}
                          onFocus={(e) => {
                            setFocusedEpisode(list.find((x) => x.ratingKey === e.ratingKey));
                            setRevealed((r) => (r === e.ratingKey ? r : undefined));
                          }}
                          onSelect={(e) => start(list.find((x) => x.ratingKey === e.ratingKey) ?? e)}
                          focusKey={props.episode}
                        />
                      </When>
                    )}
                  </When>
                </div>
                <When when={s().item.Role?.length}>
                  <div>
                    <People title={t('details.cast')} people={s().item.Role!.slice(0, 20)} group="cast" onSelect={(p) => openPerson(s().item, p)} />
                  </div>
                </When>
                <For each={more()?.slice(0, 2)}>
                  {(hub) => (
                    <div>
                      <Row title={hubTitle(hub)} items={hub.Metadata!} group={`related-${hub.hubIdentifier}`} onSelect={open} />
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
