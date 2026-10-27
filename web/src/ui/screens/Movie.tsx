import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js';
import { open, openPerson, play } from '../../actions';
import { dataVersion, loaded } from '../../data';
import { t } from '../../i18n';
import { metadata, related } from '../../plex/api';
import { badges, clean, duration, hubTitle, remaining } from '../../plex/format';
import type { Metadata } from '../../plex/types';
import { push } from '../../router';
import { currentServer } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Button, Message } from '../components/Controls';
import { Reader } from '../components/Dialog';
import { Info, logoReady, metaFor } from '../components/Info';
import { TrackChips, WatchedButton, WatchlistButton } from '../components/ItemActions';
import { Panel } from '../components/Panel';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { DetailSkeleton } from '../components/Skeleton';
import { DetailHead } from '../components/Status';
import './details.css';

// Rows start at y=770 under the info; scrolled rows move up to y=182.
export const DETAIL_LEAD = 588;

/** Start playback, showing "Starting…" on the button until Kodi has the
 * file and ignoring repeated presses. */
export function usePlay() {
  const [starting, setStarting] = createSignal(false);
  const start = (item: Metadata, fromStart = false) => {
    if (starting()) return;
    setStarting(true);
    play(item, fromStart)
      .catch((e) => console.error(`play: ${e}`))
      .finally(() => setStarting(false));
  };
  return { starting, start };
}

/** Movie details, playback and watched controls, followed by cast, extras and recommendations. */
export function Movie(props: { ratingKey: string }) {
  const [meta, { refetch }] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    async ([key]) => {
      const m = await metadata(currentServer(), key);
      if (!m) throw new Error(`no metadata for ${key}`);
      return { item: m, logo: await logoReady(m) };
    },
  );
  const [more] = createResource(() => props.ratingKey, (key) => related(currentServer(), key).catch(() => []));
  const { starting, start } = usePlay();
  const [panel, setPanel] = createSignal<'more' | 'description' | null>(null);
  const current = loaded(meta);
  const item = () => current()?.item;
  // Rows that don't fit below the info scroll the page up over it.
  const [scroll, setScroll] = createSignal(0);

  const moreOptions = () => {
    const m = item()!;
    return [
      ...(m.summary ? [{ label: t('action.description'), value: 'description', icon: 'info' as const }] : []),
      ...(m.Collection ?? []).map((c) => ({ label: t('details.inCollection', { collection: c.tag }), value: `collection:${c.tag}`, icon: 'movie' as const })),
    ];
  };
  const onMore = (value: string) => {
    if (value === 'description') return setPanel('description');
    setPanel(null);
    const m = item()!;
    const tag = m.Collection?.find((c) => `collection:${c.tag}` === value);
    const filter = tag?.filter ?? (tag?.id !== undefined ? `collection=${tag.id}` : undefined);
    if (tag && filter && m.librarySectionID !== undefined)
      push({ screen: 'person', section: String(m.librarySectionID), filter, title: tag.tag });
  };

  return (
    <div class="details" classList={{ scrolled: scroll() > 0 }} style={{ '--detail-scroll': `${scroll()}px` }}>
      <Backdrop art={item()?.art} colors={item()?.UltraBlurColors} />
      <div class="scroll-dim" />
      <DetailHead />
      <Switch fallback={<DetailSkeleton />}>
        <Match when={meta.error && !current()}>
          <Message class="details-message" icon="warning" title={t('details.loadFailed')}>
            <Button icon="restart" label={t('action.retry')} autofocus onSelect={refetch} />
          </Message>
        </Match>
        <Match when={current()}>
          {(m) => (
            <>
              <div class="details-info">
                <Info item={m().item} logo={m().logo} meta={metaFor(m().item, false)} badges={badges(m().item)} summary={m().item.tagline ? `${m().item.tagline}  ${m().item.summary ?? ''}` : m().item.summary}>
                  <p class="genres">
                    {[
                      ...(m().item.Genre ?? []).slice(0, 3).map((g) => g.tag),
                      ...(m().item.Director ?? []).slice(0, 1).map((d) => t('directedBy', { name: d.tag })),
                    ].join(' · ')}
                  </p>
                  <div class="actions">
                    <Button
                      icon="play"
                      label={starting() ? t('action.starting') : m().item.viewOffset ? t('action.resume') : t('action.play')}
                      sub={starting() ? undefined : remaining(m().item) || duration(m().item.duration)}
                      busy={starting()}
                      group="actions"
                      autofocus
                      onSelect={() => start(m().item)}
                    />
                    <Show when={m().item.viewOffset}>
                      <Button icon="restart" label={t('action.fromStart')} group="actions" onSelect={() => start(m().item, true)} />
                    </Show>
                    <WatchlistButton item={m().item} />
                    <WatchedButton item={m().item} />
                    <Show when={moreOptions().length}>
                      <Button icon="more" group="actions" onSelect={() => setPanel('more')} />
                    </Show>
                  </div>
                  <div class="chips">
                    <TrackChips item={m().item} />
                  </div>
                </Info>
              </div>
              <Shelf class="details-shelf" lead={DETAIL_LEAD} onScroll={setScroll}>
                <Show when={m().item.Role?.length}>
                  <div>
                    <People title={t('details.cast')} people={m().item.Role!.slice(0, 20)} group="cast" onSelect={(p) => openPerson(m().item, p)} />
                  </div>
                </Show>
                <Show when={m().item.Extras?.Metadata?.length}>
                  <div>
                    <Row
                      title={t('details.extras')}
                      items={m().item.Extras!.Metadata!}
                      shape="wide"
                      group="extras"
                      lines={(x) => [clean(x.title), duration(x.duration)]}
                      onSelect={(x) => start(x)}
                    />
                  </div>
                </Show>
                <For each={more()?.slice(0, 3)}>
                  {(hub) => (
                    <div>
                      <Row title={hubTitle(hub)} items={hub.Metadata!} group={`related-${hub.hubIdentifier}`} onSelect={open} />
                    </div>
                  )}
                </For>
              </Shelf>
              <Show when={panel() === 'more'}>
                <Panel title={clean(m().item.title)} options={moreOptions()} onChoose={onMore} onClose={() => setPanel(null)} />
              </Show>
              <Show when={panel() === 'description'}>
                <Reader title={clean(m().item.title)} text={m().item.summary ?? ''} onClose={() => setPanel(null)} />
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
