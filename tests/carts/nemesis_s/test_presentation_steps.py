import sys
import unittest
from pathlib import Path
from struct import unpack_from

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/nemesis_s'))
from build_presentation_steps import compile_presentation_steps


class PresentationStepCookTest(unittest.TestCase):
    def test_rom_bytes_match_the_authored_tracks(self):
        resource = ROOT / 'carts/nemesis_s/res/data/nemesis_s_presentation_steps.bin'
        data = resource.read_bytes()
        self.assertEqual(data, compile_presentation_steps())
        self.assertEqual(len(unpack_from('<12I', data)), 12)

    def test_venom_shared_frame_events_keep_track_order(self):
        data = compile_presentation_steps()
        base, = unpack_from('<I', data, 5 * 4)
        _, _, keys, ops, forward, reverse = unpack_from('<6I', data, base)

        def bucket(spans, frame):
            first, limit = unpack_from('<HH', data, base + spans + frame * 2)
            result = []
            for entry in range(first, limit):
                track, key = unpack_from('<HH', data, base + ops + entry * 4)
                _, value = unpack_from('<Ii', data, base + keys + key * 8)
                result.append((track, value))
            return result

        self.assertEqual(bucket(forward, 126), [(2, 1), (3, 126), (4, 110), (7, 2)])
        self.assertEqual(bucket(reverse, 126), [(2, 0), (3, 126), (4, 110), (7, 0)])


if __name__ == '__main__':
    unittest.main()
