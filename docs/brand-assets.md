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
| `logo.png` | 720×222 | header nameplate |
| `logo-tagline.png` | 900×349 | home hero card, footer |
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

Requires Pillow. Reads `brand/`, writes `public/`. Two details the script
handles that a plain resize would not:

1. **Opaque white backgrounds.** The exports have white baked in, not alpha. The
   script flood-fills transparency inward from the four corners only, so the
   white *inside* the mark — the gaps between buildings — survives.
2. **A faint grey watermark** sits in the bottom-right of every export. Cropping
   to the alpha bounding box would drag it in and pad each asset with a band of
   empty space. The script crops to *saturated* content instead, which the
   watermark is not.

## Still missing

- A vector version of the logo. Everything above is raster, upscaled from PNG.
  An SVG would render sharper in the header and shrink `logo.png` to a few KB.
- A dark-background variant. The "Central FL" wordmark and the tagline are deep
  teal, so the lockup is unreadable over a photo scrim. That is why the home
  hero puts it on a paper card over the image rather than directly on it.
