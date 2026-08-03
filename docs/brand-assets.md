# Brand assets

**Vybe is spelled with a Y.** It is the brand, not a typo. Do not "correct" it
in code, copy, filenames or commit messages.

## Palette

Read off the logo. These are the source of truth for `styles/global.css`.

| Colour | Hex | Where it comes from |
|---|---|---|
| Coral | `#ee5a3c` | the **VYBE** wordmark and the skyline |
| Amber | `#efb02a` | the sun |
| Teal | `#33a399` | the palm |
| Deep teal-navy | `#17414b` | the **Central FL** wordmark — used as the site's ink |
| Paper | `#fafaf7` | the logo background |

## Layout

- `brand/` — the original full-size exports. **Not served**; it sits outside
  `public/` on purpose so 21 MB of source PNGs never ship to a browser.
- `public/` — the generated, web-ready files. These are what the site links to.

| File | Size | Used by |
|---|---|---|
| `logo.svg` | vector | header nameplate |
| `logo-tagline.svg` | vector | home hero card, footer, listing-card fallback image |
| `icon.png` | 512×512 | high-res favicon |
| `apple-touch-icon.png` | 180×180 | iOS home screen (flattened onto paper — iOS ignores alpha) |
| `favicon-32.png` | 32×32 | browser tab |
| `hero-2000.webp` | 2000×848 | home hero, ≥768px viewports |
| `hero-1200.webp` | 1200×509 | home hero, small viewports |
| `og-image.jpg` | 1200×630 | link previews on social |

All wired through `src/config/site.ts` — nothing hardcodes a path.

## Regenerating

```
python3 scripts/prep-brand-assets.py
```

Requires Pillow, numpy, and the `potrace` CLI (`brew install potrace`) for the
vector logo step. Reads `brand/`, writes `public/`. Three details the script
handles that a plain resize (or a one-shot image-to-SVG tool) would not:

1. **Opaque white backgrounds, including the white trapped *inside* the mark**
   — the gaps between buildings, the counters in "B"/"e"/"a". `cut_all_white()`
   keys out every near-white pixel globally rather than flood-filling from the
   four corners, so nothing survives as an opaque speck. (The old corner-only
   version is why the raster logo used to show white spots once the site got a
   dark theme — fixed by switching to vector output entirely, see below.)
2. **A faint grey watermark** sits in the bottom-right of every export. Cropping
   to the alpha bounding box would drag it in and pad each asset with a band of
   empty space. The script crops to *saturated* content instead, which the
   watermark is not.
3. **The two logo lockups are traced to real vector paths, not just resized.**
   Both are flat, saturated colour blocking — four solid hues, no gradients —
   so `vectorize()` classifies every pixel to its nearest brand hue (or plain
   background), potraces each hue's bitmap on its own, and recombines the
   result as one `<path>` per colour with a fully transparent background. The
   four hue values aren't hardcoded — `detect_ink_colors()` re-derives them
   per source file, since re-exports drift slightly from one to the next.

## Known limitation

- **Contrast on a dark surface.** The "Central FL" wordmark traces at whatever
  deep teal-navy the source art actually uses (not necessarily identical to
  `--color-ink` in `styles/global.css`, which was tuned separately for body
  text contrast) — it's legible on the dark theme's surface but not high-
  contrast. The home hero still puts the lockup on a paper card over the photo
  rather than directly on it, for the same reason.
