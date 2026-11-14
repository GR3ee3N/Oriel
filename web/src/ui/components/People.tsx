import { createSignal, For, Show } from 'solid-js';
import type { Person } from '../../media/model';
import { provider } from '../../media/servers';
import { focusable } from '../../nav';
import './people.css';

const SIZE = 150;
const GAP = 36;

/** Show cast portraits, names and roles; Select lists their titles in this library. */
export function People(props: { title: string; people: Person[]; group: string; onSelect: (person: Person) => void }) {
  const [col, setCol] = createSignal(0);
  return (
    <section class="row people">
      <h2>{props.title}</h2>
      <div class="tiles" style={{ transform: `translateX(${-col() * (SIZE + GAP)}px)`, gap: `${GAP}px` }}>
        <For each={props.people}>
          {(p, i) => (
            <div
              class="person"
              ref={(el) =>
                focusable(el, {
                  group: props.group,
                  get entry() {
                    return i() === col();
                  },
                  onFocus: () => setCol(i()),
                  onSelect: () => props.onSelect(p),
                })
              }
            >
              <div class="portrait">
                <Show when={p.photo} fallback={<span>{p.name[0]}</span>}>
                  {(photo) => <img src={provider().image(photo(), SIZE, SIZE)} alt="" decoding="async" />}
                </Show>
              </div>
              <b>{p.name}</b>
              <span>{p.role}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
