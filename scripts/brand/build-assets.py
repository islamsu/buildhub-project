#!/usr/bin/env python3
"""Derive every served RAKIZA brand asset from the owner-supplied master.

The owner supplied ONE file - brand-source/rakiza-master.png, a 2143x734 RGBA
lockup (hexagonal R mark, ركيزة, RAKIZA, BUILD TOGETHER). Everything the site
serves is derived from it HERE, by crop / scale / recolour / composite, so that:

  - no mark is traced, redrawn or approximated by hand (owner directive 7), and
  - the derivation is reproducible and reviewable rather than a binary that
    appeared in a commit with no provenance.

Run: python3 scripts/brand/build-assets.py

A vector master is still wanted for print and for very small sizes; see
client/public/brand/README.md. Raster is sufficient for every size the site
actually serves, which is why this does not block engineering.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import png

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'brand-source', 'rakiza-master.png')
OUT = os.path.join(ROOT, 'client', 'public', 'brand')

# Approved RAKIZA palette (owner directive 2). Only the two used for compositing.
NAVY = (0x0F, 0x2D, 0x5B, 255)
AMBER = (0xF5, 0x9E, 0x0B, 255)

# Measured on the master, not guessed: the mark and the wordmark are separated
# by a 93px column of full transparency at x 722..814.
MARK_BOX = (138, 72, 584, 583)      # x, y, w, h  - very nearly square already
FULL_BOX = (138, 72, 1907, 598)


def is_amber(r, g, b):
    """The swoosh against the hexagon. Orange is the only warm hue present."""
    return r > 150 and r > g + 40 and g > b + 30


def to_inverse(w, h, px):
    """Navy -> white for use on dark surfaces; the amber swoosh is left alone.

    The hexagon is faceted, so flattening every navy pixel to pure white would
    throw away the dimension that makes the mark read as a solid. Facet
    brightness is preserved by mapping the navy value range onto 205..255.
    """
    vals = [max(px[i], px[i+1], px[i+2])
            for i in range(0, len(px), 4)
            if px[i+3] > 200 and not is_amber(px[i], px[i+1], px[i+2])]
    lo, hi = (min(vals), max(vals)) if vals else (0, 1)
    span = max(1, hi - lo)
    out = bytearray(px)
    for i in range(0, len(out), 4):
        if out[i+3] == 0:
            continue
        r, g, b = out[i], out[i+1], out[i+2]
        if is_amber(r, g, b):
            continue
        v = 205 + (max(r, g, b) - lo) * 50 // span
        v = max(0, min(255, v))
        out[i] = out[i+1] = out[i+2] = v
    return w, h, out


def rounded_tile(size, radius, rgba):
    """A plain rounded square. A container shape, not brand artwork."""
    px = bytearray(size * size * 4)
    r2 = radius * radius
    for y in range(size):
        for x in range(size):
            dx = dy = 0
            if x < radius:          dx = radius - x
            elif x >= size - radius: dx = x - (size - radius - 1)
            if y < radius:          dy = radius - y
            elif y >= size - radius: dy = y - (size - radius - 1)
            inside = (dx * dx + dy * dy) <= r2 if (dx and dy) else True
            o = (y * size + x) * 4
            if inside:
                px[o:o+4] = bytes(rgba)
    return px


def square(w, h, px, pad_ratio=0.0):
    """Centre a bitmap on a transparent square canvas."""
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = bytearray(side * side * 4)
    return png.composite(side, side, canvas, w, h, px,
                         (side - w) // 2, (side - h) // 2), side


def main():
    os.makedirs(OUT, exist_ok=True)
    w, h, px = png.read(SRC)
    print('master %dx%d' % (w, h))

    # 1. Horizontal lockup. 880px wide covers the largest place it is drawn
    #    (the auth panel, ~340 CSS px) at 2x device pixel ratio.
    fx, fy, fw, fh = FULL_BOX
    lw, lh, lpx = png.crop(w, h, px, fx, fy, fw, fh)
    lw, lh, lpx = png.resize(lw, lh, lpx, 880, round(880 * fh / fw))
    png.write(os.path.join(OUT, 'rakiza-lockup.png'), lw, lh, lpx)
    print('rakiza-lockup.png %dx%d' % (lw, lh))

    iw, ih, ipx = to_inverse(lw, lh, lpx)
    png.write(os.path.join(OUT, 'rakiza-lockup-inverse.png'), iw, ih, ipx)
    print('rakiza-lockup-inverse.png %dx%d' % (iw, ih))

    # 2. The mark alone, square, for compact and square contexts.
    mx, my, mwid, mhei = MARK_BOX
    mw, mh, mpx = png.crop(w, h, px, mx, my, mwid, mhei)
    (mpx_sq, side) = square(mw, mh, mpx)
    sw, sh, spx = png.resize(side, side, mpx_sq, 256, 256)
    png.write(os.path.join(OUT, 'rakiza-mark.png'), sw, sh, spx)
    print('rakiza-mark.png 256x256')

    mi_w, mi_h, mi_px = to_inverse(sw, sh, spx)
    png.write(os.path.join(OUT, 'rakiza-mark-inverse.png'), mi_w, mi_h, mi_px)
    print('rakiza-mark-inverse.png 256x256')

    # 3. Favicons. A navy tile carrying the inverse mark, because a navy mark on
    #    transparency disappears into dark browser chrome - the exact failure the
    #    favicon exists to prevent. The brand sheet shows this tile treatment.
    for name, size in (('favicon-32.png', 32), ('favicon-64.png', 64),
                       ('apple-touch-icon.png', 180)):
        tile = rounded_tile(size, max(2, size // 6), NAVY)
        inner = int(size * 0.64)
        gw, gh, gpx = png.resize(mi_w, mi_h, mi_px, inner, inner)
        tile = png.composite(size, size, tile, gw, gh, gpx,
                             (size - inner) // 2, (size - inner) // 2)
        png.write(os.path.join(OUT, name), size, size, tile)
        print('%s %dx%d' % (name, size, size))

    # 4. Social card. 1200x630 PNG, because several Slack and WhatsApp versions
    #    do not render an SVG og:image - a standing note in client/index.html.
    ow, oh = 1200, 630
    card = png.solid(ow, oh, NAVY)
    target = 620
    cw, ch, cpx = png.resize(iw, ih, ipx, target, round(target * ih / iw))
    card = png.composite(ow, oh, card, cw, ch, cpx, (ow - cw) // 2, 195)
    rule_w, rule_h = 96, 6
    card = png.composite(ow, oh, card, rule_w, rule_h,
                         png.solid(rule_w, rule_h, AMBER),
                         (ow - rule_w) // 2, 195 + ch + 40)
    png.write(os.path.join(OUT, 'rakiza-og.png'), ow, oh, card)
    print('rakiza-og.png %dx%d' % (ow, oh))


if __name__ == '__main__':
    main()
