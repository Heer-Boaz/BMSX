"""Compile sparse ROM rows, collision words and encounter cues from one map."""

import struct

ACTOR_SYMBOLS = {
    'formation_down': 'p', 'formation_up': 'P', 'red_mitre': 'M',
    'blue_mitre': 'm', 'chimney': 'S', 'smoke': 'R', 'quay_cannon': 'D',
    'turret_blue_floor': 'B', 'turret_red_floor': 'C',
    'turret_blue_ceiling': 'b', 'turret_red_ceiling': 'c',
    'sack': 'Z', 'snowman': 'N', 'bell': 'K', 'mill': 'W', 'moon': "'",
}


def compile_actor_cells(rows, roles):
    actor_roles = {ord(symbol) for symbol in ACTOR_SYMBOLS.values()}
    cells = []
    # Match stage admission order, including ties within each column.
    for x in range(len(rows[0])):
        for y, row in enumerate(rows):
            tile_id = row[x]
            if tile_id:
                role = roles[tile_id - 1]
                if role in actor_roles:
                    cells.append([x + 1, y + 1, role])
    return cells


def compile_actor_cues(rows, roles):
    cues = [(x - (2 if role == ord('S') else 1), y, role)
            for x, y, role in compile_actor_cells(rows, roles)]
    # Chimneys enter a column early. Stable sorting preserves source column
    # and row order between encounters assigned to the same admission column.
    return sorted(cues, key=lambda cue: cue[0])


# Stage-local ROM data, not a machine image format. All offsets are bytes from
# the asset base; row directories contain (offset, count), then u16 cell pairs.
TAPE_HEADER_WORDS = 12
SOLID_ROLES = {ord(symbol) for symbol in '!#%()+-=@RS^_dsw'}


def compile_collision_words(rows, roles):
    width = len(rows[0])
    packed = []
    for row in rows:
        words = [0] * ((width + 31) // 32)
        for x, tile in enumerate(row):
            if not tile:
                continue
            role = roles[tile - 1]
            left = roles[row[x - 1] - 1] if x and row[x - 1] else 0
            right = roles[row[x + 1] - 1] if x + 1 < width and row[x + 1] else 0
            if role == 116:
                solid = right != 49 if 49 <= right <= 55 else 50 <= left <= 55
            elif 49 <= role <= 54:
                solid = left == 116
            else:
                solid = role in SOLID_ROLES
            if solid:
                words[x // 32] |= 1 << (x & 31)
        packed.append(words)
    return packed


def compile_stage_tape(stage):
    rows, assets = stage['tile_ids'], stage['tile_assets']
    width, height = len(rows[0]), len(rows)
    invisible = set(stage['sky_actor_ids'])
    foreground = [[(x + 1, assets[tile - 1]) for x, tile in enumerate(row)
                   if tile and tile not in invisible] for row in rows]
    backdrop = stage['background']
    background = [[(row[i], backdrop['tile_assets'][row[i + 1] - 1])
                   for i in range(0, len(row), 2)] for row in backdrop['rows']]
    data = bytearray(TAPE_HEADER_WORDS * 4)

    def write_rows(sparse_rows):
        directory = len(data)
        data.extend(bytes(len(sparse_rows) * 8))
        for index, row in enumerate(sparse_rows):
            struct.pack_into('<II', data, directory + index * 8, len(data), len(row))
            for column, cell in row:
                data.extend(struct.pack('<HH', column, cell))
        return directory

    front_offset = write_rows(foreground)
    back_offset = write_rows(background)
    collision_offset = len(data)
    for row in compile_collision_words(rows, stage['tile_roles']):
        data.extend(struct.pack('<' + 'I' * len(row), *row))
    water_offset = len(data)
    water = stage['water_animation']
    families = water['tile_families']
    water_count = 0
    for y in range(water['first_row'] - 1, height):
        for x, tile in enumerate(rows[y]):
            if tile and families[tile - 1]:
                data.extend(struct.pack('<HHH', x + 1, y + 1, families[tile - 1]))
                water_count += 1
    # The encounter array uses word-aligned (signed column, row, role) records.
    data.extend(bytes(-len(data) % 4))
    actor_offset = len(data)
    actors = compile_actor_cues(rows, stage['tile_roles'])
    for column, row, role in actors:
        data.extend(struct.pack('<iHH', column, row, role))
    struct.pack_into('<12I', data, 0, width, height, front_offset, back_offset,
                     len(background), collision_offset, (width + 31) // 32,
                     water_offset, water_count, actor_offset, len(actors), len(data))
    return bytes(data)


def stage_runtime_config(stage):
    """Small control data derived from the same map; no second authored map."""
    config = {key: value for key, value in stage.items() if key not in {
        'source', 'tile_ids', 'tile_assets', 'tile_roles', 'sky_actor_ids', 'actor_cells',
    }}
    config['background'] = {key: value for key, value in stage['background'].items()
                            if key not in {'tile_assets', 'rows'}}
    config['water_animation'] = {key: value for key, value in stage['water_animation'].items()
                                if key not in {'tile_families', 'first_row'}}
    return config
