import os
import re
import subprocess
import sys
import unittest


HOST, CORE = sys.argv[1:]


class HostExecutionProfileTest(unittest.TestCase):
    def run_profile_core(self, format_name):
        return subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--max-frames", "3",
             "--timing-report", "--timing-warmup", "1", "--profile-execution"],
            capture_output=True, text=True, timeout=10,
            env=dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy",
                     BMSX_TEST_EXECUTION_PROFILE=format_name),
        )

    def test_stale_command_is_rejected_without_reading_its_payload(self):
        result = self.run_profile_core("stale")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(result.returncode, 99, "must not read the obsolete payload")
        self.assertIn("requires current execution profile interface", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_backend_counters_and_gc_share_the_same_frame_interval(self):
        result = self.run_profile_core("current")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "RD")
        frames = [dict(re.findall(r"(\w+)=([^\s]+)", line))
                  for line in result.stderr.splitlines() if "[libretro-host][slow-frame]" in line]
        self.assertEqual({int(frame["host_frame"]) for frame in frames}, {1, 2})
        expected = {
            "execution_profile": "1", "cpu_slices": "1", "cpu_consumed_cycles": "100",
            "cpu_native_origin_cycles": "60", "cpu_interpreter_runtime_cycles": "40",
            "native_newt_count": "2", "native_call_count": "3", "native_setfield_count": "4",
            "native_concat_count": "1", "native_concatn_count": "1",
            "interpreter_newt_count": "1", "interpreter_call_count": "1", "interpreter_setfield_count": "1",
            "interpreter_concat_count": "1", "interpreter_concatn_count": "1",
            "gc_collections": "1", "gc_total_ns": "1000", "gc_roots_ns": "100", "gc_trace_ns": "200",
            "gc_weak_ns": "50", "gc_sweep_ns": "400", "gc_string_reclaim_ns": "250",
        }
        for frame in frames:
            for key, value in expected.items():
                self.assertEqual(frame[key], value, key)
            self.assertIn("host_main_thread_cpu_ns", frame)
            self.assertIn("host_process_cpu_ns", frame)

    def test_execution_profile_requires_timing_before_opening_the_core(self):
        result = subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--profile-execution"],
            capture_output=True, text=True, timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--profile-execution requires --timing-report", result.stderr)
        self.assertEqual(result.stdout, "", "no guest execution may precede argument admission")

    def test_requested_profile_rejects_an_unsupported_core_before_running(self):
        result = subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--max-frames", "2",
             "--timing-report", "--timing-warmup", "1", "--profile-execution"],
            capture_output=True, text=True, timeout=10,
            env=dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy"),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--profile-execution requires current execution profile interface from a diagnostic core", result.stderr)
        self.assertEqual(result.stdout, "", "capability rejection must happen before the first retro_run")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
