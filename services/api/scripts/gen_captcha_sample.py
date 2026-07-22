"""Generate a sample captcha PNG matching the tuned Go renderer."""
import math
import os
import random

from PIL import Image

GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "J": ["00111", "00001", "00001", "00001", "00001", "10001", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10001", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
}


def set_px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def draw_line(img, x0, y0, x1, y1, c):
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    while True:
        set_px(img, x0, y0, c)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


def draw_wave(img, c, thickness=1):
    amp = 6 + random.random() * 8
    freq = 0.04 + random.random() * 0.06
    phase = random.random() * math.pi * 2
    base_y = img.height * 0.28 + random.random() * img.height * 0.44
    for x in range(img.width):
        y = int(base_y + math.sin(x * freq + phase) * amp)
        for t in range(-thickness, thickness + 1):
            set_px(img, x, y + t, c)


def draw_glyph(img, ox, oy, glyph, scale, color, rot):
    cx = ox + (5 * scale) / 2
    cy = oy + (7 * scale) / 2
    cos, sin = math.cos(rot), math.sin(rot)
    for row, line in enumerate(glyph):
        for col, bit in enumerate(line):
            if bit != "1":
                continue
            for sy in range(scale):
                for sx in range(scale):
                    if (sx in (0, scale - 1) or sy in (0, scale - 1)) and random.randrange(6) == 0:
                        continue
                    px = ox + col * scale + sx - cx
                    py = oy + row * scale + sy - cy
                    rx = px * cos - py * sin + cx
                    ry = px * sin + py * cos + cy
                    xi, yi = int(round(rx)), int(round(ry))
                    set_px(img, xi, yi, color)
                    if random.randrange(4) == 0:
                        set_px(img, xi + 1, yi, color)


def warp(src, amp, freq):
    dst = Image.new("RGBA", src.size, (235, 238, 245, 255))
    phase = random.random() * math.pi * 2
    phase2 = random.random() * math.pi * 2
    px = src.load()
    dx = dst.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            sx = x + int(amp * math.sin(y * freq + phase))
            sy = y + int((amp * 0.5) * math.sin(x * freq * 1.2 + phase2))
            if 0 <= sx < w and 0 <= sy < h:
                dx[x, y] = px[sx, sy]
    return dst


def render(code="H7K3P"):
    scale = 5
    pad_x, pad_y = 18, 14
    char_step = 5 * scale + 6 + random.randrange(4)
    w = pad_x * 2 + len(code) * char_step
    h = pad_y * 2 + 7 * scale + 28
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = x / w * 0.35 + y / h * 0.25
            px[x, y] = (
                232 + int(t * 14) + random.randrange(6),
                236 + int(t * 10) + random.randrange(6),
                242 + int(t * 8) + random.randrange(5),
                255,
            )
    for _ in range(w * h // 14):
        x, y = random.randrange(w), random.randrange(h)
        px[x, y] = (
            120 + random.randrange(90),
            130 + random.randrange(80),
            150 + random.randrange(70),
            70 + random.randrange(90),
        )
    for _ in range(3):
        c = (
            70 + random.randrange(80),
            90 + random.randrange(70),
            140 + random.randrange(70),
            110 + random.randrange(60),
        )
        draw_wave(img, c, 1)
    for _ in range(5):
        c = (
            80 + random.randrange(100),
            90 + random.randrange(90),
            110 + random.randrange(90),
            90 + random.randrange(70),
        )
        draw_line(
            img,
            random.randrange(w),
            random.randrange(h),
            random.randrange(w),
            random.randrange(h),
            c,
        )
    palette = [
        (28, 70, 160, 255),
        (20, 90, 140, 255),
        (50, 40, 130, 255),
        (15, 55, 110, 255),
    ]
    x = pad_x
    for ch in code:
        ink = random.choice(palette)
        dy = random.randrange(9) - 4
        rot = (random.randrange(27) - 13) * math.pi / 180
        scl = scale + (1 if random.randrange(4) == 0 else 0)
        draw_glyph(img, x, pad_y + 10 + dy, GLYPHS[ch], scl, ink, rot)
        x += char_step + random.randrange(3) - 1
    for _ in range(2):
        c = (
            60 + random.randrange(70),
            80 + random.randrange(60),
            120 + random.randrange(70),
            120 + random.randrange(50),
        )
        draw_wave(img, c, 1)
    img = warp(img, 2.0 + random.random() * 1.6, 0.035 + random.random() * 0.02)
    px = img.load()
    for _ in range(w * h // 55):
        x, y = random.randrange(w), random.randrange(h)
        px[x, y] = (255, 255, 255, 255) if random.randrange(3) == 0 else (40, 55, 90, 140)
    return img


if __name__ == "__main__":
    random.seed(42)  # stable sample for review
    code = "H7K3P"
    img = render(code)
    out = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
    path = r"D:\Work\1-InProgress\qchat\assets\captcha-sample.png"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    print(path)
    print("answer", code)
    print("size", out.size)
