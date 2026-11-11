import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/nemesis_s/stadsburg'))
from stage_map import compile_actor_cells


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


class StageTapeTest(unittest.TestCase):
    def test_sparse_cells_collision_and_water_match_the_authored_map(self):
        import struct
        from stage_map import compile_stage_tape, compile_collision_words, stage_runtime_config
        path = ROOT / 'carts/nemesis_s/res/data'
        stage = yaml.safe_load((path / 'nemesis_s_stage.yaml').read_text())
        blob = (path / 'nemesis_s_stage_tape.bin').read_bytes()
        self.assertEqual(blob, compile_stage_tape(stage))
        width, height, front, back, back_rows, collision, words, water, count, length = struct.unpack_from('<10I', blob)
        self.assertEqual((width, height, length), (len(stage['tile_ids'][0]), len(stage['tile_ids']), len(blob)))
        invisible = set(stage['sky_actor_ids'])
        for y, row in enumerate(stage['tile_ids']):
            offset, size = struct.unpack_from('<II', blob, front + y * 8)
            actual = [struct.unpack_from('<HH', blob, offset + i * 4) for i in range(size)]
            expected = [(x + 1, stage['tile_assets'][tile - 1]) for x, tile in enumerate(row) if tile and tile not in invisible]
            self.assertEqual(actual, expected)
        self.assertEqual(back_rows, len(stage['background']['rows']))
        for y, row in enumerate(stage['background']['rows']):
            offset, size = struct.unpack_from('<II', blob, back + y * 8)
            self.assertEqual([struct.unpack_from('<HH', blob, offset + i * 4) for i in range(size)],
                             [(row[i], stage['background']['tile_assets'][row[i + 1] - 1]) for i in range(0, len(row), 2)])
        for y, row in enumerate(compile_collision_words(stage['tile_ids'], stage['tile_roles'])):
            self.assertEqual(list(struct.unpack_from('<' + 'I' * words, blob, collision + y * words * 4)), row)
        families = stage['water_animation']['tile_families']
        expected_water = [(x + 1, y + 1, families[tile - 1])
                          for y, row in enumerate(stage['tile_ids']) if y + 1 >= stage['water_animation']['first_row']
                          for x, tile in enumerate(row) if tile and families[tile - 1]]
        self.assertEqual([struct.unpack_from('<HHH', blob, water + i * 6) for i in range(count)], expected_water)
        self.assertEqual(yaml.safe_load((path / 'nemesis_s_stage_runtime.yaml').read_text()), stage_runtime_config(stage))

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
