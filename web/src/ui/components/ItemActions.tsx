// Detail-page actions shared by movies and shows: watched state, Watchlist,
// and audio and subtitle choice before playback.

import { createResource, createSignal, Show } from 'solid-js';
import { refresh } from '../../data';
import { t } from '../../i18n';
import { setWatched } from '../../plex/api';
import { clean, isWatched } from '../../plex/format';
import type { Metadata, Part } from '../../plex/types';
import { isWatchlisted, setWatchlisted, watchlistVersion } from '../../plex/watchlist';
import { audioTracks, subtitleTracks, SUBTITLES_OFF, type Track } from '../../player/tracks';
import { notice } from '../../notice';
import { currentServer, session } from '../../session';
import { Button, Chip } from './Controls';
import { Dialog } from './Dialog';
import { Panel } from './Panel';

/** Toggle watched state. The target is captured on Select, so moving focus
 * while the server answers can't change which item is written. A whole
 * show asks first. */
export function WatchedButton(props: { item: Metadata; group?: string }) {
  const [busy, setBusy] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const watched = () => isWatched(props.item);
  const write = (item: Metadata, on: boolean) => {
    setBusy(true);
    setWatched(currentServer(), item.ratingKey, on)
      .then(refresh)
      .catch((e) => {
        console.error(`watched: ${e}`);
        notice(t('details.writeFailed', { title: clean(item.title) }));
      })
      .finally(() => setBusy(false));
  };
  const select = () => {
    if (props.item.type === 'show' || props.item.type === 'season') return setAsking(true);
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

/** Add to or remove from the profile's Watchlist on plex.tv. */
export function WatchlistButton(props: { item: Metadata; group?: string }) {
  const [on, { mutate }] = createResource(
    () => [props.item.guid, watchlistVersion()] as const,
    ([guid]) => isWatchlisted(guid).catch(() => false),
  );
  const [busy, setBusy] = createSignal(false);
  const toggle = () => {
    const guid = props.item.guid;
    if (!guid) return;
    const next = !on();
    setBusy(true);
    setWatchlisted(guid, next)
      .then(() => mutate(next))
      .catch((e) => {
        console.error(`watchlist: ${e}`);
        notice(t('watchlist.failed'));
      })
      .finally(() => setBusy(false));
  };
  return (
    <Show when={props.item.guid?.startsWith('plex://')}>
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

/** Audio and subtitle chips for the file Play starts. A choice is saved on
 * the server for this file, as other Plex clients do, and used by the next
 * Play. Hidden when there's nothing to choose. */
export function TrackChips(props: { item: Metadata; group?: string }) {
  const part = (): Part | undefined => props.item.Media?.[0]?.Part?.[0];
  const audio = () => (part() ? audioTracks(part()!) : []);
  const subtitles = () => (part() ? subtitleTracks(part()!) : []);
  const [panel, setPanel] = createSignal<'audio' | 'subtitles' | null>(null);
  const current = (tracks: Track[]) => tracks.find((x) => x.selected);
  const save = (kind: 'audio' | 'subtitles', id: number) => {
    const p = part();
    setPanel(null);
    if (!p) return;
    const param = kind === 'audio' ? { audioStreamID: id } : { subtitleStreamID: id };
    currentServer()
      .call(`/library/parts/${p.id}`, { ...param, allParts: 1 }, 'PUT')
      .then(refresh)
      .catch((e) => {
        console.error(`tracks: ${e}`);
        notice(t('details.writeFailed', { title: clean(props.item.title) }));
      });
  };
  const describe = (x: Track) => x.detail || undefined;
  // Language and format, e.g. "German · DTS-HD MA 5.1".
  const audioLabel = (x: Track) => [x.label, x.detail.split(' · ')[0]].filter(Boolean).join(' · ');
  return (
    <>
      <Show when={audio().length > 1}>
        <Chip icon="audio" value={audioLabel(current(audio()) ?? audio()[0])} group={props.group ?? 'tracks'} onSelect={() => setPanel('audio')} />
      </Show>
      <Show when={subtitles().length > 0}>
        <Chip icon="subtitles" label={t('details.subtitles')} value={current(subtitles())?.label ?? t('details.subtitlesOff')} group={props.group ?? 'tracks'} onSelect={() => setPanel('subtitles')} />
      </Show>
      <Show when={panel()}>
        {(kind) => {
          const tracks = kind() === 'audio' ? audio() : [SUBTITLES_OFF, ...subtitles()];
          return (
            <Panel
              title={kind() === 'audio' ? t('details.audio') : t('details.subtitles')}
              hint={t('details.trackHint', { server: session.serverName ?? '' })}
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
