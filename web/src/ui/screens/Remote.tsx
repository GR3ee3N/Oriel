// A Watchlist title that no library on the current server has.

import { createResource, Show } from 'solid-js';
import { t } from '../../i18n';
import { badges, clean } from '../../plex/format';
import { discoverMetadata, setWatchlisted } from '../../plex/watchlist';
import { notice } from '../../notice';
import { pop } from '../../router';
import { session } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Controls';
import { Info, metaFor } from '../components/Info';
import { DetailHead } from '../components/Status';
import './details.css';

export function Remote(props: { guid: string; title: string }) {
  const [meta] = createResource(() => props.guid, (guid) => discoverMetadata(guid).catch(() => undefined));
  const remove = () =>
    setWatchlisted(props.guid, false)
      .then(() => {
        notice(t('watchlist.removed'));
        pop();
      })
      .catch(() => notice(t('watchlist.failed')));
  return (
    <div class="details">
      <Backdrop art={meta()?.art} />
      <DetailHead />
      <div class="details-info">
        <Info
          item={meta() ?? { ratingKey: props.guid, key: '', type: 'movie', title: props.title }}
          meta={meta() ? metaFor(meta()!) : undefined}
          badges={badges(meta())}
          summary={meta()?.summary}
        >
          <p class="genres">{(meta()?.Genre ?? []).slice(0, 3).map((g) => g.tag).join(' · ')}</p>
          <p class="remote-note">{t('details.notOnServerHint', { server: session.serverName ?? '' })}</p>
          <div class="actions">
            <Button icon="close" label={t('action.removeWatchlist')} autofocus group="actions" onSelect={remove} />
          </div>
        </Info>
      </div>
      <Show when={!meta.loading && !meta()}>
        <p class="details-message">{clean(props.title)}</p>
      </Show>
    </div>
  );
}
