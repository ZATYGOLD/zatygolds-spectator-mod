"""
Zatygold's Spectator - builds the mod's game art from the source images in art/source/.

Run from the mod root:  python art/build_art.py
Requires Pillow. Overwrites the generated files in art/icons/ and art/backgrounds/.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps

ART = Path(__file__).resolve().parent
ROOT = ART.parent
SRC = ART / 'source'
ICONS = ART / 'icons'
BACKGROUNDS = ART / 'backgrounds'

CREAM = (231, 217, 172)
WHITE = (255, 255, 255)

SOURCES = {
    'portrait': SRC / 'Observer Leader Portrait.png',
    'icon': SRC / 'Observer Icon.png',
    'emblem': SRC / 'Observer Civilization Emblem.png',
    'loading': SRC / 'Observer Loading Screen.png',
}

# Leader icon, framed like the base leaders on the diplomacy ribbon: the head rises above
# the hex frame, the body is clipped to the frame's inner edge. Units are fractions of the icon.
PORTRAIT_HOOD = (330, 7, 950)            # hood left, top, right in the portrait source (px)
LEADER_HEX_CENTER = 0.517                # x of the ribbon hex's centre line in the icon (measured in-game)
LEADER_HEX_HALF_WIDTH = 0.32             # hex inner half width
LEADER_HEX_ROWS = (0.295, 0.663, 0.829)  # y of the hex's upper corners, lower corners and bottom tip
LEADER_HOOD_WIDTH = 0.68                 # hood width in the icon
LEADER_HOOD_TOP = 0.0                    # top of the hood in the icon
LEADER_HOOD_OFFSET = -0.042              # hood centre relative to the hex centre (the hood drapes right)

PORTRAIT_CROP = (160, 0, 1160, 1000)    # square around the hood for the circular portrait
CIRCLE_FILL = 0.6                        # circular portrait size / icon size
EMBLEM_FILL = 0.9                        # civ symbol size / icon size
ICON_FILL = 0.95                         # lobby civ icon size / icon size

LOADING_TOP_PAD = 0.12                   # sky added above the loading screen (fraction of its height), bottom cropped to match
LOADING_PAD_BLEND = 0.06                 # blend between the added sky and the original (fraction of its height)

LEADER_SIZES = (256, 140, 128, 64)
CIRCLE_SIZES = (256, 140, 128, 64)
LOADING_SIZES = {1080: (1920, 1080), 720: (1280, 720)}
SUPERSAMPLE = 4


def shape_mask(size, draw):
    """An anti-aliased size x size mask drawn by draw(ImageDraw, scale) at SUPERSAMPLE x."""
    big = Image.new('L', (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    draw(ImageDraw.Draw(big), size * SUPERSAMPLE)
    return big.resize((size, size), Image.LANCZOS)


def clip(image, mask):
    out = image.copy()
    out.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    return out


def glyph(source, color):
    """A flat light-on-black source as a solid colour on transparency, cropped to its shape."""
    mask = ImageOps.grayscale(Image.open(source))
    mask = mask.crop(mask.point(lambda v: 255 if v > 40 else 0).getbbox())
    out = Image.new('RGBA', mask.size, color + (0,))
    out.putalpha(mask)
    return out


def place(art, size, fill):
    """art scaled to fill * size on its longer side, centred on a transparent size x size canvas."""
    scale = size * fill / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def leader_hex_clip():
    """Visible area of a leader icon: everything above the hex's upper corners, the hex's inside below."""
    c, w = LEADER_HEX_CENTER, LEADER_HEX_HALF_WIDTH
    upper, lower, tip = LEADER_HEX_ROWS
    return ((0, 0), (1, 0), (1, upper), (c + w, upper), (c + w, lower), (c, tip), (c - w, lower), (c - w, upper), (0, upper))


def leader_icon(portrait, size):
    """The portrait cutout positioned by its hood over the ribbon hex and clipped like the base leaders."""
    left, top, right = PORTRAIT_HOOD
    scale = size * LEADER_HOOD_WIDTH / (right - left)
    art = portrait.resize((round(portrait.width * scale), round(portrait.height * scale)), Image.LANCZOS)
    x = round(size * (LEADER_HEX_CENTER + LEADER_HOOD_OFFSET) - (left + right) / 2 * scale)
    y = round(size * LEADER_HOOD_TOP - top * scale)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    layer.paste(art, (x, y), art)
    hex_clip = shape_mask(size, lambda d, s: d.polygon([(u * s, v * s) for u, v in leader_hex_clip()], fill=255))
    return clip(layer, hex_clip)


def circle_icon(portrait, size):
    """The portrait's head square clipped to a circle, filling CIRCLE_FILL of the icon."""
    art = portrait.crop(PORTRAIT_CROP)
    art = clip(art, shape_mask(art.width, lambda d, s: d.ellipse((0, 0, s - 1, s - 1), fill=255)))
    return place(art, size, CIRCLE_FILL)


def lower_scene(image):
    """The scene moved down by LOADING_TOP_PAD: its top edge stretched into sky above it, the bottom cropped off."""
    w, h = image.size
    pad, blend = round(h * LOADING_TOP_PAD), round(h * LOADING_PAD_BLEND)
    edge = image.crop((0, 0, w, 4)).resize((24, 1), Image.BOX).resize((w, pad + blend), Image.BICUBIC)
    flat = Image.new('RGB', edge.size, edge.resize((1, 1), Image.BOX).getpixel((0, 0)))
    sky = Image.composite(edge, flat, Image.linear_gradient('L').resize(edge.size))
    out = Image.new('RGB', (w, h + pad))
    out.paste(sky, (0, 0))
    fade = Image.linear_gradient('L').resize((w, blend))
    out.paste(Image.composite(image.crop((0, 0, w, blend)), sky.crop((0, pad, w, pad + blend)), fade), (0, pad))
    out.paste(image.crop((0, blend, w, h)), (0, pad + blend))
    return out.crop((0, 0, w, h))


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f'{path.relative_to(ROOT)}  {image.size[0]}x{image.size[1]}')


def build():
    portrait = Image.open(SOURCES['portrait']).convert('RGBA')
    for size in LEADER_SIZES:
        save(leader_icon(portrait, size), ICONS / f'zom_observer_leader_{size}.png')
    for size in CIRCLE_SIZES:
        save(circle_icon(portrait, size), ICONS / f'zom_observer_circle_{size}.png')

    save(place(glyph(SOURCES['icon'], CREAM), 256, ICON_FILL), ICONS / 'zom_observer.png')
    save(place(glyph(SOURCES['emblem'], WHITE), 256, EMBLEM_FILL), ICONS / 'zom_observer_civ.png')

    loading = lower_scene(Image.open(SOURCES['loading']).convert('RGB'))
    for name, size in LOADING_SIZES.items():
        save(ImageOps.fit(loading, size, Image.LANCZOS), BACKGROUNDS / f'lsbg_zom_observer_{name}.png')


if __name__ == '__main__':
    build()
