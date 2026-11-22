"""Cook indexed water strips and their tile-bank poses into a stage tape."""

import struct


WATER_CELL_BIT = 0x8000
STRIP_WIDTH = 4
POSE_COUNT = 8
HEADER = struct.Struct('<IIIiHH')


def write_water_tape(data, spec, rows, harbor):
    origin = spec['origin_column']
    phase_offsets = spec['phase_offsets']
    families = spec['tile_families']
    strips = {}
    for y in range(spec['first_row'] - 1, len(rows)):
        for x, tile in enumerate(rows[y]):
            if tile and (family := families[tile - 1]):
                if x + 1 in harbor[y]:
                    raise ValueError(f"Water and harbor share terrain cell {(x + 1, y + 1)}")
                strip = (x - origin) // STRIP_WIDTH
                phase = (family - 1) * POSE_COUNT + phase_offsets[strip % POSE_COUNT]
                strips.setdefault(strip, []).append((x + 1, y + 1, phase))

    start = len(data)
    data.extend(bytes(HEADER.size))
    first = min(strips, default=0)
    last = max(strips, default=-1)
    row_cells = [{} for _ in rows]
    cells = len(data)
    entries = []
    index = 0
    for strip in range(first, last + 1):
        entries.append(index)
        for x, y, phase in strips.get(strip, ()):
            if index >= WATER_CELL_BIT:
                raise ValueError('Water cells exceed the stage tape selector range')
            row_cells[y - 1][x] = WATER_CELL_BIT | index
            data.extend(struct.pack('<HHH', x, y, phase))
            index += 1
    directory = len(data)
    data.extend(struct.pack('<' + 'H' * (len(entries) + 1), *entries, index))
    frames = len(data)
    for poses in spec['frames']:
        data.extend(struct.pack('<8H', *poses))
    HEADER.pack_into(data, start, directory, cells, frames, origin + first * STRIP_WIDTH + 1,
                     len(entries), spec['ticks_per_pose'])
    return start, row_cells
