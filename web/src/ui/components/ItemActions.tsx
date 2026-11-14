// Detail-page actions shared by movies and shows: watched state, Watchlist,
// and audio and subtitle choice before playback.

import { createResource, createSignal, Show } from 'solid-js';
import { dataVersion, loaded, refresh } from '../../data';
import { t } from '../../i18n';
import { clean, isWatched } from '../../media/format';
import type { Item } from '../../media/model';
import { provider } from '../../media/servers';
import { chooseVersion, chosenVersion } from '../../actions';
import { versionLabel } from '../../media/format';
import { audioTracks, subtitleTracks, SUBTITLES_OFF, type Track } from '../../player/tracks';
import { notice } from '../../notice';
import { session } from '../../session';
import { Button, Chip } from './Controls';
import { Dialog } from './Dialog';
import { Panel } from './Panel';

/** Toggle watched state. The target is captured on Select, so moving focus
 * while the server answers can't change which item is written. A whole
 * show asks first. */
export function WatchedButton(props: { item: Item; group?: string; class?: string }) {
  const [busy, setBusy] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const watched = () => isWatched(props.item);
  const write = (item: Item, on: boolean) => {
    setBusy(true);
    provider()
      .setWatched(item.id, on)
      .then(refresh)
      .catch((e) => {
        console.error(`watched: ${e}`);
        notice(t('details.writeFailed', { title: clean(item.title) }));
      })
      .finally(() => setBusy(false));
  };
  const select = () => {
    if (props.item.kind === 'show' || props.item.kind === 'season') return setAsking(true);
    write(props.item, !watched());
  };
  return (
    <>
      <Button
        icon="check"
        label={watched() ? t('action.markUnwatched') : t('action.markWatched')}
        busy={busy()}
        group={props.group ?? 'actions'}
        class={props.class}
        onSelect={select}
      />
      <Show when={asking()}>
        {(() => {
          const item = props.item;
          const on = !watched();
          return (
            <Dialog
              title={`${on ? t('action.markWatched') : t('action.markUnwatched')}: ${clean(item.title)}?`}
              choices={[
                { label: t('action.cancel'), onSelect: () => setAsking(false) },
                { label: on ? t('action.markWatched') : t('action.markUnwatched'), onSelect: () => (setAsking(false), write(item, on)) },
              ]}
              onCancel={() => setAsking(false)}
            />
          );
        })()}
      </Show>
    </>
  );
}

/** Add to or remove from the profile's Watchlist. */
export function WatchlistButton(props: { item: Item; group?: string; class?: string }) {
  const list = provider().watchlist;
  if (!list) return null;
  const [on, { mutate }] = createResource(
    () => [props.item.guid, list.version()] as const,
    ([guid]) => list.has(guid).catch(() => false),
  );
  const [busy, setBusy] = createSignal(false);
  const toggle = () => {
    const guid = props.item.guid;
    if (!guid) return;
    const next = !on();
    setBusy(true);
    list
      .set(guid, next)
      .then(() => mutate(next))
      .catch((e) => {
        console.error(`watchlist: ${e}`);
        notice(t('watchlist.failed'));
      })
      .finally(() => setBusy(false));
  };
  return (
    <Show when={list.accepts(props.item.guid)}>
      <Button
        icon={on() ? 'watchlistOn' : 'watchlist'}
        label={on() ? t('action.watchlistOn') : t('action.watchlistAdd')}
        on={on()}
        busy={busy()}
        group={props.group ?? 'actions'}
        class={props.class}
        onSelect={toggle}
      />
    </Show>
  );
}

/** Where a track choice is kept: on the server, for every client that plays
 * the title, or on this box until the app closes. */
export const trackHint = () =>
  provider().features.savedTracks ? t('details.trackHint', { server: session.serverName ?? '' }) : t('details.trackHintHere');

export type TrackPanel = 'audio' | 'subtitles' | 'version';

/** Version, audio & subtitle choice for the file Play starts. A choice is
 * saved where `trackHint` says, and used by the next Play. The tracks come
 * from the item's full details, as the player reads them. `Panels` renders
 * the list `open` asked for. */
export function useTracks(item: () => Item | undefined) {
  const [details] = createResource(
    () => {
      const i = item();
      return i ? ([i.id, dataVersion()] as const) : null;
    },
    ([id]) => provider().item(id),
  );
  const got = loaded(details);
  const full = () => {
    const d = got();
    return d && d.id === item()?.id ? d : undefined;
  };
  const versions = () => full()?.versions ?? [];
  const version = () => Math.min(chosenVersion(item()?.id ?? ''), Math.max(0, versions().length - 1));
  const file = () => versions()[version()];
  const audio = () => (file() ? audioTracks(file()!) : []);
  const subtitles = () => (file() ? subtitleTracks(file()!) : []);
  const [panel, setPanel] = createSignal<TrackPanel | null>(null);
  const current = (tracks: Track[]) => tracks.find((x) => x.selected);
  const save = (kind: 'audio' | 'subtitles', id: number) => {
    const f = full();
    setPanel(null);
    if (!f || !file()) return;
    provider()
      .playback.saveTrack(f, version(), kind === 'audio' ? 'audio' : 'subtitle', id)
      .then(refresh)
      .catch((e) => {
        console.error(`tracks: ${e}`);
        notice(t('details.writeFailed', { title: clean(f.title) }));
      });
  };
  // Versions that share a label, such as two 4K Dolby Vision files, add their bitrate.
  const versionName = (i: number) => {
    const { label } = versionLabel(versions()[i]);
    const twin = versions().some((m, j) => j !== i && versionLabel(m).label === label);
    const rate = versions()[i].bitrate;
    return twin && rate ? `${label} · ${Math.round(rate / 1000)} Mbps` : label;
  };
  // Language and format, e.g. "German · DTS-HD MA 5.1".
  const audioLabel = (x: Track) => [x.label, x.detail.split(' · ')[0]].filter(Boolean).join(' · ');
  const Panels = () => (
    <>
      <Show when={panel() === 'version'}>
        <Panel
          title={t('details.version')}
          options={versions().map((m, i) => ({ ...versionLabel(m), value: i }))}
          selected={version()}
          onChoose={(i) => {
            setPanel(null);
            const id = item()?.id;
            if (id) chooseVersion(id, i);
          }}
          onClose={() => setPanel(null)}
        />
      </Show>
      <Show when={panel() === 'audio' || panel() === 'subtitles' ? (panel() as 'audio' | 'subtitles') : undefined}>
        {(kind) => {
          const tracks = kind() === 'audio' ? audio() : [SUBTITLES_OFF, ...subtitles()];
          return (
            <Panel
              title={kind() === 'audio' ? t('details.audio') : t('details.subtitles')}
              hint={trackHint()}
              options={tracks.map((x) => ({ label: x.label, value: x.id, detail: x.detail || undefined }))}
              selected={current(tracks)?.id ?? 0}
              onChoose={(id) => save(kind(), id)}
              onClose={() => setPanel(null)}
            />
          );
        }}
      </Show>
    </>
  );
  return {
    /** Labels of the current choices; undefined when there's nothing to choose. */
    versionValue: () => (versions().length > 1 ? versionName(version()) : undefined),
    audioValue: () => (audio().length > 1 ? audioLabel(current(audio()) ?? audio()[0]) : undefined),
    subtitlesValue: () => (subtitles().length > 0 ? (current(subtitles())?.label ?? t('details.subtitlesOff')) : undefined),
    open: (which: TrackPanel) => setPanel(which),
    Panels,
  };
}

/** Version, audio and subtitle chips; hidden when there's nothing to choose. */
export function TrackChips(props: { item: Item; group?: string }) {
  const tracks = useTracks(() => props.item);
  const group = () => props.group ?? 'tracks';
  return (
    <>
      <Show when={tracks.versionValue()}>
        {(v) => <Chip icon="version" label={t('details.version')} value={v()} group={group()} onSelect={() => tracks.open('version')} />}
      </Show>
      <Show when={tracks.audioValue()}>{(v) => <Chip icon="audio" value={v()} group={group()} onSelect={() => tracks.open('audio')} />}</Show>
      <Show when={tracks.subtitlesValue()}>
        {(v) => <Chip icon="subtitles" label={t('details.subtitles')} value={v()} group={group()} onSelect={() => tracks.open('subtitles')} />}
      </Show>
      <tracks.Panels />
    </>
  );
}
