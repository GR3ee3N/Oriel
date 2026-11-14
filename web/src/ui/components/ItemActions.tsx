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
export function WatchedButton(props: { item: Item; group?: string }) {
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
export function WatchlistButton(props: { item: Item; group?: string }) {
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
        onSelect={toggle}
      />
    </Show>
  );
}

/** Where a track choice is kept: on the server, for every client that plays
 * the title, or on this box until the app closes. */
export const trackHint = () =>
  provider().features.savedTracks ? t('details.trackHint', { server: session.serverName ?? '' }) : t('details.trackHintHere');

/** Audio and subtitle chips for the file Play starts. A choice is saved
 * where `trackHint` says, and used by the next Play. Hidden when there's nothing to choose. The tracks come from
 * the item's full details, as the player reads them. */
export function TrackChips(props: { item: Item; group?: string }) {
  const [details] = createResource(
    () => [props.item.id, dataVersion()] as const,
    ([id]) => provider().item(id),
  );
  const full = loaded(details);
  const versions = () => full()?.versions ?? [];
  const version = () => Math.min(chosenVersion(props.item.id), Math.max(0, versions().length - 1));
  const file = () => versions()[version()];
  const audio = () => (file() ? audioTracks(file()!) : []);
  const subtitles = () => (file() ? subtitleTracks(file()!) : []);
  const [panel, setPanel] = createSignal<'audio' | 'subtitles' | 'version' | null>(null);
  const current = (tracks: Track[]) => tracks.find((x) => x.selected);
  const save = (kind: 'audio' | 'subtitles', id: number) => {
    const item = full();
    setPanel(null);
    if (!item || !file()) return;
    provider()
      .playback.saveTrack(item, version(), kind === 'audio' ? 'audio' : 'subtitle', id)
      .then(refresh)
      .catch((e) => {
        console.error(`tracks: ${e}`);
        notice(t('details.writeFailed', { title: clean(props.item.title) }));
      });
  };
  const describe = (x: Track) => x.detail || undefined;
  // Versions that share a label, such as two 4K Dolby Vision files, add their bitrate.
  const versionName = (i: number) => {
    const { label } = versionLabel(versions()[i]);
    const twin = versions().some((m, j) => j !== i && versionLabel(m).label === label);
    const rate = versions()[i].bitrate;
    return twin && rate ? `${label} · ${Math.round(rate / 1000)} Mbps` : label;
  };
  // Language and format, e.g. "German · DTS-HD MA 5.1".
  const audioLabel = (x: Track) => [x.label, x.detail.split(' · ')[0]].filter(Boolean).join(' · ');
  return (
    <>
      <Show when={versions().length > 1}>
        <Chip icon="version" label={t('details.version')} value={versionName(version())} group={props.group ?? 'tracks'} onSelect={() => setPanel('version')} />
      </Show>
      <Show when={panel() === 'version'}>
        <Panel
          title={t('details.version')}
          options={versions().map((m, i) => ({ ...versionLabel(m), value: i }))}
          selected={version()}
          onChoose={(i) => {
            setPanel(null);
            chooseVersion(props.item.id, i);
          }}
          onClose={() => setPanel(null)}
        />
      </Show>
      <Show when={audio().length > 1}>
        <Chip icon="audio" value={audioLabel(current(audio()) ?? audio()[0])} group={props.group ?? 'tracks'} onSelect={() => setPanel('audio')} />
      </Show>
      <Show when={subtitles().length > 0}>
        <Chip icon="subtitles" label={t('details.subtitles')} value={current(subtitles())?.label ?? t('details.subtitlesOff')} group={props.group ?? 'tracks'} onSelect={() => setPanel('subtitles')} />
      </Show>
      <Show when={panel() === 'audio' || panel() === 'subtitles' ? (panel() as 'audio' | 'subtitles') : undefined}>
        {(kind) => {
          const tracks = kind() === 'audio' ? audio() : [SUBTITLES_OFF, ...subtitles()];
          return (
            <Panel
              title={kind() === 'audio' ? t('details.audio') : t('details.subtitles')}
              hint={trackHint()}
              options={tracks.map((x) => ({ label: x.label, value: x.id, detail: describe(x) }))}
              selected={current(tracks)?.id ?? 0}
              onChoose={(id) => save(kind(), id)}
              onClose={() => setPanel(null)}
            />
          );
        }}
      </Show>
    </>
  );
}
