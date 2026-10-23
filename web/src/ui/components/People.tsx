import { createSignal, For, Show } from 'solid-js';
import { focusable } from '@oriel/web';
import { imageUrl } from '../../plex/images';
import type { Role } from '../../plex/types';
import { currentServer } from '../../session';
import './people.css';

const SIZE = 150;
const GAP = 36;

/** Show cast portraits, names and roles; Select lists their titles in this library. */
export function People(props: { title: string; people: Role[]; group: string; onSelect: (person: Role) => void }) {
  const [col, setCol] = createSignal(0);
  return (
    <section class="row people">
      <h2>{props.title}</h2>
      <div class="tiles" style={{ transform: `translateX(${-Math.max(0, col() - 2) * (SIZE + GAP)}px)`, gap: `${GAP}px` }}>
        <For each={props.people}>
          {(p, i) => (
            <div
              class="person"
              ref={(el) =>
                focusable(el, { group: props.group, onFocus: () => setCol(i()), onSelect: () => props.onSelect(p) })
              }
            >
              <div class="portrait">
                <Show when={p.thumb} fallback={<span>{p.tag[0]}</span>}>
                  {(t) => <img src={imageUrl(currentServer(), t(), SIZE, SIZE)} alt="" decoding="async" />}
                </Show>
              </div>
              <b>{p.tag}</b>
              <span>{p.role}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
