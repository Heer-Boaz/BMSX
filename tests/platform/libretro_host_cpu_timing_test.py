import os
import re
import subprocess
import sys
import unittest


HOST, CORE, CLOCK_FIXTURE = sys.argv[1:]


class HostCpuTimingTest(unittest.TestCase):
    def run_host(self, options=(), mode="advancing"):
        return subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--max-frames", "4", *options],
            capture_output=True, text=True, timeout=10,
            env=dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy",
                     LD_PRELOAD=CLOCK_FIXTURE, BMSX_TEST_CPU_CLOCK_MODE=mode),
        )

    def test_disabled_timing_never_reads_cpu_clocks(self):
        result = self.run_host(mode="error")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "RD")
        self.assertIn("main_reads=0 process_reads=0", result.stderr)
        self.assertNotIn("[libretro-host][slow-frame]", result.stderr)

    def test_warmup_frames_do_not_read_cpu_clocks(self):
        result = self.run_host(("--timing-report", "--timing-warmup", "4"), mode="error")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("main_reads=0 process_reads=0", result.stderr)
        self.assertNotIn("[libretro-host][slow-frame]", result.stderr)

    def test_each_recorded_frame_prints_both_raw_cpu_intervals(self):
        result = self.run_host(("--timing-report", "--timing-warmup", "1"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("main_reads=6 process_reads=6", result.stderr)
        frames = [dict(re.findall(r"(\w+)=([^\s]+)", line))
                  for line in result.stderr.splitlines() if "[libretro-host][slow-frame]" in line]
        self.assertEqual({int(frame["host_frame"]) for frame in frames}, {1, 2, 3})
        for frame in frames:
            self.assertEqual(frame["host_main_thread_cpu_ns"], "10000000")
            self.assertEqual(frame["host_process_cpu_ns"], "30000000")
            self.assertIn("blit_ms", frame)
            self.assertIn("execution_profile", frame)

    def test_constant_cpu_clocks_are_real_zero_intervals(self):
        result = self.run_host(("--timing-report", "--timing-warmup", "1"), mode="constant")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("main_reads=6 process_reads=6", result.stderr)
        self.assertEqual(result.stderr.count("host_main_thread_cpu_ns=0 host_process_cpu_ns=0"), 3)

    def test_unavailable_requested_cpu_clock_fails_instead_of_fabricating_zero(self):
        result = self.run_host(("--timing-report", "--timing-warmup", "1"), mode="error")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CPU clock_gettime", result.stderr)
        self.assertEqual(result.stdout, "R", "only the unmeasured warmup frame may run")
        self.assertNotIn("[libretro-host][slow-frame]", result.stderr)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
