import { createSignal, type JSX, Show } from 'solid-js';
import { open } from '../../actions';
import { t } from '../../i18n';
import type { MediaContainer } from '../../plex/types';
import { Message } from '../components/Controls';
import { Grid } from '../components/Grid';
import { DetailHead } from '../components/Status';
import './library.css';

/** Full-width grid of a collection's members, a playlist or a person's
 * titles in one library, with Home at the top right. `actions` sit under
 * the title, e.g. Play all. */
export function Titles(props: {
  title: string;
  key: string;
  load: (start: number, size: number) => Promise<MediaContainer>;
  actions?: JSX.Element;
}) {
  const [total, setTotal] = createSignal<number>();
  return (
    <div class="library detail-page">
      <div class="screen-bg" />
      <DetailHead />
      <header class="page-head">
        <h1>{props.title}</h1>
        <Show when={total() !== undefined}>
          <span>{t('count.titles', { n: total()! })}</span>
        </Show>
      </header>
      <Show when={props.actions}>
        <div class="detail-actions">{props.actions}</div>
      </Show>
      <Grid
        key={props.key}
        load={props.load}
        onSelect={open}
        onTotal={setTotal}
        class="detail-grid"
        empty={<Message icon="movie" title={t('library.empty', { library: props.title })} />}
      />
    </div>
  );
}
