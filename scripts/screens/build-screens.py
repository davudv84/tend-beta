"""
Makes the site's product screens from real screenshots of the TEND app (see scripts/screens/README.md for how they are taken):

    python3 scripts/screens/build-screens.py <folder with the captured PNGs> [name ...]   (names: only those, keeping the rest)

Each screen is cropped as SCREENS says and written as AVIF (q72, 4:4:4, so small text stays sharp) and WebP (q86) at every width in
WIDTHS up to its own, into public/screens. The sizes go to src/components/marketing/screens.json, which <Shot> reads.
"""
import json, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "screens"
WIDTHS = [480, 720, 960, 1440, 1920, 2880]

# name: (source file, crop box or None). Desktop captures are a 1440x900 window at 2x; phone captures a 390x844 screen at 3x.
SCREENS = {
    "story-1": ("story/story-1.png", None), "story-2": ("story/story-2.png", None), "story-3": ("story/story-3.png", None), "story-4": ("story/story-4.png", None),
    "pstory-1": ("story/pstory-1.png", None), "pstory-2": ("story/pstory-2.png", None), "pstory-3": ("story/pstory-3.png", None),
    "overview": ("final/overview.png", None), "overview-stats": ("final/overview-stats.png", None),
    "approvals": ("final/approvals.png", None), "approvals-card": ("final/approvals-card.png", None),
    "policies": ("final/policies.png", None), "policies-edit": ("final/policies-edit.png", (0, 0, 1380, 1120)),
    "policies-json": ("final/policies-json.png", None), "spend-locked": ("final/policies-edit.png", (0, 340, 1380, 600)),
    "activity": ("final/activity.png", None), "activity-blocked": ("final/activity-blocked.png", None),
    "agents": ("final/agents.png", None), "connect": ("final/connect.png", None),
    "integrations": ("final/integrations.png", None), "integration-dialog": ("final/integration-dialog.png", None),
    "checks": ("rest2/checks-card.png", (0, 0, 2880, 1800)),
    # The three steps of the story on their own: the request, the answer, and the row in Activity.
    "step-ask": ("story/story-2.png", (594, 812, 1652, 1712)), "step-decide": ("story/story-3.png", (2124, 1610, 2828, 1748)), "step-ran": ("story/story-4.png", (590, 700, 2754, 980)),
    "phone-approvals": ("rest/phone-approvals.png", None), "phone-overview": ("rest/phone-overview.png", None),
}

def main(src: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[2:]
    meta_file = ROOT / "src" / "components" / "marketing" / "screens.json"
    meta = json.loads(meta_file.read_text()) if only and meta_file.exists() else {}
    if not only:
        for old in OUT.glob("*"):
            old.unlink()
    for name, (file, box) in SCREENS.items():
        if only and name not in only:
            continue
        im = Image.open(Path(src) / file).convert("RGB")
        if box:
            im = im.crop(box)
        w, h = im.size
        widths = [x for x in WIDTHS if x < w] + [w]
        for x in widths:
            out = im if x == w else im.resize((x, round(h * x / w)), Image.LANCZOS)
            out.save(OUT / f"{name}-{x}.avif", quality=72, subsampling="4:4:4", speed=4)
            out.save(OUT / f"{name}-{x}.webp", quality=86, method=6)
        meta[name] = {"widths": widths, "w": w, "h": h}
        print(name, w, h, widths)
    meta_file.write_text(json.dumps({k: meta[k] for k in SCREENS if k in meta}) + "\n")

if __name__ == "__main__":
    main(sys.argv[1])
