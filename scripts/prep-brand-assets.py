"""Generate web-ready brand assets from the originals in brand/.

Run from the repo root:  python3 scripts/prep-brand-assets.py

Reads the four source PNGs in brand/ and writes optimised files into public/.
The originals are multi-megabyte exports; this takes ~21 MB down to under 1 MB
without a visible quality loss at the sizes the site actually renders them.

Requires Pillow and numpy (`pip install pillow numpy`) and the `potrace` CLI
(`brew install potrace`) for the vector logo step below.

Three things it handles that a plain resize would not:
  1. The exports have opaque white backgrounds, and it isn't just the outer
     edge — there's white trapped *inside* the mark too (the gaps between
     buildings, the counters in "B"/"e"/"a"). cut_all_white() keys out every
     near-white pixel globally rather than flood-filling from the corners, so
     none of it survives as a stray opaque speck (visible as "white spots"
     once the site got a dark theme and the mark sat on a dark surface).
  2. The exports carry a faint grey watermark in the bottom-right corner. We
     crop to saturated content, so that watermark neither pads the assets with
     empty space nor lands in the favicon.
  3. The two logo lockups (plain mark + mark-with-tagline) are flat, saturated
     colour blocking — four solid hues, no gradients or photographic content —
     which makes them good candidates for actual vector tracing rather than
     ever-so-slightly-fuzzy raster. vectorize() classifies every pixel to its
     nearest brand hue (or background) and traces each hue separately with
     potrace, so the shipped logo.svg/logo-tagline.svg are true scalable
     paths with a fully transparent background, not just a bigger PNG.
"""
from PIL import Image, ImageChops
import os, re, subprocess, tempfile, colorsys
from collections import Counter

try:
    import numpy as np
except ImportError:
    raise SystemExit("prep-brand-assets.py needs numpy: pip install numpy")

SRC = "brand"
OUT = "public"
os.makedirs(OUT, exist_ok=True)

PAPER = (250, 250, 247)


def cut_all_white(im, thresh=28):
    """Make every near-white pixel transparent, wherever it sits in the image
    — not just the pixels connected to an outer edge. A corner-flood-fill
    approach leaves background trapped inside closed shapes (a letter's
    counter, a gap between buildings) as opaque white; since none of these
    marks have any *intentional* white content (confirmed by eye — the design
    is flat saturated colour blocking with no white elements), it's safe to
    key out every near-white pixel regardless of position."""
    rgb = im.convert("RGB")
    r, g, b = rgb.split()
    near_white = ImageChops.multiply(
        ImageChops.multiply(r.point(lambda v: 255 if v > 255 - thresh else 0),
                            g.point(lambda v: 255 if v > 255 - thresh else 0)),
        b.point(lambda v: 255 if v > 255 - thresh else 0),
    )
    alpha = near_white.point(lambda v: 0 if v > 128 else 255)
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


def resize_w(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def report(name):
    p = os.path.join(OUT, name)
    print(f"  {name:26} {os.path.getsize(p)/1024:8.1f} KB  {Image.open(p).size}")


# ── Vector logo pipeline ───────────────────────────────────────────────────

def detect_ink_colors(im_rgb, sat_min=0.25):
    """The four lockups are hand-drawn once and re-exported, so the exact hue
    drifts a little file to file (JPEG-ish compression, re-export settings).
    Rather than hardcode one set of hex values, bucket every saturated pixel
    by hue into the four brand colours and take each bucket's most common
    exact colour — self-calibrating per source file."""
    small = im_rgb.resize((im_rgb.width // 2, im_rgb.height // 2))
    buckets = {"coral": Counter(), "amber": Counter(), "teal": Counter(), "navy": Counter()}
    for r, g, b in small.getdata():
        mx, mn = max(r, g, b), min(r, g, b)
        if mx == 0 or (mx - mn) / mx < sat_min:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        deg = h * 360
        if deg < 25:
            buckets["coral"][(r, g, b)] += 1
        elif deg < 70:
            buckets["amber"][(r, g, b)] += 1
        elif deg < 195 and v > 0.5:
            buckets["teal"][(r, g, b)] += 1
        elif deg < 220:
            buckets["navy"][(r, g, b)] += 1
    return {name: counter.most_common(1)[0][0] for name, counter in buckets.items() if counter}


def vectorize(src_path):
    """Trace a flat-colour brand lockup into one clean multi-colour SVG.

    Classifies every pixel to whichever of the four ink colours (or plain
    background) it's nearest to, potraces each colour's bitmap on its own,
    and recombines the resulting paths under a single fill each. Because the
    background classification is global (not edge-connected like a flood
    fill), nothing sits behind the mark — no corner case where an enclosed
    patch of "background" survives as an opaque speck.
    """
    im = Image.open(src_path).convert("RGB")
    colors = detect_ink_colors(im)
    names = list(colors.keys())
    arr = np.asarray(im).astype(np.int32)
    H, W, _ = arr.shape
    refs = np.array([colors[n] for n in names] + [(255, 255, 255)], dtype=np.int32)
    diff = arr[:, :, None, :] - refs[None, None, :, :]
    nearest = (diff ** 2).sum(axis=-1).argmin(axis=-1)

    paths = []
    fg_union = np.zeros((H, W), dtype=bool)
    with tempfile.TemporaryDirectory() as tmp:
        for i, name in enumerate(names):
            mask = nearest == i
            fg_union |= mask
            pbm_path = os.path.join(tmp, f"{name}.pbm")
            Image.fromarray((~mask * 255).astype("uint8")).convert("1").save(pbm_path)
            svg_path = os.path.join(tmp, f"{name}.svg")
            subprocess.run(
                ["potrace", pbm_path, "-s", "-o", svg_path, "--flat", "-O", "0.2"],
                check=True, capture_output=True,
            )
            hexcolor = "#%02x%02x%02x" % colors[name]
            svg = open(svg_path).read()
            for d in re.findall(r'<path d="([^"]+)"/>', svg):
                paths.append(f'<path fill="{hexcolor}" d="{d}"/>')

    ys, xs = np.where(fg_union)
    pad = 12
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(W, int(xs.max()) + pad), min(H, int(ys.max()) + pad)

    body = "\n".join(paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {x1 - x0} {y1 - y0}">\n'
        f'<g transform="translate(0,{H}) scale(0.1,-0.1)">\n{body}\n</g>\n</svg>\n'
    )


# ── 1. Logo lockup (vector) ──────────────────────────────────────────────────
svg = vectorize(f"{SRC}/CFL VYBE LOGO.png")
open(f"{OUT}/logo.svg", "w").write(svg)
print(f"  {'logo.svg':26} {len(svg)/1024:8.1f} KB")

# ── 2. Logo with tagline (vector) ────────────────────────────────────────────
svg_tag = vectorize(f"{SRC}/Where in Central Florida does business?.png")
open(f"{OUT}/logo-tagline.svg", "w").write(svg_tag)
print(f"  {'logo-tagline.svg':26} {len(svg_tag)/1024:8.1f} KB")

# A raster version of the tagline lockup is still needed to composite the JPG
# social card below — og-image.jpg has no use for path data, just pixels.
_src = Image.open(f"{SRC}/Where in Central Florida does business?.png")
tag_raster = cut_all_white(_src).crop(saturated_bbox(_src))

# ── 3. Icon mark, squared ────────────────────────────────────────────────────
fav_src = Image.open(f"{SRC}/CFL Vibe Fabicon.png")
bb = saturated_bbox(fav_src)
mark = cut_all_white(fav_src).crop(bb)
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
mark_og = resize_w(tag_raster, 940)
og.paste(mark_og, ((1200 - mark_og.width) // 2, (630 - mark_og.height) // 2), mark_og)
og.save(f"{OUT}/og-image.jpg", quality=88, optimize=True)
report("og-image.jpg")

total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)
            if os.path.isfile(os.path.join(OUT, f)))
print(f"\ntotal: {total/1024:.0f} KB")
