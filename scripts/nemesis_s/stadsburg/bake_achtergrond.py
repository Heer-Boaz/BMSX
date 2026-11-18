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
        assert pixels.shape[0] == 160 and pixels.shape[1] % 8 == 0, (name, pixels.shape)
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


def compile_background(root, plan, runtime, tiles, entries, cells):
    width, height = plan['width'], len(cells)
    original_roles = tuple(runtime['tile_roles'][k - 1] if k else 32
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
    # A single dark pixel separates distant blue planes from fixed foreground
    # edges. Moving cels cast no baked edge, so cargo and branches leave no
    # frozen outline behind when their pose changes or a load is destroyed.
    fixed_ink = np.any(stage != 0, axis=2)
    for clip in runtime['harbor_animation']['clips']:
        for cell in clip['cells']:
            x, y = cell[0] - 1, cell[1] - 1
            fixed_ink[y * 8:y * 8 + 8, x * 8:x * 8 + 8] = False
    adjacent = np.zeros_like(exterior)
    adjacent[1:] |= fixed_ink[:-1]
    adjacent[:-1] |= fixed_ink[1:]
    adjacent[:, 1:] |= fixed_ink[:, :-1]
    adjacent[:, :-1] |= fixed_ink[:, 1:]
    background[exterior & adjacent] = 0
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
    roles = list(runtime['tile_roles'])
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
            role = roles[original_id - 1]
            key = name, role
            if key not in variants:
                runtime['tile_assets'].append(name)
                roles.append(role)
                variants[key] = len(roles)
            runtime['tile_ids'][y][x] = variants[key]
            changed += 1
    runtime['tile_roles'] = roles
    assert original_roles == tuple(runtime['tile_roles'][k - 1] if k else 32
                                   for row in runtime['tile_ids'] for k in row)

    # Poses retain their native pattern identities, including damage and
    # collision ownership. Visual substitutions are resolved once at admission.
    harbor = runtime['harbor_animation']
    native_sources = {entry['asset']: key for key, entry in entries.items()}
    originals = {}
    for name in harbor['patterns']:
        if name in native_sources:
            originals[name] = np.asarray(tiles[native_sources[name]])
        else:
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
    # One bank-cell vocabulary covers every stage drawing. Semantic terrain
    # roles and cargo pattern indices stay separate from this visual identity.
    water = runtime['water_animation']
    water_names = list(water['frames'])
    water_family = {name: index + 1 for index, name in enumerate(water_names)}
    water['tile_families'] = [water_family.get(name, 0) for name in runtime['tile_assets']]
    required = list(runtime['tile_assets']) + harbor['patterns'] + [harbor['empty']]
    required += [name for frames in water['frames'].values() for name in frames]
    required += [name for clip in harbor['clips'] for row in clip.get('visuals', []) for name in row if name]
    # Composites are opaque; native animation poses can contain transparent
    # texels. Preserve their alpha rather than treating black as transparency.
    new_assets = {name: np.asarray(Image.fromarray(pixels).convert('RGBA'))
                  for name, pixels in new_assets.items()}
    for name in required:
        if name in new_assets:
            continue
        path = (root / entries[native_sources[name]]['image'] if name in native_sources
                else root / 'res/img' / f'{name}@atlas=gameplay.png')
        pixels = np.asarray(Image.open(path).convert('RGBA'))
        assert pixels.shape == (8, 8, 4), name
        new_assets[name] = pixels

    bank_names, bank_ids, pixel_ids = [], {}, {}
    bank_image = None
    for name, pixels in new_assets.items():
        key = pixels.tobytes()
        if key in pixel_ids:
            bank_ids[name] = pixel_ids[key]
            continue
        index = len(pixel_ids)
        slot = index % 1024
        if not slot:
            if bank_image is not None:
                bank_image.save(root / 'res/img' / f'{bank_names[-1]}@atlas=gameplay.png')
            bank_names.append(f'achtergrond_bank_{len(bank_names)}')
            bank_image = Image.new('RGBA', (256, 256), (0, 0, 0, 255))
        bank_image.paste(Image.fromarray(pixels), ((slot % 32) * 8, (slot // 32) * 8))
        bank_ids[name] = pixel_ids[key] = index + 1
    bank_image.save(root / 'res/img' / f'{bank_names[-1]}@atlas=gameplay.png')
    # Exact RGBA identity preserves the RGB555 zero word and STP/mask decision.
    # Verify every input against its emitted cell, not just each unique bitmap.
    banks = [Image.open(root / 'res/img' / f'{name}@atlas=gameplay.png') for name in bank_names]
    for name, pixels in new_assets.items():
        index = bank_ids[name] - 1
        x, y = (index % 32) * 8, ((index % 1024) // 32) * 8
        assert banks[index // 1024].crop((x, y, x + 8, y + 8)).tobytes() == pixels.tobytes(), name
    runtime['tile_banks'] = {'assets': bank_names, 'tile_count': len(pixel_ids)}
    runtime['tile_assets'] = [bank_ids[name] for name in runtime['tile_assets']]
    runtime['background']['tile_assets'] = [bank_ids[name] for name in backdrop_assets]
    water['frames'] = [[bank_ids[name] for name in water['frames'][base]] for base in water_names]
    harbor['patterns'] = [bank_ids[name] for name in harbor['patterns']]
    harbor['empty'] = bank_ids[harbor['empty']]
    for clip in harbor['clips']:
        if 'visuals' in clip:
            clip['visuals'] = [[bank_ids[name] if name else 0 for name in row] for row in clip['visuals']]
    # Stage-only source drawings remain authored, but must not occupy a second
    # copy of the gameplay atlas beside their bank cells.
    archived = root / 'authoring/banked_tiles'
    archived.mkdir(exist_ok=True)
    for name in required:
        source = root / 'res/img' / f'{name}@atlas=gameplay.png'
        if source.exists():
            target = archived / source.name
            source.replace(target)
            if name in native_sources:
                entries[native_sources[name]]['image'] = target.relative_to(root).as_posix()
    for path in (root / 'res/img').glob('achtergrond_*@atlas=gameplay.png'):
        if path.name.split('@')[0] not in bank_names:
            path.unlink()
    preview = root / 'previews'
    Image.fromarray(background).save(preview / 'achtergrond_native.png')
    Image.fromarray(combined).save(preview / 'level_achtergrond_native.png')
    (preview / 'achtergrond_report.json').write_text(json.dumps({
        'scenes': plan['background']['scenes'],
        'background_assets': len(backdrop_assets), 'composite_assets': len(variants),
        'pattern_banks': len(bank_names), 'bank_patterns': len(pixel_ids),
        'composed_stage_cells': changed, 'composed_animation_cels': animated_composites,
        'native_roles_preserved': True, 'maximum_inks_per_8x1': 2,
    }, indent=2) + '\n')
