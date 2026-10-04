"""
Zatygold's Spectator - builds the mod's game art from the source images in images/.

Run from the mod root:  python tools/build_art.py
Requires Pillow. Overwrites the generated files in icons/ and backgrounds/.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'images'
ICONS = ROOT / 'icons'
BACKGROUNDS = ROOT / 'backgrounds'

CREAM = (231, 217, 172)
WHITE = (255, 255, 255)

SOURCES = {
    'portrait': SRC / 'Observer Leader Portrait.png',
    'icon': SRC / 'Observer Icon.png',
    'emblem': SRC / 'Observer Civilization Emblem.png',
    'loading': SRC / 'Observer Loading Screen.png',
}

PORTRAIT_CROP = (160, 0, 1160, 1000)    # square around the hood in the portrait cutout
LEADER_FILL = 0.6                        # portrait size / icon size (fits inside the hex frame)
CIRCLE_FILL = 0.6                        # circular portrait size / icon size
EMBLEM_FILL = 0.9                        # civ symbol size / icon size
ICON_FILL = 0.95                         # lobby civ icon size / icon size

LOADING_TOP_PAD = 0.12                   # sky added above the loading screen (fraction of its height), bottom cropped to match
LOADING_PAD_BLEND = 0.06                 # blend between the added sky and the original (fraction of its height)

LEADER_SIZES = (256, 140, 128, 64)
CIRCLE_SIZES = (256, 140, 128, 64)
LOADING_SIZES = {1080: (1920, 1080), 720: (1280, 720)}


def glyph(source, color):
    """A flat light-on-black source as a solid colour on transparency, cropped to its shape."""
    mask = ImageOps.grayscale(Image.open(source))
    mask = mask.crop(mask.point(lambda v: 255 if v > 40 else 0).getbbox())
    out = Image.new('RGBA', mask.size, color + (0,))
    out.putalpha(mask)
    return out


def circle(image):
    """image clipped to its inscribed circle (anti-aliased edge)."""
    side = image.size[0]
    mask = Image.new('L', (side * 4, side * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, side * 4 - 1, side * 4 - 1), fill=255)
    out = image.copy()
    out.putalpha(ImageChops.multiply(image.getchannel('A'), mask.resize((side, side), Image.LANCZOS)))
    return out


def place(art, size, fill):
    """art scaled to fill * size on its longer side, centred on a transparent size x size canvas."""
    scale = size * fill / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


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
    portrait = Image.open(SOURCES['portrait']).convert('RGBA').crop(PORTRAIT_CROP)
    for size in LEADER_SIZES:
        save(place(portrait, size, LEADER_FILL), ICONS / f'zom_observer_leader_{size}.png')
    for size in CIRCLE_SIZES:
        save(place(circle(portrait), size, CIRCLE_FILL), ICONS / f'zom_observer_circle_{size}.png')

    save(place(glyph(SOURCES['icon'], CREAM), 256, ICON_FILL), ICONS / 'zom_observer.png')
    save(place(glyph(SOURCES['emblem'], WHITE), 256, EMBLEM_FILL), ICONS / 'zom_observer_civ.png')

    loading = lower_scene(Image.open(SOURCES['loading']).convert('RGB'))
    for name, size in LOADING_SIZES.items():
        save(ImageOps.fit(loading, size, Image.LANCZOS), BACKGROUNDS / f'lsbg_zom_observer_{name}.png')


if __name__ == '__main__':
    build()
