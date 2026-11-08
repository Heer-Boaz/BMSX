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


if __name__ == '__main__':
    unittest.main()
