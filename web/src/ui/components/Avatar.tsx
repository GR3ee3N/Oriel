import { Show } from 'solid-js';

/** Profile picture over its initial, so a slow or failed image still shows a letter. */
export function Avatar(props: { user?: { name?: string; photo?: string }; class?: string }) {
  return (
    <span class={props.class ? `avatar ${props.class}` : 'avatar'}>
      {props.user?.name?.[0]?.toUpperCase()}
      <Show when={props.user?.photo}>{(src) => <img src={src()} alt="" />}</Show>
    </span>
  );
}
