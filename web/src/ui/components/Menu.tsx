import { For, onCleanup, Show } from 'solid-js';
import { activeScope, focusable, onBack, setScope } from '../../nav';
import './menu.css';

export interface MenuOption<T> {
  label: string;
  value: T;
  /** Optional colour swatch preceding the label. */
  swatch?: string;
}

let menus = 0;

/** Isolate menu focus; Back or selection closes it and restores previous focus. */
export function Menu<T>(props: {
  title: string;
  options: MenuOption<T>[];
  selected?: T;
  onChoose: (value: T) => void;
  onClose: () => void;
}) {
  const scope = `menu-${menus++}`;
  const previous = activeScope();
  onBack(props.onClose);
  onCleanup(() => setScope(previous));
  queueMicrotask(() => setScope(scope, true));
  return (
    <div class="menu-shade">
      <div class="menu">
        <h2>{props.title}</h2>
        <For each={props.options}>
          {(o) => (
            <div
              class="option"
              classList={{ selected: o.value === props.selected }}
              ref={(el) =>
                focusable(el, {
                  scope,
                  autofocus: o.value === props.selected,
                  onFocus: () => el.scrollIntoView({ block: 'nearest' }),
                  onSelect: () => {
                    props.onChoose(o.value);
                    props.onClose();
                  },
                })
              }
            >
              <Show when={o.swatch}>
                <span class="swatch" style={{ background: o.swatch }} />
              </Show>
              {o.label}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
