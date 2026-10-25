import { For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { activeScope, focusable, onBack, setScope } from '../../nav';
import { Icon, type IconName } from './Icon';
import './panel.css';

export interface PanelOption<T> {
  label: string;
  value: T;
  /** Second line, e.g. "Forced · foreign dialogue only". */
  detail?: string;
  /** Current value of a sub-setting, shown at the right. */
  current?: string;
  icon?: IconName;
  swatch?: string;
}

let panels = 0;

/** Choice list in a panel at the right, over a dimmed page. Focus starts on
 * the selected option, or on `focus` in a list without one; Back calls onClose. The caller decides whether a
 * choice closes the panel, so one panel can step into a sub-list. */
export function Panel<T>(props: {
  title: string;
  hint?: string;
  options: PanelOption<T>[];
  selected?: T;
  focus?: T;
  onChoose: (value: T) => void;
  onClose: () => void;
}) {
  const scope = `panel-${panels++}`;
  const previous = activeScope();
  onBack(() => props.onClose());
  onCleanup(() => setScope(previous));
  queueMicrotask(() => setScope(scope, true));
  // Render at the app root so the shade covers the page wherever the panel opens from.
  return (
    <Portal mount={appRoot()}>
      <div class="panel-layer">
        <div class="panel-shade" />
        <div class="panel">
          <h2>{props.title}</h2>
          <Show when={props.hint}>
            <p class="panel-hint">{props.hint}</p>
          </Show>
          <div class="panel-list">
            <For each={props.options}>
              {(o) => (
                <div
                  class="panel-option"
                  classList={{ selected: props.selected !== undefined && o.value === props.selected }}
                  ref={(el) =>
                    focusable(el, {
                      scope,
                      autofocus: o.value === (props.selected ?? props.focus),
                      onFocus: () => el.scrollIntoView({ block: 'nearest' }),
                      onSelect: () => props.onChoose(o.value),
                    })
                  }
                >
                  <Show when={o.icon}>{(name) => <Icon name={name()} />}</Show>
                  <Show when={o.swatch}>
                    <span class="swatch" style={{ background: o.swatch }} />
                  </Show>
                  <span class="panel-label">
                    {o.label}
                    <Show when={o.detail}>
                      <small>{o.detail}</small>
                    </Show>
                  </span>
                  <Show when={o.current !== undefined}>
                    <b>{o.current}</b>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** The app's root element, above every page layer. */
export const appRoot = () => document.querySelector<HTMLElement>('.app') ?? document.body;
