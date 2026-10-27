import { type JSX, Show } from 'solid-js';
import { type Direction, focusable } from '../../nav';
import { Icon, type IconName } from './Icon';
import './controls.css';

interface ControlProps {
  icon?: IconName;
  label?: JSX.Element;
  /** Secondary text after the label, such as remaining time. */
  sub?: JSX.Element;
  group?: string;
  autofocus?: boolean;
  initial?: boolean;
  entry?: boolean;
  /** Show the selected state, such as a filter that is set. */
  on?: boolean;
  busy?: boolean;
  class?: string;
  onSelect: () => unknown;
  onFocus?: () => void;
  onArrow?: (d: Direction) => boolean;
}

function register(el: HTMLElement, props: ControlProps) {
  focusable(el, {
    group: props.group,
    autofocus: props.autofocus,
    initial: props.initial,
    get entry() {
      return props.entry;
    },
    onFocus: props.onFocus,
    onArrow: props.onArrow,
    onSelect: () => !props.busy && props.onSelect(),
  });
}

/** Pill button: icon, label and optional secondary text. Icon-only buttons
 * are round. */
export function Button(props: ControlProps) {
  return (
    <div
      class={`button${props.label === undefined ? ' round' : ''}${props.class ? ` ${props.class}` : ''}`}
      classList={{ on: props.on, busy: props.busy }}
      ref={(el) => register(el, props)}
    >
      <Show when={props.icon}>{(name) => <Icon name={name()} />}</Show>
      <Show when={props.label !== undefined}>
        <span>{props.label}</span>
      </Show>
      <Show when={props.sub}>
        <span class="sub">{props.sub}</span>
      </Show>
    </div>
  );
}

/** Outlined chip that states a setting and its value, e.g. "Sort Title". */
export function Chip(props: ControlProps & { value?: JSX.Element }) {
  return (
    <div class={`chip${props.class ? ` ${props.class}` : ''}`} classList={{ on: props.on }} ref={(el) => register(el, props)}>
      <Show when={props.icon}>{(name) => <Icon name={name()} />}</Show>
      <Show when={props.label !== undefined}>
        <span>{props.label}</span>
      </Show>
      <Show when={props.value !== undefined}>
        <b>{props.value}</b>
      </Show>
    </div>
  );
}

/** Text tab with an underline for the active one. */
export function Tab(props: ControlProps & { active: boolean; count?: JSX.Element }) {
  return (
    <div class="tab" classList={{ active: props.active }} ref={(el) => register(el, props)}>
      {props.label}
      <Show when={props.count !== undefined}>
        <small>{props.count}</small>
      </Show>
    </div>
  );
}

/** Centred message with an icon and the action that resolves it. */
export function Message(props: { icon: IconName; title: string; body?: string; children?: JSX.Element; class?: string }) {
  return (
    <div class={props.class ? `message ${props.class}` : 'message'}>
      <Icon name={props.icon} />
      <h2>{props.title}</h2>
      <Show when={props.body}>
        <p>{props.body}</p>
      </Show>
      <Show when={props.children}>
        <div class="message-actions">{props.children}</div>
      </Show>
    </div>
  );
}
