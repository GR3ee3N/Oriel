// The add-on suppresses Kodi's screensaver because it would reveal Kodi's menu.
// After Kodi's configured idle delay, cross-fade library artwork every 15 s.
// Alternate title and clock corners to reduce burn-in risk. Keep scenes static
// between fades so the page does not require continuous rendering.

import { createResource, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { homeHubs } from '../plex/api';
import { clean, hhmm } from '../plex/format';
import { imageUrl } from '../plex/images';
import type { Metadata } from '../plex/types';
import { currentServer } from '../session';
import { logoReady } from './components/Info';
import './screensaver.css';

const EVERY = 15_000;

interface Slide {
  title: string;
  logo?: string;
  line: string;
}

/** Shuffle Home hub items that have artwork. */
async function pictures(): Promise<Metadata[]> {
  const hubs = await homeHubs(currentServer());
  const seen = new Set<string>();
  const out: Metadata[] = [];
  for (const h of hubs) {
    for (const m of h.Metadata ?? []) {
      const show = m.type === 'episode' ? { ...m, art: m.grandparentArt, title: m.grandparentTitle ?? m.title } : m;
      if (!show.art || seen.has(show.art)) continue;
      seen.add(show.art);
      out.push(show as Metadata);
    }
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function Screensaver() {
  const [items] = createResource(pictures);
  const layers: HTMLDivElement[] = [];
  const [slide, setSlide] = createSignal<Slide>();
  const [corner, setCorner] = createSignal(0);
  const [time, setTime] = createSignal(hhmm(new Date()));
  let shown = -1;
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Ignore image loads that complete after the screensaver unmounts.
  let disposed = false;

  const next = async () => {
    const list = items() ?? [];
    if (list.length) {
      const m = list[n++ % list.length];
      const img = new Image();
      img.src = imageUrl(currentServer(), m.art!, 1920, 1080);
      try {
        await img.decode();
        const logo = await logoReady(m);
        if (disposed) return;
        const i = shown === 0 ? 1 : 0;
        layers[i].replaceChildren(img);
        layers[i].style.opacity = '1';
        if (shown >= 0) layers[shown].style.opacity = '0';
        shown = i;
        setSlide({ title: clean(m.title), logo, line: [m.year, clean(m.tagline)].filter(Boolean).join(' · ') });
        setCorner((c) => (c + 1) % 2);
      } catch {
        // Continue to another item if artwork cannot load.
      }
    }
    if (disposed) return;
    setTime(hhmm(new Date()));
    timer = setTimeout(next, list.length ? EVERY : 1000);
  };
  onMount(() => void next());
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });

  return (
    <div class="screensaver">
      <div class="saver-layer" ref={(el) => (layers[0] = el)} />
      <div class="saver-layer" ref={(el) => (layers[1] = el)} />
      <div class="saver-shade" />
      <Show when={slide()}>
        {(s) => (
          <div class="saver-info" classList={{ right: corner() === 1 }}>
            <Show when={s().logo} fallback={<h1>{s().title}</h1>}>
              {(src) => <img class="saver-logo" src={src()} alt="" />}
            </Show>
            <p>{s().line}</p>
          </div>
        )}
      </Show>
      <div class="saver-clock" classList={{ left: corner() === 1 }}>
        {time()}
      </div>
    </div>
  );
}
