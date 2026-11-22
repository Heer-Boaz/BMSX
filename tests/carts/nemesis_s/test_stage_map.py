import sys
import struct
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/nemesis_s/stadsburg'))
from stage_map import compile_actor_cells, compile_actor_cues


class StageMapTest(unittest.TestCase):
    def test_baked_index_matches_the_numeric_source_map(self):
        stage = yaml.safe_load((ROOT / 'carts/nemesis_s/res/data/nemesis_s_stage.yaml').read_text())
        self.assertEqual(stage['actor_cells'], compile_actor_cells(stage['tile_ids'], stage['tile_roles']))

    def test_column_admission_and_row_ties(self):
        roles = [ord('#'), ord('S'), ord('m'), ord('p'), ord(' ')]
        rows = [[3, 0, 2], [4, 1, 5], [2, 4, 3]]
        self.assertEqual(compile_actor_cells(rows, roles), [
            [1, 1, ord('m')], [1, 2, ord('p')], [1, 3, ord('S')],
            [2, 3, ord('p')], [3, 1, ord('S')], [3, 3, ord('m')],
        ])

    def test_all_stage_actor_roles_and_absent_tiles(self):
        markers = "pPMmSRDBCbcZNKW'"
        roles = [ord(symbol) for symbol in '# ?' + markers]
        rows = [[0, 1, 2, 3] + list(range(4, len(roles) + 1))]
        self.assertEqual(compile_actor_cells(rows, roles), [
            [index + 5, 1, ord(symbol)] for index, symbol in enumerate(markers)
        ])

    def test_encounter_admission_moves_chimneys_earlier_without_reordering_ties(self):
        # A chimney in the first column is valid; another chimney joins the
        # first column's ordinary encounters without moving ahead of them.
        roles = list(map(ord, 'mSpK'))
        rows = [[2, 3, 2, 4], [1, 2, 4, 0], [3, 1, 0, 0]]
        self.assertEqual(compile_actor_cues(rows, roles), [
            (-1, 1, ord('S')), (0, 2, ord('m')), (0, 3, ord('p')),
            (0, 2, ord('S')), (1, 1, ord('p')), (1, 3, ord('m')),
            (1, 1, ord('S')), (2, 2, ord('K')), (3, 1, ord('K')),
        ])

class StageTapeTest(unittest.TestCase):
    def test_sparse_cells_collision_and_water_match_the_authored_map(self):
        from stage_map import compile_stage_tape, compile_collision_words, stage_runtime_config
        path = ROOT / 'carts/nemesis_s/res/data'
        stage = yaml.safe_load((path / 'nemesis_s_stage.yaml').read_text())
        blob = (path / 'nemesis_s_stage_tape.bin').read_bytes()
        self.assertEqual(blob, compile_stage_tape(stage))
        width, height, front, back, back_rows, collision, words, water, actors, actor_count, _, length = struct.unpack_from('<12I', blob)
        self.assertEqual((width, height, length), (len(stage['tile_ids'][0]), len(stage['tile_ids']), len(blob)))
        invisible = set(stage['sky_actor_ids'])
        harbor = stage['harbor_animation']
        initial = [{} for _ in range(height)]
        for clip in harbor['clips']:
            for i, (x, y, _, rest, *_) in enumerate(clip['cells']):
                if 'visuals' in clip:
                    tile = clip['visuals'][i][0] or harbor['empty']
                elif rest == 0:
                    tile = harbor['empty']
                else:
                    continue
                initial[y - 1][x] = tile
        spec = stage['water_animation']
        families = spec['tile_families']
        origin = spec['origin_column']
        expected_water = {}
        for y, row in enumerate(stage['tile_ids'], 1):
            for x, tile in enumerate(row, 1):
                if y >= spec['first_row'] and tile and (family := families[tile - 1]):
                    strip = (x - 1 - origin) // 4
                    phase = (family - 1) * 8 + spec['phase_offsets'][strip % 8]
                    expected_water.setdefault(strip, []).append((x, y, phase))
        directory, cells, poses, first, count, hold = struct.unpack_from('<IIIiHH', blob, water)
        self.assertEqual(first, origin + min(expected_water) * 4 + 1)
        self.assertEqual(count, max(expected_water) - min(expected_water) + 1)
        self.assertEqual(hold, spec['ticks_per_pose'])
        self.assertEqual([list(struct.unpack_from('<8H', blob, poses + index * 16))
                          for index in range(len(spec['frames']))], spec['frames'])
        index = 0
        selectors = [{} for _ in range(height)]
        for strip in range(count):
            begin, end = struct.unpack_from('<HH', blob, directory + strip * 2)
            expected = expected_water.get(strip + min(expected_water), [])
            self.assertEqual((begin, end), (index, index + len(expected)))
            for cell_index, (x, y, _) in enumerate(expected, begin):
                selectors[y - 1][x] = 0x8000 | cell_index
            self.assertEqual([struct.unpack_from('<HHH', blob, cells + i * 6)
                              for i in range(begin, end)], expected)
            index = end

        for y, row in enumerate(stage['tile_ids']):
            offset, size = struct.unpack_from('<II', blob, front + y * 8)
            actual = [struct.unpack_from('<HH', blob, offset + i * 4) for i in range(size)]
            expected = {x + 1: stage['tile_assets'][tile - 1] for x, tile in enumerate(row) if tile and tile not in invisible}
            expected.update(initial[y])
            expected.update(selectors[y])
            self.assertEqual(actual, sorted(expected.items()))
        self.assertEqual(back_rows, len(stage['background']['rows']))
        for y, row in enumerate(stage['background']['rows']):
            offset, size = struct.unpack_from('<II', blob, back + y * 8)
            self.assertEqual([struct.unpack_from('<HH', blob, offset + i * 4) for i in range(size)],
                             [(row[i], stage['background']['tile_assets'][row[i + 1] - 1]) for i in range(0, len(row), 2)])
        for y, row in enumerate(compile_collision_words(stage['tile_ids'], stage['tile_roles'])):
            self.assertEqual(list(struct.unpack_from('<' + 'I' * words, blob, collision + y * words * 4)), row)
        self.assertEqual(actors % 4, 0)
        self.assertEqual(actors + actor_count * 8, length)
        self.assertEqual([struct.unpack_from('<iHH', blob, actors + i * 8) for i in range(actor_count)],
                         compile_actor_cues(stage['tile_ids'], stage['tile_roles']))
        self.assertEqual(yaml.safe_load((path / 'nemesis_s_stage_runtime.yaml').read_text()), stage_runtime_config(stage))
        self.assertNotIn('actor_cells', stage_runtime_config(stage))
        self.assertNotIn('harbor_animation', stage_runtime_config(stage))
        self.assertNotIn('water_animation', stage_runtime_config(stage))

    def test_harbor_tape_matches_authored_pose_collision_and_damage_roles(self):
        path = ROOT / 'carts/nemesis_s/res/data'
        stage = yaml.safe_load((path / 'nemesis_s_stage.yaml').read_text())
        blob = (path / 'nemesis_s_stage_tape.bin').read_bytes()
        _, height, _, _, _, collision, words, *_, harbor, _ = struct.unpack_from('<12I', blob)
        spec = stage['harbor_animation']
        index, count, transparent = struct.unpack_from('<IHH', blob, harbor)
        self.assertEqual((count, transparent), (len(spec['clips']), spec['empty']))
        self.assertEqual((harbor & 3, index & 3), (0, 0))

        # Reconstruct the former role latch from the real stage rest bits.
        # Nonzero patterns without a rest occurrence (the hook) were solid.
        solid = {0: False}
        for clip in spec['clips']:
            for x, y, moves, rest, *_ in clip['cells']:
                if moves:
                    offset = collision + ((y - 1) * words + (x - 1) // 32) * 4
                    word, = struct.unpack_from('<I', blob, offset)
                    solid[rest] = bool(word & 1 << ((x - 1) & 31))
        self.assertNotIn(117, solid)

        cargo_rows = [[] for _ in range(height)]
        cargo_patterns = set(spec['cargo_patterns'])
        special = set()
        for clip_index, clip in enumerate(spec['clips']):
            coords, steps, poses, start, end, cells, cues, health, once = struct.unpack_from(
                '<IIIii4H', blob, harbor + 8 + clip_index * 28)
            self.assertEqual((start, end, cells, cues, health, once),
                             (clip['start'], clip['end_column'], len(clip['cells']), len(clip['steps']),
                              clip.get('max_health', 0), int(clip['once'])))
            self.assertEqual([struct.unpack_from('<HH', blob, steps + i * 4) for i in range(cues)],
                             [(pose - 1, hold) for pose, hold in clip['steps']])
            for cell_index, (x, y, moves, *frames) in enumerate(clip['cells']):
                self.assertEqual(struct.unpack_from('<HH', blob, coords + cell_index * 4), (x, y))
                if health and moves and cargo_patterns.intersection(frames):
                    cargo_rows[y - 1].append((x, clip_index, cell_index))
                for pose, pattern in enumerate(frames):
                    effective = (clip['visuals'][cell_index][pose] if 'visuals' in clip else
                                 spec['patterns'][pattern - 1] if pattern else 0)
                    art, flags = struct.unpack_from('<HH', blob, poses + (pose * cells + cell_index) * 4)
                    self.assertEqual(art, effective or transparent)
                    self.assertEqual(bool(flags & 1), bool(moves) and solid.get(pattern, True))
                    self.assertEqual(bool(flags & 2), pattern in cargo_patterns)
                    self.assertEqual(bool(flags & 4), bool(moves))
                    if moves and pattern in (0, 117):
                        special.add((pattern, flags))
        self.assertEqual(special, {(0, 4), (117, 5)})
        self.assertEqual(sum(len(row) for row in cargo_rows), 54)
        for y, expected in enumerate(cargo_rows):
            offset, size = struct.unpack_from('<II', blob, index + y * 8)
            self.assertEqual([struct.unpack_from('<HHH', blob, offset + i * 6) for i in range(size)], sorted(expected))

    def test_collision_roles_and_tree_neighbor_precedence(self):
        from stage_map import compile_collision_words
        for role in range(128):
            actual = compile_collision_words([[1]], [role])[0][0]
            self.assertEqual(actual, int(chr(role) in '!#%()+-=@RS^_dsw'))
        for left in range(128):
            for right in range(128):
                roles = [left, 116, right]
                expected = right != 49 if 49 <= right <= 55 else 50 <= left <= 55
                self.assertEqual(bool(compile_collision_words([[1, 2, 3]], roles)[0][0] & 2), expected)
                for center in range(49, 56):
                    roles[1] = center
                    self.assertEqual(bool(compile_collision_words([[1, 2, 3]], roles)[0][0] & 2), left == 116 and center != 55)

if __name__ == '__main__':
    unittest.main()
