# RAKIZA brand source

## What is here

`rakiza-master.png` — the single file the owner supplied. 2143×734, RGBA,
transparent. It carries the whole lock-up: the hexagonal R mark, ركيزة, the
RAKIZA logotype and the BUILD TOGETHER tagline.

Everything the site serves under `client/public/brand/` is derived from it by
`scripts/brand/build-assets.py`. Nothing is traced, redrawn or approximated.

## Regenerating

```sh
python3 scripts/brand/build-assets.py
```

Replace the master and re-run, and every served size regenerates consistently.
The script needs no dependencies — it carries a small pure-Python PNG
reader/writer, because this environment has no PIL, no ImageMagick and no
sharp, and a brand pipeline that only runs on one machine is not a pipeline.

## What gets produced

| File | Size | Used for |
|---|---|---|
| `rakiza-lockup.png` | 880×276 | the lock-up on light surfaces |
| `rakiza-lockup-inverse.png` | 880×276 | the lock-up on navy / over photography |
| `rakiza-mark.png` | 256×256 | the mark alone, light surfaces |
| `rakiza-mark-inverse.png` | 256×256 | the mark alone, dark surfaces |
| `favicon-32.png` | 32×32 | browser tab |
| `favicon-64.png` | 64×64 | higher-density tab, bookmarks |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `rakiza-og.png` | 1200×630 | Open Graph / Twitter social card |

The three icon files are the **inverse mark on a navy rounded tile**, not the
mark on transparency. A navy mark on transparency vanishes into dark browser
chrome, which is the exact failure a favicon exists to prevent. The brand sheet
shows this tile treatment.

The social card is PNG rather than SVG because several Slack and WhatsApp
versions do not render SVG for `og:image`.

## Still wanted

**A vector master (SVG, AI or Figma).** Raster is sufficient for every size the
site serves today — the 32px favicon was inspected magnified and the hexagon,
the counter and the swoosh all still read — but curves are wanted for print,
for very large hero treatments and for arbitrary recolouring.

Its absence does not block engineering. It is an input to final visual
acceptance, not to the build.

## What must not happen

Do not trace the mark into SVG paths by eye, and do not crop a logo out of a
screenshot of the brand sheet or the homepage mockup. Both produce an
approximation of a trademark that claims to be the trademark. If the artwork
needs to change, change the master.
