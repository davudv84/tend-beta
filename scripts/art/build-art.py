"""
Makes every file of the painting the homepage draws (the hero panel and the closing), from one source file:

    python3 scripts/art/build-art.py path/to/painting.png

The whole painting, unchanged (the page darkens it with the same overlays the photo had), as AVIF (q70, 4:4:4) and WebP (q85) at every
width in WIDTHS that the source can give without enlarging it. The widths written go to src/components/marketing/painting.json, which
<Landscape> reads, so a larger source only needs this script run again (up to 3840px wide).
"""
import json, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "home" / "painting"
WIDTHS = [640, 960, 1280, 1600, 1920, 2560, 3200, 3840]

def main(src: str) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    widths = [x for x in WIDTHS if x < w] + [min(w, WIDTHS[-1])]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("painting-*"):
        old.unlink()
    for x in widths:
        y = round(h * x / w)
        out = im if x == w else im.resize((x, y), Image.LANCZOS)
        out.save(OUT / f"painting-{x}.avif", quality=70, subsampling="4:4:4", speed=4)
        out.save(OUT / f"painting-{x}.webp", quality=85, method=6)
    meta = {"widths": widths, "width": widths[-1], "height": round(h * widths[-1] / w)}
    (ROOT / "src" / "components" / "marketing" / "painting.json").write_text(json.dumps(meta) + "\n")
    print(f"source {w}x{h} -> widths {widths}")

if __name__ == "__main__":
    main(sys.argv[1])
