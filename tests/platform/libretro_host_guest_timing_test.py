import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


HOST, CORE = sys.argv[1:]


class HostGuestTimingTest(unittest.TestCase):
    def run_host(self, mode, max_frames=12, captures=False):
        with tempfile.TemporaryDirectory() as root:
            cart = Path(root) / "cart.rom"
            cart.write_bytes(b"fixture")
            timeline = Path(root) / "timeline.json"
            events = [
                {"frame": frame, "event": {"type": "button", "code": "KeyA", "down": frame == 0}}
                for frame in range(2)
            ]
            if captures:
                events.append({"frame": 2, "capture": True})
            timeline.write_text(json.dumps(events))
            return subprocess.run(
                [HOST, "--core", CORE, str(cart), "--video", "sdl", "--backend", "software",
                 "--hidden-window", "--no-audio", "--input-timeline", str(timeline),
                 "--guest-ticks", "3", "--max-frames", str(max_frames), "--timing-report",
                 "--timing-warmup", "1"],
                capture_output=True, text=True, timeout=10,
                env=dict(os.environ, SDL_VIDEODRIVER="dummy", BMSX_TEST_GUEST_TIMING=mode),
            )

    def test_measured_window_uses_guest_progress_but_retains_host_costs(self):
        result = self.run_host("valid")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "RD")
        self.assertIn("[signal-core][guest-input] before_run=3 key=97 down=1", result.stderr)
        self.assertIn("[signal-core][guest-input] before_run=5 key=97 down=0", result.stderr)
        self.assertIn("guest ticks reached (3)", result.stderr)
        self.assertIn("warmup_guest_ticks=1", result.stderr)
        self.assertIn("tick_before=3 tick_after=5 cycle_before=300 cycle_after=500"
                      " host_runs=4 zero_tick_runs=2 zero_cycle_runs=1", result.stderr)
        maintenance = next(line for line in result.stderr.splitlines()
                           if "[over-15ms] host_frame=4 " in line)
        fields = dict(re.findall(r"(\w+)=(\d+)", maintenance))
        self.assertGreater(int(fields["run_ns"]), 15_000_000)
        self.assertEqual((fields["tick_before"], fields["tick_after"]), ("3", "3"))
        self.assertEqual((fields["cycle_before"], fields["cycle_after"]), ("300", "300"))

    def test_multi_tick_and_host_cap_do_not_emit_benchmark_summaries(self):
        for mode, limit, reason in [("multiple", 12, "Invalid guest progress"), ("valid", 6, "max frames reached")]:
            with self.subTest(mode=mode, limit=limit):
                result = self.run_host(mode, limit)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "RD")
                self.assertIn(reason, result.stderr)
                self.assertIn("Incomplete guest workload: 1/3 ticks", result.stderr)
                self.assertNotIn("[libretro-host][timing]", result.stderr)

    def test_requires_single_tick_negotiation_and_refuses_capture_cost(self):
        for mode, capture, reason in [
            ("unbound", False, "requires guest progress, single-tick pacing and execution domain"),
            ("valid", True, "requires no captures"),
        ]:
            with self.subTest(mode=mode, capture=capture):
                result = self.run_host(mode, captures=capture)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "", "unsupported workloads must fail before running")
                self.assertIn(reason, result.stderr)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
