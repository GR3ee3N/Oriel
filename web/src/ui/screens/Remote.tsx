// A Watchlist title that no library on the current server has.

import { createResource, Show } from 'solid-js';
import { t } from '../../i18n';
import { badges, clean } from '../../media/format';
import { provider } from '../../media/servers';
import { notice } from '../../notice';
import { pop } from '../../router';
import { session } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Controls';
import { Info, metaFor } from '../components/Info';
import { DetailHead } from '../components/Status';
import './details.css';

export function Remote(props: { guid: string; title: string }) {
  const list = provider().watchlist!;
  const [view] = createResource(
    () => props.guid,
    (guid) => list.details(guid).catch(() => undefined),
  );
  const remove = () =>
    list
      .set(props.guid, false)
      .then(() => {
        notice(t('watchlist.removed'));
        pop();
      })
      .catch(() => notice(t('watchlist.failed')));
  return (
    <div class="details">
      <Backdrop art={view()?.art.backdrop} />
      <DetailHead />
      <div class="details-info">
        <Info
          item={view() ?? { id: props.guid, kind: 'movie', title: props.title, art: {} }}
          meta={view() ? metaFor(view()!) : undefined}
          badges={badges(view())}
          summary={view()?.summary}
        >
          <p class="genres">{(view()?.genres ?? []).slice(0, 3).join(' · ')}</p>
          <p class="remote-note">{t('details.notOnServerHint', { server: session.serverName ?? '' })}</p>
          <div class="actions">
            <Button icon="close" label={t('action.removeWatchlist')} autofocus group="actions" onSelect={remove} />
          </div>
        </Info>
      </div>
      <Show when={!view.loading && !view()}>
        <p class="details-message">{clean(props.title)}</p>
      </Show>
    </div>
  );
}
