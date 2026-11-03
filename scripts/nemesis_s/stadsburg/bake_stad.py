#!/usr/bin/env python3
"""Import street source art and native pixel drawings into the shared MSX tiles."""
from argparse import ArgumentParser
from collections import Counter
from functools import lru_cache
from itertools import combinations
from pathlib import Path
import json

import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3] / 'carts/nemesis_s'
ART = ROOT / 'authoring/stad'
BROWN = (185, 122, 87)
GRAY = (160, 160, 160)


def lab(rgb):
    r,g,b=[v/255/12.92 if v/255<=0.04045 else ((v/255+0.055)/1.055)**2.4 for v in rgb]
    xyz=((0.4124564*r+0.3575761*g+0.1804375*b)/0.95047,
         0.2126729*r+0.7151522*g+0.0721750*b,
         (0.0193339*r+0.1191920*g+0.9503041*b)/1.08883)
    x,y,z=[v**(1/3) if v>(6/29)**3 else v/(3*(6/29)**2)+4/29 for v in xyz]
    return (116*y-16,500*(x-y),200*(y-z))


def recolor(image):
    """Map only visible exact brown RGB; preserve dimensions and every alpha."""
    result = image.convert('RGBA' if 'A' in image.getbands() or image.mode == 'P' else 'RGB')
    result.putdata([GRAY + pixel[3:] if pixel[:3] == BROWN and
                    (len(pixel) == 3 or pixel[3] > 0) else pixel
                    for pixel in result.get_flattened_data()])
    return result


def legacy_sampling_rgb(palette):
    """Keep the source art's quantization boundaries before the exact recolor."""
    result = list(palette)
    assert len(result) == 15 and result[13] == GRAY
    assert result[12] in (BROWN, GRAY)
    result[12] = BROWN
    return result


def sample(source, box, size, palette):
    image = source.crop(box).resize(size, Image.Resampling.NEAREST).convert('RGB')
    colors = [lab(rgb) for rgb in palette]
    distances = [[sum((a[i] - b[i]) ** 2 for i in range(3)) for b in colors] for a in colors]

    @lru_cache(maxsize=None)
    def index(rgb):
        if max(rgb) <= 32:
            return 0
        point = lab(rgb)
        return min(range(len(palette)), key=lambda n: sum((colors[n][i] - point[i]) ** 2 for i in range(3)))

    native = Image.new('RGB', size)
    native.putdata([palette[index(rgb)] for rgb in image.get_flattened_data()])
    return native, distances


def restrict_rows(image, palette, distances, rim_rows=0, keep_pixels=()):
    indices = {rgb: i for i, rgb in enumerate(palette)}
    result = image.copy()
    for y in range(image.height):
        for x in range(0, image.width, 8):
            row = [indices[image.getpixel((x + dx, y))] for dx in range(8)]
            count = Counter(row)
            if len(count) <= 2:
                continue
            required = {0} if 0 in count else set()
            required.update(indices[image.getpixel((px, py))] for px, py in keep_pixels
                            if py == y and x <= px < x + 8)
            # Rims come from the source drawing. Keep their sampled grey ink
            # in the lower wheel rows when the two-ink budget forces a choice.
            if y >= image.height - rim_rows:
                greys = [c for c in count if c and max(palette[c]) - min(palette[c]) < 12]
                if greys:
                    required.add(max(greys, key=count.get))
            pairs = [pair for pair in combinations(count, 2) if required.issubset(pair)]
            chosen = min(pairs, key=lambda pair: sum(n * min(distances[color][i] for i in pair)
                                                   for color, n in count.items()))
            for dx, color in enumerate(row):
                ink = min(chosen, key=lambda n: distances[color][n])
                result.putpixel((x + dx, y), palette[ink])
    return result


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
    palette = legacy_sampling_rgb([tuple(bytes.fromhex(c[1:])) for c in catalog['palette']])
    entries = {e['id']: e for e in catalog['tiles']}
    tiles = {i: Image.open(ROOT / e['image']).convert('RGB') for i, e in entries.items()}
    source = Image.open(ART / 'straatdetails_bron.png')
    shop_source = Image.open(ART / 'winkelpuien_bron.png')
    results = {}
    report = {'source': ['straatdetails_bron.png', 'winkelpuien_bron.png'], 'assets': {}}

    for item in spec['props']:
        image = Image.new('RGB', item['size'])
        if item.get('silhouette'):
            raw = np.asarray(source.crop(item['crop']).convert('RGB')).astype(int)
            low, high = raw.min(2), raw.max(2)
            neutral = (high - low < 45) & (high > 64)
            colored = (high > 48) & ~neutral
            rims = Image.fromarray((neutral * 255).astype('uint8')).resize(item['drawing_size'], Image.Resampling.BOX)
            frame = Image.fromarray((colored * 255).astype('uint8')).resize(item['drawing_size'], Image.Resampling.BOX)
            # Thin grey rims survive at lower coverage than the broad colored
            # chain case. Both masks are measured directly from source pixels.
            occupied = ((np.asarray(rims) >= item['rim_coverage']) |
                        (np.asarray(frame) >= item['frame_coverage']))
            mask = Image.fromarray((occupied * 255).astype('uint8'))
            drawing = Image.new('RGB', item['drawing_size'], (160, 160, 160))
            image.paste(drawing, ((image.width - drawing.width) // 2, image.height - drawing.height), mask)
        else:
            drawing, distances = sample(source, item['crop'], tuple(item['drawing_size']), palette)
            if 'rim_coverage' in item:
                raw = np.asarray(source.crop(item['crop']).convert('RGB')).astype(int)
                rims = (raw.max(2) - raw.min(2) < 45) & (raw.max(2) > 64)
                coverage = Image.fromarray((rims * 255).astype('uint8')).resize(item['drawing_size'], Image.Resampling.BOX)
                for x in range(drawing.width):
                    if coverage.getpixel((x, drawing.height - 1)) >= item['rim_coverage']:
                        drawing.putpixel((x, drawing.height - 1), (160, 160, 160))
            image.paste(drawing, ((image.width - drawing.width) // 2, image.height - drawing.height))
            image = restrict_rows(image, palette, distances, rim_rows=3)
        results[item['name']] = (recolor(image), item, None)

    for item in spec['shops']:
        rows = prefabs[item['base']]['tiles']
        image = Image.new('RGB', (len(rows[0]) * 8, len(rows) * 8))
        for y, row in enumerate(rows):
            for x, tile in enumerate(row):
                if tile is not None:
                    image.paste(tiles[tile], (x * 8, y * 8))
        front_height = item.get('facade_height', 16)
        front_y = image.height - 8 - front_height
        front, distances = sample(shop_source, item['crop'], (32, front_height), palette)
        front = restrict_rows(front, palette, distances)
        image.paste(front, (0, front_y))
        results[item['name']] = (recolor(image), item, front_y // 8)

    native_palette = {tuple(bytes.fromhex(color[1:])) for color in catalog['palette']}
    for item in spec.get('native', []):
        image = Image.open(ROOT / item['source']).convert('RGB')
        assert image.width % 8 == 0 and image.height % 8 == 0, item['name']
        assert set(image.get_flattened_data()) <= native_palette, item['name']
        results[item['name']] = (image, item, None)
        report['source'].append(item['source'])

    for name, (image, item, changed_row) in results.items():
        image.save(ART / (name + '.png'))
        assert all(len({image.getpixel((x + dx, y)) for dx in range(8)}) <= 2
                   for y in range(image.height) for x in range(0, image.width, 8))
        report['assets'][name] = {'size': list(image.size), 'drawing_size': item.get('drawing_size',list(image.size)),
                                  'max_colors_per_8x1': 2}
        if 'source' in item:
            report['assets'][name]['source'] = item['source']
        else:
            report['assets'][name]['source_crop'] = item['crop']
        if item.get('silhouette'):
            report['assets'][name].update(source_silhouette=True, rim_coverage=item['rim_coverage'],
                                          frame_coverage=item['frame_coverage'])
        if changed_row is not None:
            rows = prefabs[item['base']]['tiles']
            for y, row in enumerate(rows):
                if changed_row <= y < changed_row + 2:
                    continue
                for x, tile in enumerate(row):
                    original = tiles[tile] if tile is not None else Image.new('RGB', (8, 8))
                    assert image.crop((x * 8, y * 8, x * 8 + 8, y * 8 + 8)).tobytes() == original.tobytes()
            report['assets'][name].update(base=item['base'], replacement_rows=[changed_row, changed_row + 1],
                                          other_rows_pixel_identical=True)

    preview = Image.new('RGB', (864, 672), (17, 23, 32))
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=14)
    for i, item in enumerate(spec['props']):
        image = results[item['name']][0]
        x, y = 24 + (i % 3) * 280, 16 + (i // 3) * 112
        draw.text((x, y), item['label'] + f'  {image.width}×{image.height}', font=font, fill='white')
        preview.paste(image.resize((image.width * 8, image.height * 8), Image.Resampling.NEAREST), (x, y + 24))
    for i, item in enumerate(spec['shops']):
        image = results[item['name']][0]
        x, y = 24 + i * 280, 264
        draw.text((x, y), item['label'] + f'  {image.width}×{image.height}', font=font, fill='white')
        preview.paste(image.resize((image.width * 5, image.height * 5), Image.Resampling.NEAREST), (x, y + 24))
        preview.paste(image, (x + 184, y + 24))
    preview.save(ART / 'native_overzicht.png')
    (ART / 'controle.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    if args.preview_only:
        print(json.dumps({'preview_only': True, 'assets': report['assets']}, indent=2))
        return

    pixels = {(image.tobytes(), entries[i]['stage_symbol']): i for i, image in tiles.items()}
    next_id = max(entries) + 1
    for name, (image, item, changed_row) in results.items():
        if changed_row is None:
            rows = [[None] * (image.width // 8) for _ in range(image.height // 8)]
            yrows = range(image.height // 8)
        else:
            rows = [list(row) for row in prefabs[item['base']]['tiles']]
            yrows = range(changed_row, changed_row + 2)
        for y in yrows:
            for x in range(image.width // 8):
                tile = image.crop((x * 8, y * 8, x * 8 + 8, y * 8 + 8))
                if not tile.getbbox() and changed_row is None:
                    continue
                symbol = '#'
                key = tile.tobytes(), symbol
                if key not in pixels:
                    tile_id = next_id
                    next_id += 1
                    entry = {'id': tile_id, 'name': f'{name}_{y:02}_{x:02}',
                             'asset': f'nls_{tile_id:04}', 'image': f'res/img/nls_{tile_id:04}@atlas=gameplay.png',
                             'category': 'town', 'stage_symbol': symbol}
                    tile.save(ROOT / entry['image'])
                    catalog['tiles'].append(entry)
                    pixels[key] = tile_id
                rows[y][x] = pixels[key]
        description = (item['label'] + ', rechtstreeks uit de native pixelbron.' if 'source' in item
                       else item['label'] + ', uit de gegenereerde bron naar native pixels vertaald.')
        prefabs[name] = {'description': description,
                         'tiles': rows, 'label': item['label'],
                         'groep': item.get('group', 'winkels' if changed_row is not None else 'straatdetails')}
    catalog_path.write_text(yaml.safe_dump(catalog, sort_keys=False, allow_unicode=True, width=120))
    prefab_path.write_text(yaml.safe_dump(prefab_data, sort_keys=False, allow_unicode=True, width=120))
    print(json.dumps({'registered': list(results), 'new_tiles': next_id - max(entries) - 1}, indent=2))


if __name__ == '__main__':
    main()
