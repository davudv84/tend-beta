"""
Makes every picture of the painting the site uses, from one source file:

    python3 scripts/art/build-art.py path/to/painting.png

- valley       the whole valley, cropped so the bright gap is the exact centre (hero, from 1024px)
- valley-tall  a tall crop around the gap and the river (hero below 1024px)
- sky          the sky only (the closing section)
- og           1200x630 link preview (src/app/og-valley.jpg, drawn into opengraph-image.tsx)

Each is darkened 40%, lightly dithered so the dark sky doesn't band, and written as AVIF (q70, 4:4:4) and WebP (q85) at every width the
site can draw it at (1x and 2x), never wider than the source allows. The widths written go to src/components/marketing/art-sizes.json,
which the <Painting> component reads, so a sharper source only needs this script run again.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "art"
GAP_X = 0.4728  # where the bright gap sits, as a share of the width
SETS = {
    # name: (crop as fractions (x0, y0, x1, y1) of the source, or "tall", widths wanted)
    "valley": ((0, 0, 2 * GAP_X, 1), [1024, 1280, 1440, 1920, 2560, 2880, 3840]),
    "valley-tall": ("tall", [640, 960, 1280, 1536, 1920]),
    "sky": ((0.3344, 0, 0.7106, 0.304), [1280, 1920, 2560, 3840]),
}

def darken(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB"), dtype=np.float32) * 0.6
    a += np.random.default_rng(7).uniform(-0.5, 0.5, a.shape)  # dither: no steps in the dark gradients
    return Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8))

def main(src_path: str):
    src = Image.open(src_path).convert("RGB")
    W, H = src.size
    print(f"source {W}x{H}")
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*"):
        f.unlink()
    sizes = {}
    for name, (crop, wanted) in SETS.items():
        if crop == "tall":
            cw = round(H * 480 / 822)
            x0 = round(GAP_X * W - cw / 2)
            box = (x0, 0, x0 + cw, H)
        else:
            box = tuple(round(v * (W if i % 2 == 0 else H)) for i, v in enumerate(crop))
        part = darken(src.crop(box))
        native = part.width
        widths = sorted({w for w in wanted if w < native} | {min(native, max(wanted))})
        for w in widths:
            h = round(part.height * w / part.width)
            im = part if w == part.width else part.resize((w, h), Image.LANCZOS)
            im.save(OUT / f"{name}-{w}.avif", quality=70, subsampling="4:4:4", speed=4)
            im.save(OUT / f"{name}-{w}.webp", quality=85, method=6)
        sizes[name] = {"widths": widths, "aspect": round(part.width / part.height, 4)}
        print(name, widths)
    # The link preview: 1200x630, the gap left of centre, the phone and the line drawn over it.
    h = H; w = round(h * 1200 / 630)
    x0 = max(0, min(W - w, round(0.1818 * W)))
    og = Image.fromarray(np.clip(np.asarray(src.crop((x0, 0, x0 + w, h)).resize((1200, 630), Image.LANCZOS), dtype=np.float32) * 0.5, 0, 255).astype(np.uint8))
    og.save(ROOT / "src" / "app" / "og-valley.jpg", quality=90, optimize=True, progressive=True)
    (ROOT / "src" / "components" / "marketing" / "art-sizes.json").write_text(json.dumps(sizes, indent=2) + "\n")

if __name__ == "__main__":
    main(sys.argv[1])
