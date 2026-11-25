from collections import Counter
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.analysis.callgrind_frame import read_costs, RomFunctions


class FrameAttribution(unittest.TestCase):
    def test_self_cost_follows_instruction_not_call_edge_or_function_base(self):
        part = """pid: 42
positions: instr line
events: Ir
ob=(1) ???
fn=(1) 0x1000
0x1000 0 9
calls=1 0x2000 0
+8 0 70
+8 0 5
* 0 3
+8 0 1
ob=(2) app.so
fn=(1)
0x1000 0 2
totals: 20
"""
        with TemporaryDirectory() as folder:
            perf = Path(folder, "perf-42.map")
            perf.write_text("1000 10 gate\n1010 10 guest\n1018 10 reused\n")
            native = Counter()
            costs, total = read_costs(StringIO(part), perf, native)
        self.assertEqual(native, {"gate": 9, "guest": 8, "[overlapping JIT symbols]": 1})
        self.assertEqual(costs["0x1000"], 2)
        self.assertEqual(total, 20)

    def test_listing_does_not_assign_alignment_gaps(self):
        funcs = RomFunctions(["; function=00h id=cart/room entry=1000h len=16 params=0"])
        self.assertEqual(funcs.entry_owner(0x100c), "cart/room")
        self.assertIsNone(funcs.entry_owner(0x1010))
