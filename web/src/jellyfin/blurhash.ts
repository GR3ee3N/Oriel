// An image's four corner colours from its BlurHash (https://blurha.sh), for
// the backdrop's gradient. A BlurHash is a grid of cosine components; at a
// corner each one's basis is 1 or -1, so a corner's colour is their signed sum.

import type { Corners } from '../media/model';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

const base83 = (s: string) => [...s].reduce((v, c) => v * 83 + DIGITS.indexOf(c), 0);
const linear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const srgb = (v: number) => {
  const x = Math.min(1, Math.max(0, v));
  return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
};
const signedSquare = (v: number) => Math.sign(v) * v * v;

export function corners(hash: string | undefined): Corners | undefined {
  if (!hash || hash.length < 6) return undefined;
  const size = base83(hash[0]);
  const nx = (size % 9) + 1;
  const ny = Math.floor(size / 9) + 1;
  if (hash.length !== 4 + 2 * nx * ny) return undefined;
  const maxAc = (base83(hash[1]) + 1) / 166;
  const dc = base83(hash.slice(2, 6));
  const components = [[linear(dc >> 16), linear((dc >> 8) & 255), linear(dc & 255)]];
  for (let i = 1; i < nx * ny; i++) {
    const v = base83(hash.slice(4 + i * 2, 6 + i * 2));
    components.push([Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19].map((q) => signedSquare((q - 9) / 9) * maxAc));
  }
  const at = (right: boolean, bottom: boolean) => {
    const rgb = [0, 0, 0];
    components.forEach((c, n) => {
      const i = n % nx;
      const j = Math.floor(n / nx);
      const basis = (right && i % 2 ? -1 : 1) * (bottom && j % 2 ? -1 : 1);
      for (let k = 0; k < 3; k++) rgb[k] += c[k] * basis;
    });
    return rgb.map((v) => srgb(v).toString(16).padStart(2, '0')).join('');
  };
  return { topLeft: at(false, false), topRight: at(true, false), bottomRight: at(true, true), bottomLeft: at(false, true) };
}
