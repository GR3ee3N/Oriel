#!/usr/bin/env python3
"""Generate Oriel's artwork from one mark definition using standard Python.

Write the icon, fanart and startup mark to addon/resources/, and the page's
mark to web/src/ui/mark.svg. The splash draws the SVG at the startup mark's
position. Background colours match web/src/ui/theme.css.

Run after changing the mark and commit the generated files:

    tools/make-art.py
"""
import math
import os
import struct
import zlib

BG = (11, 13, 18)
RAISE = (34, 40, 57)
# Brand colour stays fixed when the user changes the interface accent.
BRAND = (140, 158, 255)
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "addon", "resources")
SVG = os.path.join(ROOT, "web", "src", "ui", "mark.svg")


def png(path, w, h, pixel, alpha=False):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows.extend(pixel(x, y))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    kind = 6 if alpha else 2
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, kind, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def coverage(inside, x, y, n=4):
    """Estimate pixel coverage from an n×n grid of samples for antialiasing."""
    hit = sum(inside(x + (i + 0.5) / n, y + (j + 0.5) / n) for i in range(n) for j in range(n))
    return hit / (n * n)


# Window frame, crossbars and sill, measured in units of the mark's radius.
FRAME_W, FRAME_TOP, FRAME_BOTTOM, STROKE = 0.6, -0.25, 0.7, 0.15
BAR = 0.05
TRANSOM = 0.1
SILL_W, SILL_BOTTOM = 0.75, 0.85


def arch(u, v, w, bottom):
    """Test an arched window with half-width w and a flat bottom."""
    if v > bottom or abs(u) > w:
        return False
    return v >= FRAME_TOP or math.hypot(u, v - FRAME_TOP) <= w


def mark(cx, cy, r):
    """Return a point test for the mark centred at (cx, cy) with radius r."""
    inner_w, inner_bottom = FRAME_W - STROKE, FRAME_BOTTOM - STROKE

    def inside(x, y):
        u, v = (x - cx) / r, (y - cy) / r
        if FRAME_BOTTOM <= v <= SILL_BOTTOM and abs(u) <= SILL_W:
            return True
        if not arch(u, v, FRAME_W, FRAME_BOTTOM):
            return False
        if not arch(u, v, inner_w, inner_bottom):
            return True  # Window frame.
        return abs(u) <= BAR or abs(v - TRANSOM) <= BAR  # Window crossbars.

    return inside


def icon():
    size = 512
    inside = mark(size / 2, size / 2, size * 0.34)

    def pixel(x, y):
        bg = mix(RAISE, BG, y / size)
        # The sill fits within 1.13 radii; skip antialiasing outside the mark.
        if math.hypot(x - size / 2, y - size / 2) > size * 0.34 * 1.2:
            return bg
        return mix(bg, BRAND, coverage(inside, x, y))

    png(os.path.join(OUT, "icon.png"), size, size, pixel)


def fanart():
    w, h = 1920, 1080
    inside = mark(w * 0.72, h * 0.5, h * 0.30)

    def pixel(x, y):
        # Keep the background and mark dim so Kodi's text remains readable.
        d = math.hypot((x - w * 0.72) / w, (y - h * 0.5) / h)
        bg = mix(RAISE, BG, min(1.0, d * 1.6))
        if math.hypot(x - w * 0.72, y - h * 0.5) > h * 0.30 * 1.2:
            return bg
        return mix(bg, mix(BG, BRAND, 0.35), coverage(inside, x, y, 2))

    png(os.path.join(OUT, "fanart.png"), w, h, pixel)


def start_mark():
    """Draw a transparent 168 px mark matching the page's splash screen."""
    size = 168
    inside = mark(size / 2, size / 2, size / 2)

    def pixel(x, y):
        return (*BRAND, round(255 * coverage(inside, x, y)))

    png(os.path.join(OUT, "mark.png"), size, size, pixel, alpha=True)


def svg_mark():
    """Draw mark()'s shapes as SVG in a centred 2×2 viewBox."""
    inner_w, inner_bottom = FRAME_W - STROKE, FRAME_BOTTOM - STROKE
    inner_top = FRAME_TOP - inner_w

    def arch(w, bottom):
        return f"M{-w:g} {bottom:g}V{FRAME_TOP:g}A{w:g} {w:g} 0 0 1 {w:g} {FRAME_TOP:g}V{bottom:g}Z"

    def rect(x, y, w, h):
        return f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}"/>'

    shapes = [
        # Cut the inner arch out of the outer arch to form the frame.
        f'<path fill-rule="evenodd" d="{arch(FRAME_W, FRAME_BOTTOM)} {arch(inner_w, inner_bottom)}"/>',
        rect(-BAR, inner_top, 2 * BAR, inner_bottom - inner_top),
        rect(-inner_w, TRANSOM - BAR, 2 * inner_w, 2 * BAR),
        rect(-SILL_W, FRAME_BOTTOM, 2 * SILL_W, SILL_BOTTOM - FRAME_BOTTOM),
    ]
    with open(SVG, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2" fill="#{bytes(BRAND).hex()}">\n')
        f.write("".join(f"  {s}\n" for s in shapes))
        f.write("</svg>\n")


if __name__ == "__main__":
    icon()
    fanart()
    start_mark()
    svg_mark()
