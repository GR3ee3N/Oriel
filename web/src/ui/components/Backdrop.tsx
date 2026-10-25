import { createEffect, on, onCleanup } from 'solid-js';
import { imageUrl } from '../../plex/images';
import type { UltraBlurColors } from '../../plex/types';
import { currentServer } from '../../session';
import './backdrop.css';

const W = 1920;
const H = 1080;

/** Use the painted backdrop dimensions when preloading artwork. */
export function backdropUrl(art: string): string {
  return imageUrl(currentServer(), art, W, H);
}

// Interpolate Plex's UltraBlurColors across a 16×9 field and scale it to
// the scene. Duplicate edge colours in a one-pixel border to keep scaling
// from fading the outer pixels.
const FW = 16;
const FH = 9;
const FALLBACK: UltraBlurColors = { topLeft: '1d2338', topRight: '2a3352', bottomRight: '0d1018', bottomLeft: '121624' };
// Dim the colour field to keep white text readable.
const DIM = 0.62;

// Reuse scratch canvases across scene paints.
const field = Object.assign(document.createElement('canvas'), { width: FW + 2, height: FH + 2 });
const faded = Object.assign(document.createElement('canvas'), { width: W, height: H });
// Text sits over the left 1180×700 of the scene. A 48×27 copy of the
// artwork is enough to find bright parts behind it.
const ZONE = { w: 1180, h: 700 };
const PW = 48;
const PH = 27;
// Reading pixels back from the GPU-backed scene canvas stalls the Mali GPU
// for a frame or more, so the small copy is measured on a CPU canvas.
const probe = Object.assign(document.createElement('canvas'), { width: PW, height: PH });
const probeContext = probe.getContext('2d', { willReadFrequently: true })!;
// Highest linear luminance allowed behind text: --ink-2 keeps about 6:1 and
// --ink-3 about 4.5:1 against it.
const CEILING = 0.08;
// Assumed luminance when artwork loaded without CORS can't be read.
const UNMEASURED = 0.25;
// Artwork opacity across the scene as gradient stops: left to right, and
// bottom to top. paintScene masks with them; measure() computes with them.
const FADE_X = [[0, 0.1], [0.3, 0.3], [0.55, 0.75], [0.75, 1]] as const;
const FADE_Y = [[0, 0], [0.3, 0.45], [0.6, 1]] as const;
const context = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!;

function fade(stops: readonly (readonly [number, number])[], t: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [a, av] = stops[i - 1];
    const [b, bv] = stops[i];
    if (t <= b) return av + ((bv - av) * Math.max(0, t - a)) / (b - a);
  }
  return stops[stops.length - 1][1];
}

const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

function paintField(c: UltraBlurColors): void {
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

/** Paint the colour field and faded artwork into one canvas per item.
 * WebKit rasterizes scaled layers at screen size, so each extra layer adds
 * a full-screen paint. CSS masks in opacity transitions also retain
 * full-screen GPU surfaces on WPE/Mali. */
function paintScene(canvas: HTMLCanvasElement, colors: UltraBlurColors, img: HTMLImageElement | undefined, lum: number): void {
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
    [fctx.createLinearGradient(0, 0, W, 0), FADE_X],
    [fctx.createLinearGradient(0, H, 0, 0), FADE_Y],
  ] as const) {
    for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
    fctx.fillStyle = gradient;
    fctx.fillRect(0, 0, W, H);
  }
  ctx.drawImage(faded, 0, 0);
  darken(ctx, lum);
}

/** 90th-percentile linear luminance of the text zone as paintScene draws
 * it: the faded artwork over the dimmed colour field. */
async function measure(art: string, colors: UltraBlurColors): Promise<number> {
  const small = await decoded(imageUrl(currentServer(), art, PW, PH), true).catch(() => undefined);
  if (!small) return UNMEASURED;
  probeContext.drawImage(small, 0, 0, PW, PH);
  let d: Uint8ClampedArray;
  try {
    d = probeContext.getImageData(0, 0, PW, PH).data;
  } catch {
    return UNMEASURED;
  }
  const [tl, tr, br, bl] = [colors.topLeft, colors.topRight, colors.bottomRight, colors.bottomLeft].map(rgb);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const values: number[] = [];
  for (let y = 0; y < Math.ceil((PH * ZONE.h) / H); y++) {
    for (let x = 0; x < Math.ceil((PW * ZONE.w) / W); x++) {
      const u = (x + 0.5) / PW;
      const v = (y + 0.5) / PH;
      const alpha = fade(FADE_X, u) * fade(FADE_Y, 1 - v);
      const o = (y * PW + x) * 4;
      const c = [0, 1, 2].map((k) => {
        const field = ((tl[k] * (1 - u) + tr[k] * u) * (1 - v) + (bl[k] * (1 - u) + br[k] * u) * v) * DIM;
        return field * (1 - alpha) + d[o + k] * alpha;
      });
      values.push(0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]));
    }
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.9)];
}

/** Darken the text side until its bright parts are at the ceiling. Black
 * at alpha a scales sRGB values by 1 − a, so linear luminance by about
 * (1 − a)^2.2. */
function darken(ctx: CanvasRenderingContext2D, lum: number): void {
  if (lum <= CEILING) return;
  const a = Math.min(0.88, 1 - (CEILING / lum) ** (1 / 2.2));
  const g = ctx.createLinearGradient(0, 0, 1560, 0);
  g.addColorStop(0, `rgba(0, 0, 0, ${a})`);
  g.addColorStop(ZONE.w / 1560, `rgba(0, 0, 0, ${a})`);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Decode artwork off-screen. With CORS the painter can measure it; Plex
 * allows any origin, but a browser can still refuse a private address. */
function decoded(src: string, cors: boolean): Promise<HTMLImageElement> {
  const img = new Image();
  if (cors) img.crossOrigin = 'anonymous';
  img.src = src;
  return img.decode().then(() => img);
}

/** Blend artwork into the item's colour field at the top and right.
 * Wait for focus to settle before fetching artwork, decode it off-screen,
 * then cross-fade scenes with compositor-only opacity transitions. */
export function Backdrop(props: { art?: string; colors?: UltraBlurColors; delay?: number }) {
  const scenes: { root: HTMLDivElement; canvas: HTMLCanvasElement }[] = [];
  let shown = -1;
  let showing = '';
  // Retain the current scene inputs for repainting after visibility changes.
  let painted: [UltraBlurColors, HTMLImageElement | undefined, number] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = async (art: string | undefined, colors: UltraBlurColors | undefined) => {
    const key = `${art ?? ''}|${JSON.stringify(colors ?? null)}`;
    if (key === showing) return;
    let img: HTMLImageElement | undefined;
    let lum = 0;
    if (art) {
      const measured = measure(art, colors ?? FALLBACK);
      img = await decoded(backdropUrl(art), true).catch(() => decoded(backdropUrl(art), false)).catch(() => undefined);
      lum = await measured;
      if (props.art !== art) return;
    }
    const next = shown === 0 ? 1 : 0;
    const scene = scenes[next];
    painted = [colors ?? FALLBACK, img, lum];
    paintScene(scene.canvas, ...painted);
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
        // Show the initial colour field immediately while artwork is unavailable.
        if (shown < 0 && !art) {
          void show(undefined, colors);
          return;
        }
        timer = setTimeout(() => void show(art, colors), shown < 0 ? 0 : (props.delay ?? 300));
      },
    ),
  );
  // WebKit discards canvas contents while hidden; repaint on visibility restoration.
  const onVisibility = () => {
    if (!document.hidden && painted) paintScene(scenes[shown].canvas, ...painted);
  };
  document.addEventListener('visibilitychange', onVisibility);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });

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
