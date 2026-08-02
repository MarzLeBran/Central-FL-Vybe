"""Generate web-ready brand assets from the originals in brand/.

Run from the repo root:  python3 scripts/prep-brand-assets.py

Reads the four source PNGs in brand/ and writes optimised files into public/.
The originals are multi-megabyte exports; this takes ~21 MB down to under 1 MB
without a visible quality loss at the sizes the site actually renders them.

Two things it handles that a plain resize would not:
  1. The exports have opaque white backgrounds. We flood-fill transparency from
     the outer edges only, so white *inside* the mark (the gaps between the
     buildings) survives.
  2. The exports carry a faint grey watermark in the bottom-right corner. We
     crop to saturated content, so that watermark neither pads the assets with
     empty space nor lands in the favicon.
"""
from PIL import Image, ImageDraw, ImageChops
import os, colorsys

SRC = "brand"
OUT = "public"
os.makedirs(OUT, exist_ok=True)

PAPER = (250, 250, 247)
KEY = (255, 0, 255)  # flood-fill marker; no magenta exists in the brand palette


def cut_outer_white(im, thresh=28):
    """Make the OUTSIDE background transparent, preserving interior whites."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, corner, KEY, thresh=thresh)
    r, g, b = rgb.split()
    # alpha = 0 exactly where we painted the key colour
    keyed = ImageChops.multiply(
        ImageChops.multiply(r.point(lambda v: 255 if v > 250 else 0),
                            g.point(lambda v: 255 if v < 5 else 0)),
        b.point(lambda v: 255 if v > 250 else 0),
    )
    alpha = keyed.point(lambda v: 0 if v > 128 else 255)
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def saturated_bbox(im, sat_min=0.25):
    """Bounding box of genuinely colourful pixels — ignores faint grey watermarks."""
    rgb = im.convert("RGB")
    small = rgb.resize((rgb.width // 4, rgb.height // 4))
    px = small.load()
    xs, ys = [], []
    for y in range(small.height):
        for x in range(small.width):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx and (mx - mn) / mx >= sat_min:
                xs.append(x); ys.append(y)
    if not xs:
        return None
    return (min(xs) * 4, min(ys) * 4, (max(xs) + 1) * 4, (max(ys) + 1) * 4)


def trim_alpha(im, pad=0):
    bb = im.getchannel("A").getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def resize_w(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def report(name):
    p = os.path.join(OUT, name)
    print(f"  {name:26} {os.path.getsize(p)/1024:8.1f} KB  {Image.open(p).size}")


# Crop to SATURATED content, not the alpha bbox — the originals carry a faint
# grey watermark in the bottom-right corner that would otherwise pad every asset
# with a band of empty space.

# ── 1. Logo lockup ───────────────────────────────────────────────────────────
_src = Image.open(f"{SRC}/CFL VYBE LOGO.png")
logo = cut_outer_white(_src).crop(saturated_bbox(_src))
resize_w(logo, 720).save(f"{OUT}/logo.png", optimize=True)
report("logo.png")

# ── 2. Logo with tagline ─────────────────────────────────────────────────────
_src = Image.open(f"{SRC}/Where in Central Florida does business?.png")
tag = cut_outer_white(_src).crop(saturated_bbox(_src))
resize_w(tag, 900).save(f"{OUT}/logo-tagline.png", optimize=True)
report("logo-tagline.png")

# ── 3. Icon mark, squared ────────────────────────────────────────────────────
fav_src = Image.open(f"{SRC}/CFL Vibe Fabicon.png")
bb = saturated_bbox(fav_src)
mark = cut_outer_white(fav_src).crop(bb)
side = max(mark.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)
pad = round(side * 0.10)
padded = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
padded.paste(canvas, (pad, pad), canvas)

for name, size in [("icon.png", 512), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
    img = padded.resize((size, size), Image.LANCZOS)
    if name == "apple-touch-icon.png":  # iOS ignores transparency, give it paper
        flat = Image.new("RGBA", img.size, PAPER + (255,))
        flat.paste(img, (0, 0), img)
        img = flat
    img.save(f"{OUT}/{name}", optimize=True)
    report(name)

# ── 4. Hero, two widths, webp ────────────────────────────────────────────────
hero = Image.open(f"{SRC}/CFL VYBE HERO BANNER.png").convert("RGB")
for w in (2000, 1200):
    resize_w(hero, w).save(f"{OUT}/hero-{w}.webp", quality=80, method=6)
    report(f"hero-{w}.webp")

# ── 5. Social card, 1200x630 ─────────────────────────────────────────────────
og = Image.new("RGB", (1200, 630), PAPER)
mark_og = resize_w(tag, 940)
og.paste(mark_og, ((1200 - mark_og.width) // 2, (630 - mark_og.height) // 2), mark_og)
og.save(f"{OUT}/og-image.jpg", quality=88, optimize=True)
report("og-image.jpg")

print(f"\ntotal: {sum(os.path.getsize(os.path.join(OUT,f)) for f in os.listdir(OUT))/1024:.0f} KB")
