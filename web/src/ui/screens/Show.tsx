import { createEffect, createResource, createSignal, For, on, Show as When } from 'solid-js';
import { open, openPerson, play } from '../../actions';
import { dataVersion } from '../../data';
import { focusable } from '@oriel/web';
import { children, metadata, related } from '../../plex/api';
import { badges, clean, duration, episodeCode, remaining } from '../../plex/format';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Info, logoReady, metaFor } from '../components/Info';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { WatchedButton } from '../components/WatchedButton';
import './details.css';

/** An episode tile's caption: its number and title, and its length or
 * what is left of it. */
const episodeLines = (e: Metadata): [string, string] => [
  [e.index !== undefined ? `${e.index}.` : '', clean(e.title)].filter(Boolean).join(' '),
  remaining(e) || duration(e.duration),
];

/** A show: logo, facts, the next episode to play; seasons as tabs and the
 * season's episodes as a row, the info following the focused episode;
 * below, the cast and related shows. */
export function Show(props: { ratingKey: string; season?: string; episode?: string }) {
  const [show] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    async ([key]) => {
      const m = await metadata(currentServer(), key);
      return m && { item: m, logo: await logoReady(m) };
    },
  );
  const [seasons] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    ([key]) => children(currentServer(), key),
  );
  const [more] = createResource(() => props.ratingKey, (key) => related(currentServer(), key));
  const next = () => show()?.item.OnDeck?.Metadata?.[0];
  const [season, setSeason] = createSignal<string>();
  // The season to open on: the one asked for, the next episode's, or the
  // first that isn't Specials. The next episode is in the show's metadata,
  // which can come after the seasons.
  createEffect(
    on([seasons, show], ([list, s]) => {
      if (!list?.length || !s || season()) return;
      setSeason(props.season ?? next()?.parentRatingKey ?? (list.find((s) => s.index !== 0) ?? list[0]).ratingKey);
    }),
  );
  const [episodes] = createResource(
    () => (season() ? ([season()!, dataVersion()] as const) : null),
    ([key]) => children(currentServer(), key),
  );
  const [focusedEpisode, setFocusedEpisode] = createSignal<Metadata>();
  // The badges need the episode's streams, which the season's list leaves
  // out: its full metadata, and its neighbours' ahead of time (cached), so
  // moving along the row finds them in.
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
  const startEpisode = () => props.episode ?? next()?.ratingKey;
  // What Play plays: the next episode, else the first of the season shown.
  const target = () => next() ?? episodes()?.[0];
  const playLabel = () => {
    const n = target();
    if (!n) return 'Play';
    return `${n.viewOffset ? 'Resume' : 'Play'} ${episodeCode(n)}`;
  };

  return (
    <div class="details">
      <Backdrop art={show()?.item.art} colors={show()?.item.UltraBlurColors} delay={0} />
      <When when={show.error}>
        <p class="error details-error">Could not load this show: {String(show.error)}</p>
      </When>
      <When when={show()}>
        {(s) => (
          <>
            <div class="details-info">
              <Info
                item={s().item}
                logo={s().logo}
                meta={metaFor(focusedEpisode() ?? s().item)}
                badges={episodeBadges()}
                reserveBadges={!!focusedEpisode()}
                badgesLate
                summary={focusedEpisode()?.summary ?? s().item.summary}
              >
                <div class="actions">
                  <div
                    class="btn"
                    ref={(el) =>
                      focusable(el, { group: 'actions', autofocus: !startEpisode(), onSelect: () => play(target() ?? s().item) })
                    }
                  >
                    ▶ {playLabel()}
                    <When when={next() && remaining(next()!)}>
                      <span class="sub">{remaining(next()!)}</span>
                    </When>
                  </div>
                  <WatchedButton item={s().item} />
                </div>
              </Info>
            </div>
            <Shelf>
              <div>
                <div class="seasons">
                  <For each={seasons()}>
                    {(se) => (
                      <div
                        class="season"
                        classList={{ current: se.ratingKey === season() }}
                        ref={(el) =>
                          focusable(el, {
                            group: 'seasons',
                            onSelect: () => setSeason(se.ratingKey),
                            onFocus: () => setFocusedEpisode(undefined),
                          })
                        }
                      >
                        {clean(se.title)}
                      </div>
                    )}
                  </For>
                </div>
                <When when={episodes()} keyed>
                  {(list) => (
                    <Row
                      title=""
                      items={list}
                      shape="wide"
                      group={`episodes-${season()}`}
                      autofocus={false}
                      lines={episodeLines}
                      onFocus={setFocusedEpisode}
                      onSelect={(e) => play(e)}
                      focusKey={startEpisode()}
                    />
                  )}
                </When>
              </div>
              <When when={s().item.Role?.length}>
                <div>
                  <People
                    title="Cast"
                    people={s().item.Role!.slice(0, 20)}
                    group="cast"
                    onSelect={(p) => openPerson(s().item, p)}
                  />
                </div>
              </When>
              <For each={more()?.slice(0, 2)}>
                {(hub) => (
                  <div>
                    <Row title={clean(hub.title)} items={hub.Metadata!} group={`related-${hub.hubIdentifier}`} onSelect={open} />
                  </div>
                )}
              </For>
            </Shelf>
          </>
        )}
      </When>
    </div>
  );
}
