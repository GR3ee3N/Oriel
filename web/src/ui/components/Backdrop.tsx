import { createEffect, on, onCleanup } from 'solid-js';
import { imageUrl } from '../../plex/images';
import type { UltraBlurColors } from '../../plex/types';
import { currentServer } from '../../session';
import './backdrop.css';

// Half size, scaled up 2x by the compositor: a quarter of the pixels to
// fetch and decode, and it fades into the colour field anyway.
const W = 960;
const H = 540;

// The colour field: Plex's four corner colours of the art (UltraBlurColors),
// blended over 16×9 pixels and scaled smoothly into the scene. A border of
// the edge colours, one pixel wide, keeps the scaling from fading the outer
// pixels.
const FW = 16;
const FH = 9;
const FALLBACK: UltraBlurColors = { topLeft: '1d2338', topRight: '2a3352', bottomRight: '0d1018', bottomLeft: '121624' };
// Darker than Plex's own use: white text sits on it.
const DIM = 0.62;

// Scratch canvases for painting a scene. On the CPU (willReadFrequently):
// WPE's GPU canvas on the box got the art's fade masks wrong, leaving light
// art at full strength under the rows.
const field = Object.assign(document.createElement('canvas'), { width: FW + 2, height: FH + 2 });
const faded = Object.assign(document.createElement('canvas'), { width: W, height: H });
const context = (canvas: HTMLCanvasElement) => canvas.getContext('2d', { willReadFrequently: true })!;

function paintField(c: UltraBlurColors): void {
  const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const [tl, tr, br, bl] = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map(rgb);
  const ctx = context(field);
  const img = ctx.createImageData(FW + 2, FH + 2);
  for (let y = 0; y < FH + 2; y++) {
    for (let x = 0; x < FW + 2; x++) {
      const u = Math.min(Math.max(x - 1, 0), FW - 1) / (FW - 1);
      const v = Math.min(Math.max(y - 1, 0), FH - 1) / (FH - 1);
      const o = (y * (FW + 2) + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = tl[k] * (1 - u) + tr[k] * u;
        const bottom = bl[k] * (1 - u) + br[k] * u;
        img.data[o + k] = (top * (1 - v) + bottom * v) * DIM;
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Bakes the field and the art with its fades into one canvas, once per
 * item: WebKit rasterizes a scaled layer at its size on screen, so each
 * extra layer costs a screenful of painting. CSS masks inside an opacity
 * transition also retain full-screen GPU surfaces on WPE/Mali. */
function paintScene(canvas: HTMLCanvasElement, colors: UltraBlurColors, img: HTMLImageElement | undefined): void {
  paintField(colors);
  const ctx = context(canvas);
  ctx.drawImage(field, 1, 1, FW, FH, 0, 0, W, H);
  if (!img) return;
  const fctx = context(faded);
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, W, H);
  fctx.drawImage(img, 0, 0, W, H);
  fctx.globalCompositeOperation = 'destination-in';
  for (const [gradient, stops] of [
    [fctx.createLinearGradient(0, 0, W, 0), [[0, 0], [0.22, 0.35], [0.58, 1]]],
    [fctx.createLinearGradient(0, H, 0, 0), [[0, 0], [0.30, 0.5], [0.62, 1]]],
  ] as const) {
    for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
    fctx.fillStyle = gradient;
    fctx.fillRect(0, 0, W, H);
  }
  ctx.drawImage(faded, 0, 0);
}

/** The screen behind a page: the item's colour field, and its art over the
 * right and top, fading into the field. A new item waits until the focus
 * has settled (a fast scroll doesn't fetch every backdrop), its art is
 * decoded off-screen, and then the two scenes cross-fade: opacity only, so
 * the compositor does the fade. */
export function Backdrop(props: { art?: string; colors?: UltraBlurColors; delay?: number }) {
  const scenes: { root: HTMLDivElement; canvas: HTMLCanvasElement }[] = [];
  let shown = -1;
  let showing = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = async (art: string | undefined, colors: UltraBlurColors | undefined) => {
    const key = `${art ?? ''}|${JSON.stringify(colors ?? null)}`;
    if (key === showing) return;
    let img: HTMLImageElement | undefined;
    if (art) {
      img = new Image();
      img.src = imageUrl(currentServer(), art, W, H);
      try {
        await img.decode();
      } catch {
        img = undefined;
      }
      if (props.art !== art) return;
    }
    const next = shown === 0 ? 1 : 0;
    const scene = scenes[next];
    paintScene(scene.canvas, colors ?? FALLBACK, img);
    scene.root.style.opacity = '1';
    if (shown >= 0) scenes[shown].root.style.opacity = '0';
    shown = next;
    showing = key;
  };

  createEffect(
    on(
      () => [props.art, props.colors] as const,
      ([art, colors]) => {
        clearTimeout(timer);
        // The first scene at once, without art if there is none yet.
        if (shown < 0 && !art) {
          void show(undefined, colors);
          return;
        }
        timer = setTimeout(() => void show(art, colors), shown < 0 ? 0 : (props.delay ?? 300));
      },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  const scene = (i: number) => (
    <div class="scene" ref={(el) => (scenes[i] = { ...scenes[i], root: el })}>
      <canvas width={W} height={H} ref={(el) => (scenes[i] = { ...scenes[i], canvas: el })} />
    </div>
  );

  return (
    <div class="backdrop">
      {scene(0)}
      {scene(1)}
      <div class="shade" />
    </div>
  );
}
