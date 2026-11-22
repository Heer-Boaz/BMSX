"""Cook Stadsburg clip playback and cargo lookup into immutable tape records."""

import struct


HEADER = struct.Struct('<IHH')  # cargo row directory, clip count, transparent art
CLIP = struct.Struct('<IIIii4H')  # offsets, signed scroll interval, counts, health, once
SOLID, CARGO, COLLISION = 1, 2, 4


def write_harbor_tape(data, spec, rows, art, invisible, collision):
    clips = spec['clips']
    solids = {0: False}
    for clip in clips:
        for x, y, moves, rest, *_ in clip['cells']:
            if moves:
                solid = bool(collision[y - 1][(x - 1) // 32] & (1 << ((x - 1) & 31)))
                if solids.setdefault(rest, solid) != solid:
                    raise ValueError(f"Harbor pattern {rest} has conflicting rest collision at {(x, y)}")

    start = len(data)
    data.extend(bytes(HEADER.size + len(clips) * CLIP.size))
    initial = [{} for _ in rows]
    cargo_rows = [[] for _ in rows]
    cargo = set(spec['cargo_patterns'])
    empty = spec['empty']
    for clip_index, clip in enumerate(clips):
        cells, steps = clip['cells'], clip['steps']
        visuals = clip.get('visuals')
        health = clip.get('max_health', 0)
        cell_offset = len(data)
        for cell_index, (x, y, moves, rest, *poses) in enumerate(cells):
            row = initial[y - 1]
            if x in row:
                raise ValueError(f"Harbor clips share the same terrain cell {(x, y)}")
            initial_art = (visuals[cell_index][0] or empty if visuals is not None
                           else spec['patterns'][rest - 1] if rest else empty)
            # A non-composited clip already had its rest art on the map.
            if visuals is None and rest:
                tile = rows[y - 1][x - 1]
                if not tile or tile in invisible or art[tile - 1] != initial_art:
                    raise ValueError(f"Harbor clip {clip['label']} disagrees with the rest map at {(x, y)}")
            row[x] = initial_art
            data.extend(struct.pack('<HH', x, y))
            if health and moves and (rest in cargo or any(pose in cargo for pose in poses)):
                cargo_rows[y - 1].append((x, clip_index, cell_index))
        step_offset = len(data)
        for pose, ticks in steps:
            data.extend(struct.pack('<HH', pose - 1, ticks))
        pose_offset = len(data)
        for pose in range(len(cells[0]) - 3):
            for cell_index, cell in enumerate(cells):
                pattern = cell[pose + 3]
                tile = (visuals[cell_index][pose] or empty if visuals is not None
                        else spec['patterns'][pattern - 1] if pattern else empty)
                flags = CARGO if pattern in cargo else 0
                if cell[2]:
                    # Winch material first encountered away from rest is
                    # terrain, including the moving hook. Zero is empty.
                    flags |= COLLISION
                    if solids.get(pattern, True):
                        flags |= SOLID
                data.extend(struct.pack('<HH', tile, flags))
        CLIP.pack_into(data, start + HEADER.size + clip_index * CLIP.size,
                       cell_offset, step_offset, pose_offset, clip['start'],
                       clip['end_column'], len(cells), len(steps), health, int(clip['once']))

    directory = len(data)
    data.extend(bytes(len(rows) * 8))
    for index, row in enumerate(cargo_rows):
        struct.pack_into('<II', data, directory + index * 8, len(data), len(row))
        for entry in sorted(row):
            data.extend(struct.pack('<HHH', *entry))
    HEADER.pack_into(data, start, directory, len(clips), empty)
    return start, initial
