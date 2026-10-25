import { Show } from 'solid-js';

/** Profile picture over its initial, so a slow or failed image still shows a letter. */
export function Avatar(props: { user?: { title?: string; thumb?: string }; class?: string }) {
  return (
    <span class={props.class ? `avatar ${props.class}` : 'avatar'}>
      {props.user?.title?.[0]?.toUpperCase()}
      <Show when={props.user?.thumb}>{(src) => <img src={src()} alt="" />}</Show>
    </span>
  );
}
