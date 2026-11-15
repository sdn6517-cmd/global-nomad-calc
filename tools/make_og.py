#!/usr/bin/env python3
"""Draw the 1200×630 Open Graph card for Nomad Number Lab.

    python3 tools/make_og.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
NAVY = (18, 50, 95)
NAVY_DEEP = (11, 34, 66)
ACCENT = (72, 209, 178)
INK = (236, 242, 250)
MUTED = (158, 179, 205)


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for base in ("/usr/share/fonts/truetype/dejavu/" + name,
                 "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold
                 else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if Path(base).exists():
            return ImageFont.truetype(base, size)
    raise SystemExit("no usable font")


img = Image.new("RGB", (W, H), NAVY)
draw = ImageDraw.Draw(img)

# background: soft diagonal bands
for i in range(H):
    blend = i / H
    draw.line([(0, i), (W, i)], fill=(
        int(NAVY[0] * (1 - blend) + NAVY_DEEP[0] * blend),
        int(NAVY[1] * (1 - blend) + NAVY_DEEP[1] * blend),
        int(NAVY[2] * (1 - blend) + NAVY_DEEP[2] * blend)))

# accent squares grid, right side
for row in range(7):
    for col in range(4):
        x = 930 + col * 56
        y = 112 + row * 56
        shade = ACCENT if (row + col) % 3 else (46, 120, 150)
        draw.rounded_rectangle([x, y, x + 36, y + 36], radius=8, fill=shade)

# brand chip
draw.rounded_rectangle([70, 62, 70 + 52, 62 + 52], radius=12, fill=ACCENT)
draw.text((84, 72), "N", font=font(30, True), fill=NAVY_DEEP)

draw.text((70, 150), "NOMAD NUMBER LAB", font=font(26, True), fill=ACCENT)
draw.text((70, 205), "What your AI stack costs.", font=font(56, True), fill=INK)
draw.text((70, 272), "What your hour is worth.", font=font(56, True), fill=INK)
draw.text((70, 339), "When your team can meet.", font=font(56, True), fill=INK)

draw.text((70, 460), "Free calculators · prices, rates and timezones",
          font=font(28), fill=MUTED)

# rule + footnote chips
draw.line([(70, 520), (720, 520)], fill=(60, 92, 130), width=2)
chips = ["AI API cost", "Freelance rate", "Timezone overlap"]
x = 70
for chip in chips:
    text = chip
    w = draw.textlength(text, font=font(22, True))
    draw.rounded_rectangle([x, 545, x + w + 34, 590], radius=22, outline=(70, 110, 150), width=2)
    draw.text((x + 17, 555), text, font=font(22, True), fill=INK)
    x += w + 50

out = ROOT / "og-image.png"
img.save(out, optimize=True)
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
