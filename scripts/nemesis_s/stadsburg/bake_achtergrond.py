"""Compose authored winter backdrops with Stadsburg's native character art.

Background pictures have no terrain roles. The original map and animation
symbols still own all collision and cargo state. Exterior black is found from
the genuinely empty map cells; enclosed windows and doors stay opaque. Where
foreground and background would require a third ink, the foreground row wins.
"""
from collections import deque
import json

import numpy as np
from PIL import Image


def draw_backdrop(root, spec, width, height):
    sources = {name: np.asarray(Image.open(root / path).convert('RGB'))
               for name, path in spec['sources'].items()}
    for name, pixels in sources.items():
        assert pixels.shape == (160, 512, 3), (name, pixels.shape)
        assert set(map(tuple, pixels.reshape(-1, 3))) <= {(0, 0, 0), (32, 32, 224)}, name
    result = np.zeros((height * 8, width * 8, 3), dtype=np.uint8)
    # Authored spans and repeat phases meet in dark gaps between complete
    # buildings. Preserve their native pixels through each scene boundary.
    scenes = spec['scenes']
    for index, scene in enumerate(scenes):
        start, end = scene['from'] * 8, scene['to'] * 8
        assert 0 <= start < end <= width * 8
        if index:
            assert scenes[index - 1]['to'] == scene['from']
        source = sources[scene['source']]
        columns = (np.arange(end - start) + scene['phase'] * 8) % source.shape[1]
        result[:160, start:end] = source[:, columns]
    return result


def exterior_black(pixels, empty_cells, edge_seeds=None):
    """Flood exterior black without treating black interiors as transparency."""
    h, w = pixels.shape[:2]
    available = np.all(pixels == 0, axis=2).reshape(-1)
    reached = np.zeros(h * w, dtype=bool)
    queue = deque()

    def seed(index):
        if available[index] and not reached[index]:
            reached[index] = True
            queue.append(index)

    for y, row in enumerate(empty_cells):
        for x, empty in enumerate(row):
            if empty:
                seed((y * 8 + 4) * w + x * 8 + 4)
    if edge_seeds is not None:
        for x in range(w):
            if edge_seeds[0, x]: seed(x)
            if edge_seeds[-1, x]: seed((h - 1) * w + x)
        for y in range(h):
            if edge_seeds[y, 0]: seed(y * w)
            if edge_seeds[y, -1]: seed(y * w + w - 1)
    while queue:
        p = queue.popleft()
        x = p % w
        if x and available[p - 1] and not reached[p - 1]: seed(p - 1)
        if x + 1 < w and available[p + 1] and not reached[p + 1]: seed(p + 1)
        if p >= w and available[p - w] and not reached[p - w]: seed(p - w)
        if p + w < h * w and available[p + w] and not reached[p + w]: seed(p + w)
    return reached.reshape(h, w)


def composite(foreground, background, exterior):
    result = foreground.copy()
    for y in range(8):
        row = np.where(exterior[y, :, None], background[y], foreground[y])
        if len(set(map(tuple, row))) <= 2:
            result[y] = row
    return result


def compile_background(root, plan, runtime, tiles, cells):
    width, height = plan['width'], len(cells)
    original_roles = ''.join(runtime['tile_symbols'][k - 1] if k else ' '
                             for row in runtime['tile_ids'] for k in row)
    background = draw_backdrop(root, plan['background'], width, height)
    stage = np.zeros_like(background)
    empty = np.zeros((height, width), dtype=bool)
    invisible = set(runtime['sky_actor_ids'])
    for y, row in enumerate(cells):
        for x, tile in enumerate(row):
            stage[y * 8:y * 8 + 8, x * 8:x * 8 + 8] = np.asarray(tiles[tile])
            empty[y, x] = runtime['tile_ids'][y][x] == 0 or runtime['tile_ids'][y][x] in invisible
    exterior = exterior_black(stage, empty)
    names = {}
    new_assets = {}

    def asset(pixels):
        key = pixels.tobytes()
        if key not in names:
            name = f'achtergrond_{len(names):04d}'
            names[key] = name
            new_assets[name] = pixels.copy()
        return names[key]

    def box(image, x, y):
        return image[y * 8:y * 8 + 8, x * 8:x * 8 + 8]

    backdrop_assets = []
    backdrop_ids = {}
    # Only occupied cells are decoded at admission: each row alternates its
    # one-based world column and a backdrop catalog ID.
    backdrop_rows = []
    for y in range(20):
        row = []
        for x in range(width):
            pixels = box(background, x, y)
            if not pixels.any():
                continue
            name = asset(pixels)
            if name not in backdrop_ids:
                backdrop_assets.append(name)
                backdrop_ids[name] = len(backdrop_assets)
            row.extend((x + 1, backdrop_ids[name]))
        backdrop_rows.append(row)
    runtime['background'] = {'tile_assets': backdrop_assets,
                             'rows': backdrop_rows,
                             'night_sky_height': plan['background']['night_sky_height'],
                             'star_spans': plan['background']['star_spans']}

    # Keep the original semantic IDs intact. Only the visible source for a
    # particular occurrence gains a composition; its native symbol is copied.
    symbols = list(runtime['tile_symbols'])
    variants = {}
    changed = 0
    combined = background.copy()
    for y in range(height):
        for x in range(width):
            original_id = runtime['tile_ids'][y][x]
            if not original_id or original_id in invisible:
                continue
            front = box(stage, x, y)
            pixels = composite(front, box(background, x, y), box(exterior, x, y))
            combined[y * 8:y * 8 + 8, x * 8:x * 8 + 8] = pixels
            if np.array_equal(front, pixels):
                continue
            name = asset(pixels)
            symbol = symbols[original_id - 1]
            key = name, symbol
            if key not in variants:
                runtime['tile_assets'].append(name)
                symbols.append(symbol)
                variants[key] = len(symbols)
            runtime['tile_ids'][y][x] = variants[key]
            changed += 1
    runtime['tile_symbols'] = ''.join(symbols)
    assert original_roles == ''.join(runtime['tile_symbols'][k - 1] if k else ' '
                                     for row in runtime['tile_ids'] for k in row)

    # Poses retain their native pattern identities, including damage and
    # collision ownership. Visual substitutions are resolved once at admission.
    harbor = runtime['harbor_animation']
    originals = {}
    for name in harbor['patterns']:
        path = root / 'res/img' / f'{name}@atlas=gameplay.png'
        originals[name] = np.asarray(Image.open(path).convert('RGB'))
    animated_composites = 0
    for clip in harbor['clips']:
        positions = [(cell[0] - 1, cell[1] - 1) for cell in clip['cells']]
        left = max(0, min(x for x, _ in positions) - 1)
        right = min(width, max(x for x, _ in positions) + 2)
        top = max(0, min(y for _, y in positions) - 1)
        bottom = min(height, max(y for _, y in positions) + 2)
        local_background = background[top * 8:bottom * 8, left * 8:right * 8]
        if not local_background.any():
            continue
        local_stage = stage[top * 8:bottom * 8, left * 8:right * 8]
        local_exterior = exterior[top * 8:bottom * 8, left * 8:right * 8]
        visual_rows = [[] for _ in positions]
        for pose in range(len(clip['cells'][0]) - 3):
            drawing = local_stage.copy()
            local_empty = empty[top:bottom, left:right].copy()
            for cell, (x, y) in zip(clip['cells'], positions):
                pattern = cell[pose + 3]
                pixels = originals[harbor['patterns'][pattern - 1]] if pattern else np.zeros((8, 8, 3), dtype=np.uint8)
                drawing[(y - top) * 8:(y - top + 1) * 8,
                        (x - left) * 8:(x - left + 1) * 8] = pixels
                local_empty[y - top, x - left] = pattern == 0
            outside = exterior_black(drawing, local_empty, local_exterior)
            for i, (cell, (x, y)) in enumerate(zip(clip['cells'], positions)):
                pattern = cell[pose + 3]
                if not pattern:
                    visual_rows[i].append(0)
                    continue
                name = harbor['patterns'][pattern - 1]
                back = box(background, x, y)
                if not back.any():
                    visual_rows[i].append(name)
                    continue
                pixels = composite(originals[name], back, box(outside, x - left, y - top))
                # RGB output also covers the blue background where a moving
                # twig's original transparent row already spends both inks.
                visual_rows[i].append(asset(pixels))
                animated_composites += 1
        clip['visuals'] = visual_rows
    for name, pixels in new_assets.items():
        assert all(len(set(map(tuple, row))) <= 2 for row in pixels), name
    # A native pattern bank holds exact 8x8 drawings in 32x32 slots. One image
    # resource per bank avoids retaining a ROM metadata object for every tiny
    # character. Native terrain and cargo pattern IDs stay independent.
    bank_names = []
    bank_ids = {}
    bank_image = None
    for index, (name, pixels) in enumerate(new_assets.items()):
        slot = index % 1024
        if not slot:
            if bank_image is not None:
                bank_image.save(root / 'res/img' / f'{bank_names[-1]}@atlas=gameplay.png')
            bank_names.append(f'achtergrond_bank_{len(bank_names)}')
            bank_image = Image.new('RGB', (256, 256))
        bank_image.paste(Image.fromarray(pixels), ((slot % 32) * 8, (slot // 32) * 8))
        bank_ids[name] = index + 1
    bank_image.save(root / 'res/img' / f'{bank_names[-1]}@atlas=gameplay.png')
    runtime['tile_banks'] = {'assets': bank_names, 'tile_count': len(new_assets)}
    runtime['tile_assets'] = [bank_ids.get(name, name) for name in runtime['tile_assets']]
    runtime['background']['tile_assets'] = [bank_ids[name] for name in backdrop_assets]
    for clip in harbor['clips']:
        if 'visuals' in clip:
            clip['visuals'] = [[bank_ids.get(name, name) for name in row]
                               for row in clip['visuals']]
    for path in (root / 'res/img').glob('achtergrond_*@atlas=gameplay.png'):
        if path.name.split('@')[0] not in bank_names:
            path.unlink()
    preview = root / 'previews'
    Image.fromarray(background).save(preview / 'achtergrond_native.png')
    Image.fromarray(combined).save(preview / 'level_achtergrond_native.png')
    (preview / 'achtergrond_report.json').write_text(json.dumps({
        'scenes': plan['background']['scenes'],
        'background_assets': len(backdrop_assets), 'composite_assets': len(variants),
        'pattern_banks': len(bank_names), 'bank_patterns': len(new_assets),
        'composed_stage_cells': changed, 'composed_animation_cels': animated_composites,
        'native_roles_preserved': True, 'maximum_inks_per_8x1': 2,
    }, indent=2) + '\n')
