#!/usr/bin/env python3
"""Wraps raw 412x915 (any DPR) captures in a clean modern phone frame (not shipped).

usage:
  compose.py shot  <in.png> <out.png>             transparent background + soft shadow (screenshots)
  compose.py frame <in.png> <out.png> [bg]        solid backdrop, for GIF frames (GIF has no alpha)
The status bar and punch-hole camera are drawn by capture.js inside the page, so they scale with the UI.
"""
import sys
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter

BG_GIF = (14, 17, 24)


@lru_cache(maxsize=8)
def _layers(sw, sh, solid):
    k = sw / 412.0                       # 1.0 at DPR 1, 2.0 at DPR 2
    bez = round(11 * k)                  # black bezel
    rim = max(2, round(2.2 * k))         # metal rim
    pad = round(34 * k)                  # room for shadow and side buttons
    r_screen = round(38 * k)
    fw, fh = sw + 2 * (bez + rim), sh + 2 * (bez + rim)
    W, H = fw + 2 * pad, fh + 2 * pad
    ox, oy = pad, pad
    base = Image.new('RGBA', (W, H), BG_GIF + (255,) if solid else (0, 0, 0, 0))
    # shadow
    sh_l = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh_l)
    d.rounded_rectangle((ox, oy + round(10 * k), ox + fw, oy + fh + round(6 * k)), radius=r_screen + bez + rim, fill=(0, 0, 0, 120 if solid else 95))
    sh_l = sh_l.filter(ImageFilter.GaussianBlur(round(14 * k)))
    base.alpha_composite(sh_l)
    d = ImageDraw.Draw(base)
    # side buttons (right: power + volume rocker)
    bx = ox + fw - round(1 * k)
    d.rounded_rectangle((bx, oy + round(170 * k), bx + round(3.2 * k), oy + round(232 * k)), radius=round(1.5 * k), fill=(58, 62, 72, 255))
    d.rounded_rectangle((bx, oy + round(262 * k), bx + round(3.2 * k), oy + round(370 * k)), radius=round(1.5 * k), fill=(58, 62, 72, 255))
    # rim (subtle metallic gradient) and bezel
    rim_l = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
    grad = Image.linear_gradient('L').resize((fw, fh)).rotate(90, expand=False)
    top, bot = (92, 98, 110), (44, 48, 56)
    col = Image.merge('RGB', [grad.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(top, bot)])
    m = Image.new('L', (fw, fh), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, fw - 1, fh - 1), radius=r_screen + bez + rim, fill=255)
    rim_l.paste(col, (0, 0), m)
    ImageDraw.Draw(rim_l).rounded_rectangle((rim, rim, fw - 1 - rim, fh - 1 - rim), radius=r_screen + bez, fill=(6, 7, 9, 255))
    base.alpha_composite(rim_l, (ox, oy))
    # screen mask
    smask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(smask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=r_screen, fill=255)
    return base, smask, (ox + rim + bez, oy + rim + bez)


def compose(src, solid=False):
    im = src.convert('RGBA')
    base, smask, pos = _layers(im.width, im.height, solid)
    out = base.copy()
    out.paste(im, pos, smask)
    return out


if __name__ == '__main__':
    mode, a, b = sys.argv[1:4]
    img = compose(Image.open(a), solid=(mode == 'frame'))
    if mode == 'frame':
        img = img.convert('RGB')
    img.save(b, optimize=True)
