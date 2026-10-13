import { onCleanup } from 'solid-js';
import { activeScope, focusable, onBack, setScope } from '@oriel/web';
import './confirm.css';

let confirms = 0;

/** A question in the middle of the screen with two answers, in its own
 * focus scope like a Menu; Back is No. The focus starts on Yes. */
export function Confirm(props: {
  title: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const scope = `confirm-${confirms++}`;
  const previous = activeScope();
  onBack(props.onNo);
  onCleanup(() => setScope(previous));
  queueMicrotask(() => setScope(scope, true));
  return (
    <div class="confirm-shade">
      <div class="confirm">
        <h2>{props.title}</h2>
        <div class="confirm-buttons">
          <div class="btn" ref={(el) => focusable(el, { scope, autofocus: true, onSelect: props.onYes })}>
            {props.yes}
          </div>
          <div class="btn" ref={(el) => focusable(el, { scope, onSelect: props.onNo })}>
            {props.no}
          </div>
        </div>
      </div>
    </div>
  );
}
