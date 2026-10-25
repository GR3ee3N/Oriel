import { createEffect, createSignal, type JSX, on } from 'solid-js';
import { focused } from '../../nav';
import './shelf.css';

/** Sections (rows) under a page's info, in a box clipped at its top: the
 * section holding the focus moves up to the top line, the ones above it
 * slide out of view, and focus above the shelf brings it back to the
 * start. Each child is one section.
 *
 * With `lead`, the box starts that many pixels above the first section.
 * A section that fits on screen where it is stays in place; others move up
 * to the box's top line, over the page's info. `onScroll` reports how far
 * the sections moved, so the page can move its info with them. */
export function Shelf(props: { class?: string; lead?: number; onScroll?: (px: number) => void; children: JSX.Element }) {
  let box!: HTMLDivElement;
  let inner!: HTMLDivElement;
  const [offset, setOffset] = createSignal(0);
  const place = (px: number) => {
    setOffset(px);
    props.onScroll?.(px);
  };
  createEffect(
    on(focused, (el) => {
      if (!el || !box.isConnected) return;
      const page = box.parentElement;
      // The rail opens over the page; leave the rows where they are.
      if (!page?.contains(el) || el.closest('.rail')) return;
      if (!inner.contains(el)) return place(0);
      const sections = [...inner.children] as HTMLElement[];
      const section = sections.find((c) => c.contains(el));
      if (!section) return;
      // With a lead, a section stays put if it fits on screen below the
      // info; sections end in 44px of spacing that may run off the bottom.
      const fits = box.offsetTop + section.offsetTop + section.offsetHeight - 44 <= window.innerHeight;
      place(props.lead && fits ? 0 : section.offsetTop);
    }),
  );
  return (
    <div class={props.class ? `shelf ${props.class}` : 'shelf'} ref={box}>
      <div class="shelf-inner" ref={inner} style={{ transform: `translateY(${-offset()}px)`, 'padding-top': props.lead ? `${props.lead}px` : undefined }}>
        {props.children}
      </div>
    </div>
  );
}
