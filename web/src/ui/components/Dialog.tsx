import { For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { appRoot } from './Panel';
import { activeScope, focusable, onBack, setScope } from '../../nav';
import { t } from '../../i18n';
import './dialog.css';

let dialogs = 0;

/** Centred question with its choices in a row. The first choice has focus
 * and should be the safe one; Back calls onCancel. */
export function Dialog(props: {
  title: string;
  body?: string;
  choices: { label: string; onSelect: () => void }[];
  onCancel: () => void;
  /** Wider panel for reading, e.g. a full description. */
  wide?: boolean;
}) {
  const scope = `dialog-${dialogs++}`;
  const previous = activeScope();
  onBack(() => props.onCancel());
  onCleanup(() => setScope(previous));
  queueMicrotask(() => setScope(scope, true));
  return (
    <Portal mount={appRoot()}>
      <div class="dialog-shade">
        <div class="dialog" classList={{ wide: props.wide }}>
          <h2>{props.title}</h2>
          <Show when={props.body}>
            <p>{props.body}</p>
          </Show>
          <div class="dialog-choices">
            <For each={props.choices}>
              {(c, i) => (
                <div class="button" ref={(el) => focusable(el, { scope, autofocus: i() === 0, onSelect: c.onSelect })}>
                  {c.label}
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Long text such as a full description, with Close focused. */
export function Reader(props: { title: string; text: string; onClose: () => void }) {
  return (
    <Dialog
      title={props.title}
      body={props.text}
      choices={[{ label: t('action.close'), onSelect: props.onClose }]}
      onCancel={props.onClose}
      wide
    />
  );
}
