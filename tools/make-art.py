#!/usr/bin/env python3
"""Generate each app's artwork from its mark definition using standard Python.

Write each app's icon, fanart and startup mark to apps/<app>/resources/, and
the page's mark to web/src/ui/mark-<app>.svg. The splash draws the SVG at the
startup mark's position. Background colours match web/src/ui/theme.css.
Oriel's mark is an arched window, Dormer's a gabled one under a roof.

Run after changing a mark and commit the generated files:

    tools/make-art.py
"""
import math
import os
import struct
import zlib

BG = (11, 13, 18)
RAISE = (34, 40, 57)
ROOT = os.path.join(os.path.dirname(__file__), "..")


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


# Measurements in units of the mark's radius. Both windows share the
# crossbars and sill.
STROKE = 0.15
BAR = 0.05
TRANSOM = 0.1
SILL_W, SILL_BOTTOM = 0.75, 0.85
FRAME_BOTTOM = 0.7

# Oriel: an arched window.
FRAME_W, FRAME_TOP = 0.6, -0.25

# Dormer: a gabled window with walls to EAVE and a peak at APEX, under a
# roof that overhangs it by OVERHANG.
GABLE_W, EAVE, APEX = 0.55, -0.05, -0.62
ROOF_T, OVERHANG = 0.13, 0.17
SLOPE = (EAVE - APEX) / GABLE_W


def arch(u, v, w, bottom):
    """Test an arched window with half-width w and a flat bottom."""
    if v > bottom or abs(u) > w:
        return False
    return v >= FRAME_TOP or math.hypot(u, v - FRAME_TOP) <= w


def gable(u, v, w, apex, bottom):
    """Test a gabled window with half-width w, its peak at apex."""
    return abs(u) <= w and v <= bottom and v >= apex + SLOPE * abs(u)


def bars(u, v, inner_w):
    return abs(u) <= BAR or (abs(v - TRANSOM) <= BAR and abs(u) <= inner_w)


def oriel_mark(u, v):
    if FRAME_BOTTOM <= v <= SILL_BOTTOM and abs(u) <= SILL_W:
        return True
    if not arch(u, v, FRAME_W, FRAME_BOTTOM):
        return False
    inner_w = FRAME_W - STROKE
    return not arch(u, v, inner_w, FRAME_BOTTOM - STROKE) or bars(u, v, inner_w)


# A line parallel to a roof edge STROKE further in sits this much lower.
DROP = STROKE * math.hypot(1, SLOPE)
# The roof's lower edge clears the window's peak by a gap one bar wide.
ROOF_APEX = APEX - 2 * BAR * math.hypot(1, SLOPE) - ROOF_T * math.hypot(1, SLOPE)


def dormer_mark(u, v):
    if FRAME_BOTTOM <= v <= SILL_BOTTOM and abs(u) <= SILL_W:
        return True
    roof = ROOF_APEX + SLOPE * abs(u)
    if abs(u) <= GABLE_W + OVERHANG and roof <= v <= roof + ROOF_T * math.hypot(1, SLOPE):
        return True
    if not gable(u, v, GABLE_W, APEX, FRAME_BOTTOM):
        return False
    inner_w = GABLE_W - STROKE
    inner = gable(u, v, inner_w, APEX + DROP, FRAME_BOTTOM - STROKE)
    return not inner or (bars(u, v, inner_w) and v >= APEX + DROP)


def oriel_shapes():
    inner_w, inner_bottom = FRAME_W - STROKE, FRAME_BOTTOM - STROKE
    inner_top = FRAME_TOP - inner_w

    def arch_path(w, bottom):
        return f"M{-w:g} {bottom:g}V{FRAME_TOP:g}A{w:g} {w:g} 0 0 1 {w:g} {FRAME_TOP:g}V{bottom:g}Z"

    return [
        # Cut the inner arch out of the outer arch to form the frame.
        f'<path fill-rule="evenodd" d="{arch_path(FRAME_W, FRAME_BOTTOM)} {arch_path(inner_w, inner_bottom)}"/>',
        rect(-BAR, inner_top, 2 * BAR, inner_bottom - inner_top),
        rect(-inner_w, TRANSOM - BAR, 2 * inner_w, 2 * BAR),
        sill(),
    ]


def dormer_shapes():
    inner_w, inner_bottom, inner_apex = GABLE_W - STROKE, FRAME_BOTTOM - STROKE, APEX + DROP

    def gable_path(w, apex, bottom):
        eave = apex + SLOPE * w
        return f"M{-w:.4g} {bottom:.4g}V{eave:.4g}L0 {apex:.4g}L{w:.4g} {eave:.4g}V{bottom:.4g}Z"

    reach = GABLE_W + OVERHANG
    thick = ROOF_T * math.hypot(1, SLOPE)
    end = ROOF_APEX + SLOPE * reach
    roof = (f"M0 {ROOF_APEX:.4g}L{reach:.4g} {end:.4g}V{end + thick:.4g}L0 {ROOF_APEX + thick:.4g}"
            f"L{-reach:.4g} {end + thick:.4g}V{end:.4g}Z")
    return [
        f'<path fill-rule="evenodd" d="{gable_path(GABLE_W, APEX, FRAME_BOTTOM)} {gable_path(inner_w, inner_apex, inner_bottom)}"/>',
        f'<path d="{roof}"/>',
        rect(-BAR, inner_apex, 2 * BAR, inner_bottom - inner_apex),
        rect(-inner_w, TRANSOM - BAR, 2 * inner_w, 2 * BAR),
        sill(),
    ]


def rect(x, y, w, h):
    return f'<rect x="{x:.4g}" y="{y:.4g}" width="{w:.4g}" height="{h:.4g}"/>'


def sill():
    return rect(-SILL_W, FRAME_BOTTOM, 2 * SILL_W, SILL_BOTTOM - FRAME_BOTTOM)


# Each app's mark and brand colour. The brand colour stays fixed when the
# user changes the interface accent.
APPS = {
    "oriel": (oriel_mark, oriel_shapes, (140, 158, 255)),
    "dormer": (dormer_mark, dormer_shapes, (108, 212, 196)),
}


def placed(shape, cx, cy, r):
    """Return a point test for a mark centred at (cx, cy) with radius r."""
    return lambda x, y: shape((x - cx) / r, (y - cy) / r)


def icon(out, shape, brand):
    size = 512
    inside = placed(shape, size / 2, size / 2, size * 0.34)

    def pixel(x, y):
        bg = mix(RAISE, BG, y / size)
        # The mark fits within 1.13 radii; skip antialiasing outside it.
        if math.hypot(x - size / 2, y - size / 2) > size * 0.34 * 1.2:
            return bg
        return mix(bg, brand, coverage(inside, x, y))

    png(os.path.join(out, "icon.png"), size, size, pixel)


def fanart(out, shape, brand):
    w, h = 1920, 1080
    inside = placed(shape, w * 0.72, h * 0.5, h * 0.30)

    def pixel(x, y):
        # Keep the background and mark dim so Kodi's text remains readable.
        d = math.hypot((x - w * 0.72) / w, (y - h * 0.5) / h)
        bg = mix(RAISE, BG, min(1.0, d * 1.6))
        if math.hypot(x - w * 0.72, y - h * 0.5) > h * 0.30 * 1.2:
            return bg
        return mix(bg, mix(BG, brand, 0.35), coverage(inside, x, y, 2))

    png(os.path.join(out, "fanart.png"), w, h, pixel)


def start_mark(out, shape, brand):
    """Draw a transparent 168 px mark matching the page's splash screen."""
    size = 168
    inside = placed(shape, size / 2, size / 2, size / 2)

    def pixel(x, y):
        return (*brand, round(255 * coverage(inside, x, y)))

    png(os.path.join(out, "mark.png"), size, size, pixel, alpha=True)


def svg_mark(path, shapes, brand):
    """Draw the mark's shapes as SVG in a centred 2×2 viewBox."""
    with open(path, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2" fill="#{bytes(brand).hex()}">\n')
        f.write("".join(f"  {s}\n" for s in shapes()))
        f.write("</svg>\n")


if __name__ == "__main__":
    for app, (shape, shapes, brand) in APPS.items():
        out = os.path.join(ROOT, "apps", app, "resources")
        icon(out, shape, brand)
        fanart(out, shape, brand)
        start_mark(out, shape, brand)
        svg_mark(os.path.join(ROOT, "web", "src", "ui", f"mark-{app}.svg"), shapes, brand)
