"""Draw the Litwave app icon from code: the slanted white "L" on a rounded tile.

The "L" is the mark from the original installer icon (a slanted stem and a foot split by a thin slit), redrawn as
vector shapes so it stays sharp at every size. The original had no background and vanished on light themes; the
tile gives it one that works on light and dark taskbars alike.

    uv run --no-project --with pillow python tools/make_icon.py [OUT_DIR] [blue|dark]

Writes app.ico (16-256 px) and icon-<size>.png into OUT_DIR (default: assets/icon/).
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersampling factor for smooth edges
TILES = {
    # accent #0A84FF / #4DA2FF from src/static/css/tokens.css
    "blue": ((77, 162, 255), (8, 96, 214)),
    "dark": ((44, 44, 48), (6, 6, 8)),
}
MARK = (255, 255, 255)
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
PNG_SIZES = [16, 32, 48, 64, 128, 192, 256, 512, 1024]

# The mark, measured on the original 256 px artwork: both stem edges lean 0.3 px left per px down,
# the foot's right edge 0.5, and the slit runs from the inner corner down-left at 1.5.
STEM_LEFT, STEM_RIGHT, LEAN, TOP, FOOT_TOP, BOTTOM = 104.0, 149.5, 0.3, 54.0, 184.0, 222.0
FOOT_RIGHT, FOOT_LEAN = 210.0, 0.5
SLIT_X, SLIT_Y, SLIT_SLOPE, SLIT_HALF = 101.0, 188.0, 1.5, 4.0
CORNER = 2.6  # corner rounding, in the same 256 px units


def _mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _mark_mask(n: int) -> Image.Image:
    """The L as an anti-aliased mask on an n x n canvas, in its original 256 px position."""
    k = n / 256
    mask = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(mask)
    edge = lambda x, y: (x - LEAN * (y - 57)) * k  # noqa: E731  stem edge x at height y
    d.polygon([(edge(STEM_LEFT, TOP), TOP * k), (edge(STEM_RIGHT, TOP), TOP * k),
               (edge(STEM_RIGHT, BOTTOM), BOTTOM * k), (edge(STEM_LEFT, BOTTOM), BOTTOM * k)], fill=255)
    d.polygon([(edge(STEM_LEFT, FOOT_TOP), FOOT_TOP * k), (FOOT_RIGHT * k, FOOT_TOP * k),
               ((FOOT_RIGHT - FOOT_LEAN * (BOTTOM - FOOT_TOP)) * k, BOTTOM * k),
               (edge(STEM_LEFT, BOTTOM), BOTTOM * k)], fill=255)
    slit = lambda y: SLIT_X - SLIT_SLOPE * (y - SLIT_Y)  # noqa: E731
    y0, y1 = 170.0, BOTTOM + 4
    d.polygon([((slit(y0) - SLIT_HALF) * k, y0 * k), ((slit(y0) + SLIT_HALF) * k, y0 * k),
               ((slit(y1) + SLIT_HALF) * k, y1 * k), ((slit(y1) - SLIT_HALF) * k, y1 * k)], fill=0)
    # Round the outer corners a little, like the original, but keep the slit's inner corners sharp:
    # shrink the shape, then grow it back (blurring and re-thresholding high, then low).
    blur = ImageFilter.GaussianBlur(CORNER * k / 2)
    mask = mask.filter(blur).point(lambda v: 255 if v >= 250 else 0)
    mask = mask.filter(blur).point(lambda v: 255 if v >= 5 else 0)
    return mask


def draw(size: int, tile: str = "blue") -> Image.Image:
    small = size <= 32
    n = 1024 * SS
    u = n / 1024
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # Tile: rounded square with a vertical gradient. Small sizes fill more of the square to stay legible.
    inset = (16 if small else 56) * u
    radius = (190 if small else 216) * u
    box = (inset, inset, n - inset, n - inset)
    top, bottom = TILES[tile]
    grad = Image.new("RGBA", (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        gd.line([(0, y), (n, y)], fill=_mix(top, bottom, y / n) + (255,))
    shape = Image.new("L", (n, n), 0)
    ImageDraw.Draw(shape).rounded_rectangle(box, radius, fill=255)
    img.paste(grad, (0, 0), shape)
    if not small:
        ImageDraw.Draw(img).rounded_rectangle(box, radius, outline=(255, 255, 255, 40), width=round(4 * u))

    # Mark: scaled about its own box and centred on the tile, nudged left a touch since the slant leans that way.
    mark = _mark_mask(n)
    mark = mark.crop(mark.getbbox())
    scale = (0.64 if small else 0.54) * n / mark.width
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    x = (n - mark.width) / 2 - 0.012 * n
    y = (n - mark.height) / 2
    img.paste(Image.new("RGBA", mark.size, MARK + (255,)), (round(x), round(y)), mark)

    return img.resize((size, size), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "assets", "icon")
    tile = sys.argv[2] if len(sys.argv) > 2 else "blue"
    os.makedirs(out, exist_ok=True)
    for s in PNG_SIZES:
        draw(s, tile).save(os.path.join(out, f"icon-{s}.png"))
    frames = [draw(s, tile) for s in ICO_SIZES]
    frames[-1].save(os.path.join(out, "app.ico"), sizes=[(s, s) for s in ICO_SIZES], append_images=frames[:-1])
    print(f"wrote {len(PNG_SIZES)} PNGs and app.ico ({tile} tile) to {out}")


if __name__ == "__main__":
    main()
