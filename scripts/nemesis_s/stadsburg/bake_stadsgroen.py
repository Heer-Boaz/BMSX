#!/usr/bin/env python3
"""Validate six-metre town greenery and preview its native wind cels.

Static source drawings are imported by bake_stad.py. The wind sheets share the
same fixed canvas and root as those drawings; their trunks and main limbs are
locked by explicit masks. No resampling or whole-tree deformation happens in
the level build.
"""
from argparse import ArgumentParser
from functools import cache
from pathlib import Path
import json

import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3] / 'carts/nemesis_s'
ART = ROOT / 'authoring/stadsgroen'
SPEC = json.loads((ART / 'registratie.json').read_text())
ASSETS = {item['name']: item for item in SPEC['assets']}
TREE_NAMES = tuple(name for name, item in ASSETS.items() if 'rigid_source' in item)
BLACK = (0, 0, 0)
WOOD_RED = (160, 32, 32)
SNOW = (224, 224, 224)
LEAVES = (32, 128, 32)


def greenery_steps(name, column, origin):
    """Authored holds in native updates; tree gusts share a 76-update cycle."""
    variation = ((column - origin) % 7) * 2
    if name in TREE_NAMES:
        return [[1, 24 + variation], [2, 4], [3, 3], [4, 3], [5, 4],
                [6, 5], [7, 3], [8, 4], [1, 26 - variation]]
    return [[1, 24 + variation], [2, 5], [3, 7], [2, 5], [1, 9]]


def validate_inks(name, image, palette):
    assert image.width % 8 == image.height % 8 == 0, (name, image.size)
    assert set(image.get_flattened_data()) <= set(palette), name
    assert all(len({image.getpixel((x + dx, y)) for dx in range(8)}) <= 2
               for y in range(image.height) for x in range(0, image.width, 8)), name


@cache
def source_poses(name):
    """Read the native cels once per authoring run and verify their fixed core."""
    item = ASSETS[name]
    width, height = item['size']
    sheet = Image.open(ROOT / item['wind_source']).convert('RGB')
    assert sheet.size == (width * item['wind_poses'], height), name
    poses = tuple(sheet.crop((i * width, 0, (i + 1) * width, height))
                  for i in range(item['wind_poses']))
    rest = Image.open(ROOT / item['source']).convert('RGB')
    assert rest.size == (width, height) and rest.tobytes() == poses[0].tobytes(), name
    assert len({pose.tobytes() for pose in poses}) == item['wind_poses'], name
    palette = (BLACK, WOOD_RED if name in TREE_NAMES else LEAVES, SNOW)
    fixed = item['fixed_lower_rows']
    foot = rest.crop((0, height - fixed, width, height)).tobytes()
    if name in TREE_NAMES:
        rigid = Image.open(ROOT / item['rigid_source']).convert('L')
        assert rigid.size == rest.size, name
        core = [(x, y, rest.getpixel((x, y))) for y in range(height) for x in range(width)
                if rigid.getpixel((x, y))]
        assert core and all(ink != BLACK for _, _, ink in core), name
    for pose in poses:
        validate_inks(name, pose, palette)
        assert pose.crop((0, height - fixed, width, height)).tobytes() == foot, name
        if name in TREE_NAMES:
            assert all(pose.getpixel((x, y)) == ink for x, y, ink in core), name
    return poses


def greenery_poses(name, image):
    """Return native cels whose rest pose exactly matches the imported prefab."""
    item = ASSETS.get(name)
    if item is None or 'wind_source' not in item:
        return None
    poses = source_poses(name)
    assert image.size == poses[0].size and image.tobytes() == poses[0].tobytes(), \
        (name, 'prefab differs from native rest drawing; run bake_stad.py first')
    return poses


def assembled(name, prefabs, tiles):
    rows = prefabs[name]['tiles']
    image = Image.new('RGB', (len(rows[0]) * 8, len(rows) * 8))
    for y, row in enumerate(rows):
        for x, tile_id in enumerate(row):
            if tile_id is not None:
                image.paste(tiles[tile_id], (x * 8, y * 8))
    return image


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--preview-only', action='store_true',
                        help='Compatibility option: static import always belongs to bake_stad.py.')
    parser.parse_args()
    catalog = yaml.safe_load((ROOT / 'authoring/tileset.yaml').read_text())
    palette = [tuple(bytes.fromhex(color[1:])) for color in catalog['palette']]
    report = {'scale': SPEC['scale'], 'assets': {}}
    preview = Image.new('RGB', (960, 720), '#101923')
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=15)
    small = ImageFont.load_default(size=12)
    draw.text((24, 18), 'Stadsburg · wintergroen op de zesmeterschaal', font=font, fill='#eef3f3')
    for index, (name, item) in enumerate(ASSETS.items()):
        image = Image.open(ROOT / item['source']).convert('RGB')
        assert image.size == tuple(item['size']), name
        validate_inks(name, image, palette)
        image.save(ART / (name + '.png'))
        poses = greenery_poses(name, image)
        if poses:
            for stale in ART.glob(name + '_wind_*.png'):
                stale.unlink()
            for i, pose in enumerate(poses):
                pose.save(ART / (name + f'_wind_{i}.png'))
        if name in TREE_NAMES:
            Image.open(ROOT / item['rigid_source']).save(ART / ('rigid_' + name + '.png'))
        bounds = image.getbbox()
        report['assets'][name] = dict(item, visible_bounds=list(bounds),
                                     max_colors_per_8x1=2, brown_pixels=0,
                                     wind_poses=len(poses) if poses else 0,
                                     static_import='bake_stad.py')
        x, y = 24 + (index % 3) * 312, 62 + (index // 3) * 212
        draw.text((x, y), item['label'], font=font, fill='#eef3f3')
        draw.text((x, y + 23), f'Zichtbaar {bounds[2]-bounds[0]} × {bounds[3]-bounds[1]} px',
                  font=small, fill='#b6cbd2')
        scale = min(5, 145 // image.height)
        preview.paste(image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST),
                      (x, y + 50))
        preview.paste(image, (x + 246 - image.width, y + 50))
    (ART / 'controle.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    preview.save(ART / 'native_overzicht.png')
    print(json.dumps({'validated': list(ASSETS), 'static_import': 'bake_stad.py'}, indent=2))


if __name__ == '__main__':
    main()
