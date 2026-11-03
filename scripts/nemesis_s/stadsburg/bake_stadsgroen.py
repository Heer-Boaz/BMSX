#!/usr/bin/env python3
"""Register winter greenery and small street furniture on the existing native grid.

The source drawing is sampled once, offline. Every registered character row
uses at most two of the existing MSX inks. R25 changes only the exact gray wood
ink to dark red; the R24 source rasters and tile IDs remain as provenance.
"""
from argparse import ArgumentParser
from pathlib import Path
import hashlib
import json
from math import cos, sin, radians

import yaml
from PIL import Image, ImageDraw, ImageFont

from bake_stad import sample, restrict_rows

ROOT = Path(__file__).resolve().parents[3] / 'carts/nemesis_s'
ART = ROOT / 'authoring/stadsgroen'
BLACK = (0, 0, 0)
WOOD_GRAY = (160, 160, 160)
WOOD_RED = (160, 32, 32)
WOOD_NAMES = ('compact_winterlinde', 'compact_tree_socket_gevelkade',
              'straatboom_winter', 'knotboom_winter', 'winterlinde_stil')


def wood_color(image):
    result = image.convert('RGB').copy()
    result.putdata([WOOD_RED if pixel == WOOD_GRAY else pixel for pixel in result.get_flattened_data()])
    return result


# Each mask follows a secondary branch in the authored raster. Its fork is
# the rotation origin; the trunk and the larger connecting limbs are excluded.
# Rectangles select existing ink only and are never translated as image strips.
TREE_BRANCHES = {
    'straatboom_winter': (
        ((9, 10), ((3, 3, 11, 9),), ()),       # upper-left fork
        ((15, 6), ((12, 0, 18, 3), (15, 3, 16, 6)), ()),  # top leader
        ((16, 6), ((18, 3, 21, 5), (17, 5, 19, 6)), ()),  # upper-right fork
        ((5, 11), ((2, 7, 6, 11),), ()),       # thin left-side shoots
        ((20, 11), ((22, 8, 24, 9), (21, 9, 24, 10), (20, 10, 23, 11)), ()),
    ),
    'knotboom_winter': (
        ((3, 7), ((2, 2, 4, 7),), ()),
        ((8, 8), ((6, 0, 9, 8),), ()),
        ((10, 7), ((10, 1, 13, 7),), ()),
        ((3, 11), ((0, 7, 3, 11),), ()),
        ((13, 10), ((13, 4, 16, 10),), ()),
    ),
    'winterlinde_stil': (
        ((19, 6), ((16, 1, 20, 6),), ((16, 6),)),  # left apex
        ((21, 6), ((22, 1, 25, 8),), ((21, 5),)),  # right apex
        ((14, 13), ((9, 7, 15, 13),), ()),    # long northwest terminals
        ((7, 13), ((5, 9, 9, 13),), ()),
        ((4, 22), ((1, 17, 5, 22),), ()),
        ((26, 14), ((26, 10, 31, 14),), ()),
        ((25, 24), ((25, 20, 31, 24),), ()),
    ),
}
# These are hand-authored composite key poses, in degrees about the local
# forks above. The gust overlaps branches; they unload and settle separately.
TREE_ANGLES = {
    'straatboom_winter': (
        (0, 0, 0, 0, 0), (8, 0, 0, 0, 0), (8, 8, 0, 0, 0),
        (8, 8, 16, 0, 0), (0, 8, 16, 8, 0), (0, 0, 16, 8, 12),
        (0, 0, 0, 0, 12), (0, 0, -12, 0, 0),
    ),
    'knotboom_winter': (
        (0, 0, 0, 0, 0), (10, 8, 0, 0, 0), (10, 8, 8, 0, 0),
        (10, 8, 8, 10, 10), (0, 8, 8, 10, 10), (0, 0, 0, 0, 10),
        (0, 0, -8, 0, 10), (0, 0, 0, 0, -8),
    ),
    'winterlinde_stil': (
        (0, 0, 0, 0, 0, 0, 0), (10, 0, 0, 10, 0, 0, 0),
        (10, 10, 5, 10, 10, 0, 0), (10, 10, 15, 10, 10, 8, 0),
        (0, 10, 15, 0, 10, 8, 10), (0, 0, 5, 0, 0, 8, 10),
        (0, -8, 0, 0, 0, 0, 0), (0, 0, -8, 0, 0, -7, 0),
    ),
}
TREE_BRANCHES['compact_winterlinde'] = TREE_BRANCHES['winterlinde_stil']
TREE_ANGLES['compact_winterlinde'] = TREE_ANGLES['winterlinde_stil']


def greenery_steps(name, column, origin):
    """Authored holds in native updates; tree gusts share a 76-update cycle."""
    variation = ((column - origin) % 7) * 2
    if name in TREE_BRANCHES:
        return [[1, 24 + variation], [2, 4], [3, 3], [4, 3], [5, 4],
                [6, 5], [7, 3], [8, 4], [1, 26 - variation]]
    return [[1, 24 + variation], [2, 5], [3, 7], [2, 5], [1, 9]]


def greenery_poses(name, image):
    """Articulate secondary branches around fixed forks, then bake the cels."""
    if name in TREE_BRANCHES:
        branches = []
        for pivot, rectangles, extra in TREE_BRANCHES[name]:
            mask = set(extra)
            for left, top, right, bottom in rectangles:
                mask.update((x, y) for y in range(top, bottom) for x in range(left, right))
            points = [(x, y, image.getpixel((x, y))) for x, y in sorted(mask)
                      if image.getpixel((x, y)) != BLACK]
            branches.append((pivot, points))
        moving = {(x, y) for _, points in branches for x, y, _ in points}
        core = [(x, y, image.getpixel((x, y))) for y in range(image.height)
                for x in range(image.width) if (x, y) not in moving and image.getpixel((x, y)) != BLACK]
        poses = []
        for angles in TREE_ANGLES[name]:
            frame = Image.new('RGB', (image.width + 8, image.height))
            frame.paste(image, (0, 0))
            mapped = []
            for index, ((cx, cy), points) in enumerate(branches):
                angle = angles[index]; sine, cosine = sin(radians(angle)), cos(radians(angle))
                for x, y, ink in points:
                    frame.putpixel((x, y), BLACK)
                    px = round(cx + (x-cx)*cosine - (y-cy)*sine)
                    py = round(cy + (x-cx)*sine + (y-cy)*cosine)
                    if name == 'knotboom_winter' and index == 1 and angle > 0 and (x, y) == (7, 1):
                        # One cel pixel below the snow tip stays on the left
                        # of the colour boundary while its neighbours rotate.
                        px, py = x, y
                    assert 0 <= px < frame.width and 0 <= py < frame.height, (name, index, px, py)
                    mapped.append((px, py, ink))
            for x, y, ink in mapped:
                frame.putpixel((x, y), ink)
            if name in ('winterlinde_stil', 'compact_winterlinde') and angles[2] >= 15:
                # The two adjoining thin forks share this curved raster join
                # while both are loaded by the gust. Rest artwork is untouched.
                frame.putpixel((9, 9), WOOD_RED)
            assert all(frame.getpixel((x, y)) == ink for x, y, ink in core), name
            assert all(len({frame.getpixel((x+dx, y)) for dx in range(8)}) <= 2
                       for y in range(frame.height) for x in range(0, frame.width, 8)), name
            poses.append(frame)
        width = max(image.width, ((max(frame.getbbox()[2] for frame in poses)+7)//8)*8)
        poses = [frame.crop((0, 0, width, image.height)) for frame in poses]
        assert len({frame.tobytes() for frame in poses}) == 8, name
        return poses

    spans = {
        'sneeuwstruik': (((0, 3, 15, 4), (2, 5, 3, 7)),
                         ((0, 3, 15, 6), (2, 6, 3, 7))),
        'sneeuwhaag': (((0, 2, 15, 3),), ((0, 2, 15, 4),)),
    }
    if name not in spans:
        return None
    poses = [image.copy()]
    for pose_index,regions in enumerate(spans[name],1):
        frame = image.copy()
        for left, top, right, bottom in regions:
            for y in range(top, bottom):
                pixels = [(x, image.getpixel((x, y))) for x in range(left, right)
                          if image.getpixel((x, y)) != BLACK]
                assert all(x + 1 < image.width for x, color in pixels), (name, y)
                for x, color in pixels:
                    frame.putpixel((x, y), BLACK)
                for x, color in pixels:
                    frame.putpixel((x + 1, y), color)
        if name=='sneeuwhaag':
            # The snow/leaf boundary bends with the cap. These two solid
            # canopy rows stay fully occupied, so no black hole is introduced.
            for y in ((4,) if pose_index==1 else (4,5)):
                frame.paste(image.crop((0,y,image.width-1,y+1)),(1,y))
                frame.putpixel((0,y),image.getpixel((0,y)))
        assert all(len({frame.getpixel((x + dx, y)) for dx in range(8)}) <= 2
                   for y in range(frame.height) for x in range(0, frame.width, 8)), name
        fixed = 1 if name=='sneeuwstruik' else 2
        assert frame.crop((0, image.height-fixed, image.width, image.height)).tobytes() == \
               image.crop((0, image.height-fixed, image.width, image.height)).tobytes(), name
        poses.append(frame)
    assert len({frame.tobytes() for frame in poses}) == 3, name
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
    parser.add_argument('--preview-only', action='store_true')
    args = parser.parse_args()
    spec = json.loads((ART / 'registratie.json').read_text())
    catalog_path = ROOT / 'authoring/tileset.yaml'
    prefab_path = ROOT / 'authoring/prefabs.yaml'
    catalog = yaml.safe_load(catalog_path.read_text())
    prefab_data = yaml.safe_load(prefab_path.read_text())
    prefabs = prefab_data['prefabs']
    palette = [tuple(bytes.fromhex(c[1:])) for c in catalog['palette']]
    entries = {entry['id']: entry for entry in catalog['tiles']}
    tiles = {tile_id: Image.open(ROOT / entry['image']).convert('RGB')
             for tile_id, entry in entries.items()}
    source_path = ART / spec['source']
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == spec['source_sha256']
    source = Image.open(source_path).convert('RGB')
    evidence_path = ART / 'houtbron_r24.json'
    if evidence_path.exists():
        wood_sources = json.loads(evidence_path.read_text())
    else:
        folder = ART / 'houtbron_r24'
        folder.mkdir(exist_ok=True)
        wood_sources = {}
        for name in WOOD_NAMES:
            original = assembled(name, prefabs, tiles)
            path = folder / (name + '.png')
            original.save(path)
            wood_sources[name] = {'image': path.relative_to(ROOT).as_posix(),
                                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                  'source_tiles': prefabs[name]['tiles']}
        evidence_path.write_text(json.dumps(wood_sources, indent=2, ensure_ascii=False) + '\n')
    wood_proof = {'mapping': {'#a0a0a0': '#a02020'}, 'source_revision': 24, 'assets': {}}
    for name, record in wood_sources.items():
        path = ROOT / record['image']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256']
    originals = {name: Image.open(ROOT / record['image']).convert('RGB') for name, record in wood_sources.items()}
    results = {}
    report = {'source': spec['source'], 'source_sha256': spec['source_sha256'],
              'scale': spec['scale'], 'assets': {}}
    for item in spec['assets']:
        crop = source.crop(item['region'])
        ink = crop.convert('L').point(lambda value: 255 if value > 32 else 0)
        bounds = ink.getbbox()
        assert bounds, item['name']
        box = (item['region'][0] + bounds[0], item['region'][1] + bounds[1],
               item['region'][0] + bounds[2], item['region'][1] + bounds[3])
        inks = [palette[index] for index in item.get('palette_indices', range(len(palette)))]
        if 'source_rows' in item:
            strip = Image.new('RGB', (box[2] - box[0], len(item['source_rows'])))
            for y, source_y in enumerate(item['source_rows']):
                strip.paste(source.crop((box[0], source_y, box[2], source_y + 1)), (0, y))
            drawing, distances = sample(strip, (0, 0, *strip.size), tuple(item['drawing_size']), inks)
        else:
            drawing, distances = sample(source, box, tuple(item['drawing_size']), inks)
        image = Image.new('RGB', item['size'])
        image.paste(drawing, ((image.width - drawing.width) // 2, image.height - drawing.height))
        image = restrict_rows(image, inks, distances)
        if item['name'] in WOOD_NAMES:
            assert image.tobytes() == originals[item['name']].tobytes(), item['name']
            image = wood_color(image)
        results[item['name']] = (image, item['label'])
        report['assets'][item['name']] = {'source_crop': list(box), 'size': list(image.size),
                                           'drawing_size': list(drawing.size),
                                           'palette_indices': item.get('palette_indices', list(range(len(palette))))}
        if 'source_rows' in item:
            report['assets'][item['name']]['source_rows'] = item['source_rows']

    # Keep the established alias and placement. Both lindens now use the same
    # exact dark-red wood conversion, with their snow pixels untouched.
    results['winterlinde_stil'] = (wood_color(originals['compact_winterlinde']),
                                   'Volwassen winterlinde')
    report['assets']['winterlinde_stil'] = {'reused_prefab': 'compact_winterlinde',
                                           'size': [32, 48], 'drawing_size': [30, 47]}
    # A two-pixel snow lip identifies a roadside planted verge in side view.
    # It is cut from the approved quay snow, with no visible top plane.
    snow = assembled('reuse_gevelkade_sneeuw_links', prefabs, tiles)
    edge = Image.new('RGB', (16, 8))
    edge.paste(snow.crop((8, 1, 24, 3)), (0, 6))
    results['berm_sneeuwrand'] = (edge, 'Besneeuwde bermrand')
    report['assets']['berm_sneeuwrand'] = {'reused_prefab': 'reuse_gevelkade_sneeuw_links',
                                        'reused_crop': [8, 1, 24, 3], 'size': [16, 8],
                                        'drawing_size': [16, 2]}

    for name, (image, label) in results.items():
        assert set(image.get_flattened_data()) <= set(palette), name
        assert all(len({image.getpixel((x + dx, y)) for dx in range(8)}) <= 2
                   for y in range(image.height) for x in range(0, image.width, 8)), name
        image.save(ART / (name + '.png'))
        report['assets'][name].update(max_colors_per_8x1=2, brown_pixels=0,
                                      visible_bounds=list(image.getbbox()), stage_symbol=' ')
        if name in WOOD_NAMES:
            assert wood_color(originals[name]).tobytes() == image.tobytes()
            wood_proof['assets'][name] = dict(wood_sources[name],
                changed_pixels=sum(p == WOOD_GRAY for p in originals[name].get_flattened_data()),
                only_exact_gray_changed=True, snow_and_dimensions_unchanged=True)
        poses = greenery_poses(name, image)
        if poses:
            for stale in ART.glob(name + '_wind_*.png'):
                stale.unlink()
            for i, pose in enumerate(poses):pose.save(ART / (name + f'_wind_{i}.png'))
        if name in TREE_BRANCHES:
            rigid = image.convert('L').point(lambda ink: 255 if ink else 0)
            draw_rigid = ImageDraw.Draw(rigid)
            for _, rectangles, extra in TREE_BRANCHES[name]:
                for left, top, right, bottom in rectangles:
                    draw_rigid.rectangle((left, top, right-1, bottom-1), fill=0)
                for point in extra:rigid.putpixel(point, 0)
            rigid.save(ART / ('rigid_' + name + '.png'))
    (ART / 'controle.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

    preview = Image.new('RGB', (960, 760), '#101923')
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=15)
    small = ImageFont.load_default(size=12)
    draw.text((24, 18), 'Stadsburg R27 · donkerrood hout en wintergroen', font=font, fill='#eef3f3')
    for index, (name, (image, label)) in enumerate(results.items()):
        x, y = 24 + (index % 3) * 312, 62 + (index // 3) * 224
        draw.text((x, y), label, font=font, fill='#eef3f3')
        bounds = image.getbbox()
        draw.text((x, y + 23), f'Zichtbaar {bounds[2]-bounds[0]} × {bounds[3]-bounds[1]} px',
                  font=small, fill='#b6cbd2')
        scale = min(5, 158 // image.height)
        preview.paste(image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST),
                      (x, y + 54))
        preview.paste(image, (x + 246 - image.width, y + 54))
    preview.save(ART / 'native_overzicht.png')
    if args.preview_only:
        print(json.dumps({'preview_only': True, 'assets': report['assets']}, indent=2))
        return

    pixels = {(image.tobytes(), entries[tile_id]['stage_symbol']): tile_id
              for tile_id, image in tiles.items()}
    next_id = max(entries) + 1
    all_results = dict(results)
    for name in ('compact_winterlinde', 'compact_tree_socket_gevelkade'):
        all_results[name] = (wood_color(originals[name]), prefabs[name]['label'])
        wood_proof['assets'][name] = dict(wood_sources[name],
            changed_pixels=sum(p == WOOD_GRAY for p in originals[name].get_flattened_data()),
            only_exact_gray_changed=True, snow_and_dimensions_unchanged=True)
    for name, (image, label) in all_results.items():
        old_rows = wood_sources[name]['source_tiles'] if name in ('compact_winterlinde', 'compact_tree_socket_gevelkade') else None
        rows = [[None] * (image.width // 8) for _ in range(image.height // 8)]
        for y, row in enumerate(rows):
            for x in range(len(row)):
                tile = image.crop((x * 8, y * 8, x * 8 + 8, y * 8 + 8))
                if not tile.getbbox() and (old_rows is None or old_rows[y][x] is None):
                    continue
                symbol = entries[old_rows[y][x]]['stage_symbol'] if old_rows is not None and old_rows[y][x] is not None else ' '
                key = (tile.tobytes(), symbol)
                if key not in pixels:
                    tile_id = next_id
                    next_id += 1
                    entry = {'id': tile_id, 'name': f'{name}_{y:02}_{x:02}',
                             'asset': f'nls_{tile_id:04}', 'image': f'res/img/nls_{tile_id:04}@atlas=gameplay.png',
                             'category': 'stadsgroen', 'stage_symbol': symbol}
                    if name in WOOD_NAMES:
                        entry['source_tile'] = wood_sources[name]['source_tiles'][y][x]
                        entry['recolor'] = {'#a0a0a0': '#a02020'}
                    tile.save(ROOT / entry['image'])
                    catalog['tiles'].append(entry)
                    pixels[key] = tile_id
                row[x] = pixels[key]
        if old_rows is not None:
            prefabs[name]['tiles'] = rows
            prefabs[name]['description'] = label + ', bestaand raster met donkerrood hout; sneeuw blijft behouden.'
        else:
            prefabs[name] = {'description': label + ', op de bestaande stadsschaal; groene kroonranden kunnen subtiel bewegen.',
                             'tiles': rows, 'label': label, 'groep': 'stadsgroen'}
        if name in WOOD_NAMES:wood_proof['assets'][name]['registered_tiles'] = rows
    catalog_path.write_text(yaml.safe_dump(catalog, sort_keys=False, allow_unicode=True, width=120))
    prefab_path.write_text(yaml.safe_dump(prefab_data, sort_keys=False, allow_unicode=True, width=120))
    (ART / 'houtkleur.json').write_text(json.dumps(wood_proof, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'registered': list(results), 'new_tiles': next_id - max(entries) - 1}, indent=2))


if __name__ == '__main__':
    main()
