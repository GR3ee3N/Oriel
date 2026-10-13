import { createEffect, createSignal, type JSX, on } from 'solid-js';
import { focused } from '@oriel/web';
import './shelf.css';

/** Sections (rows) under a page's info, in a box clipped at its top: the
 * section holding the focus moves up to the top line, the ones above it
 * slide out of view, and focus above the shelf brings it back to the
 * start. Each child is one section. */
export function Shelf(props: { class?: string; children: JSX.Element }) {
  let box!: HTMLDivElement;
  let inner!: HTMLDivElement;
  const [offset, setOffset] = createSignal(0);
  createEffect(
    on(focused, (el) => {
      if (!el || !box.isConnected) return;
      const page = box.parentElement;
      if (!page?.contains(el)) return;
      if (!inner.contains(el)) return setOffset(0);
      const section = [...inner.children].find((c) => c.contains(el)) as HTMLElement | undefined;
      if (section) setOffset(section.offsetTop);
    }),
  );
  return (
    <div class={props.class ? `shelf ${props.class}` : 'shelf'} ref={box}>
      <div class="shelf-inner" ref={inner} style={{ transform: `translateY(${-offset()}px)` }}>
        {props.children}
      </div>
    </div>
  );
}
