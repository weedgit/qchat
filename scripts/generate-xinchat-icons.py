#!/usr/bin/env python3
"""Generate XinChat brand icons (violet + X) for web, mobile, and desktop."""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BG_TOP = (109, 40, 217)  # #6d28d9
BG_BOTTOM = (76, 29, 149)  # #4c1d95
LETTER = (255, 255, 255, 255)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_bg(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        r = lerp(BG_TOP[0], BG_BOTTOM[0], t)
        g = lerp(BG_TOP[1], BG_BOTTOM[1], t)
        b = lerp(BG_TOP[2], BG_BOTTOM[2], t)
        for x in range(size):
            img.putpixel((x, y), (r, g, b, 255))
    return img


def rounded_rect_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_x(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], width: int) -> None:
    x0, y0, x1, y1 = box
    draw.line((x0, y0, x1, y1), fill=LETTER, width=width)
    draw.line((x1, y0, x0, y1), fill=LETTER, width=width)


def font_for(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def icon_square(size: int, letter_scale: float = 0.42, corner_ratio: float = 0.22) -> Image.Image:
    img = gradient_bg(size)
    mask = rounded_rect_mask(size, size * corner_ratio)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.paste(img, (0, 0), mask)

    draw = ImageDraw.Draw(bg)
    font_size = int(size * letter_scale)
    font = font_for(font_size)
    text = "X"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1]
    draw.text((tx, ty), text, fill=LETTER, font=font)
    return bg


def icon_maskable(size: int) -> Image.Image:
    """Android maskable — letter in center 66% safe zone."""
    img = gradient_bg(size)
    draw = ImageDraw.Draw(img)
    pad = int(size * 0.17)
    inner = size - 2 * pad
    stroke = max(int(size * 0.09), 4)
    draw_x(draw, (pad, pad, pad + inner, pad + inner), stroke)
    return img


def icon_foreground(size: int) -> Image.Image:
    """Adaptive icon foreground — transparent bg, violet X."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = font_for(int(size * 0.38))
    text = "X"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1]
    draw.text((tx, ty), text, fill=(109, 40, 217, 255), font=font)
    return img


def solid_bg(size: int, color: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), color + (255,))
    return img


def write_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.mode == "RGBA":
        img.save(path, "PNG")
    else:
        img.convert("RGB").save(path, "PNG")
    print(f"  wrote {path}")


def main() -> None:
    web_icons = ROOT / "apps/xin-web/public/icons"
    web_root = ROOT / "apps/xin-web/public"
    mobile = ROOT / "apps/xin-mobile/assets"
    desktop = ROOT / "apps/xin-desktop/assets"

    print("XinChat icons → web")
    write_png(icon_square(192), web_icons / "icon-192.png")
    write_png(icon_square(512), web_icons / "icon-512.png")
    write_png(icon_maskable(192), web_icons / "icon-maskable-192.png")
    write_png(icon_maskable(512), web_icons / "icon-maskable-512.png")
    write_png(icon_square(180), web_icons / "apple-touch-icon.png")
    write_png(icon_square(32), web_root / "favicon.png")

    print("XinChat icons → mobile")
    write_png(icon_square(1024), mobile / "icon.png")
    write_png(icon_square(1024), mobile / "qchat-icon-512.png")
    write_png(icon_square(1024), mobile / "splash-icon.png")
    write_png(icon_square(1024), mobile / "adaptive-icon.png")
    write_png(solid_bg(1024, (91, 33, 182)), mobile / "android-icon-background.png")
    write_png(icon_foreground(1024), mobile / "android-icon-foreground.png")
    write_png(icon_foreground(1024), mobile / "android-icon-monochrome.png")
    write_png(icon_square(48), mobile / "favicon.png")

    print("XinChat icons → desktop")
    for s in (16, 32, 48, 64, 128, 256, 512):
        write_png(icon_square(s), desktop / f"icon-{s}.png")
    write_png(icon_square(512), desktop / "icon.png")

    print("Done.")


if __name__ == "__main__":
    main()
