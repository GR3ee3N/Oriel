import { focusable } from '@oriel/web';
import { refresh } from '../../data';
import { setWatched } from '../../plex/api';
import { isWatched } from '../../plex/format';
import type { Metadata } from '../../plex/types';
import { currentServer } from '../../session';

/** Marks the item (movie, episode, show) watched or unwatched. */
export function WatchedButton(props: { item: Metadata; group?: string }) {
  const watched = () => isWatched(props.item);
  return (
    <div
      class="btn"
      ref={(el) =>
        focusable(el, {
          group: props.group ?? 'actions',
          onSelect: () =>
            setWatched(currentServer(), props.item.ratingKey, !watched())
              .then(refresh)
              .catch((e) => console.error(`watched: ${e}`)),
        })
      }
    >
      {watched() ? '✓ Watched' : 'Mark watched'}
    </div>
  );
}
