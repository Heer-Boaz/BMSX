import os
import re
import subprocess
import sys
import unittest


HOST, CORE = sys.argv[1:]


class HostExecutionProfileTest(unittest.TestCase):
    def run_profile_core(self, format_name, max_frames=3):
        return subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--max-frames", str(max_frames),
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
        result = self.run_profile_core("current", max_frames=35)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "RD")
        frames = [dict(re.findall(r"(\w+)=([^\s]+)", line))
                  for line in result.stderr.splitlines() if "[libretro-host][slow-frame]" in line]
        self.assertEqual(len(frames), 32)
        self.assertNotIn(0, {int(frame["host_frame"]) for frame in frames})
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
        reports = [dict(re.findall(r"(\w+)=([^\s]+)", line))
                   for line in result.stderr.splitlines() if "[libretro-host][execution]" in line]
        self.assertEqual(len(reports), 1)
        report = reports[0]
        self.assertEqual(report["frames"], "34")
        self.assertEqual(report["scheduler_before_cycles"], "100")
        self.assertEqual(report["scheduler_after_cycles"], "3500")
        for key, value in expected.items():
            if key != "execution_profile":
                self.assertEqual(report[key], str(int(value) * 34), key)
        self.assertIn("[signal-core][profile-reads] execution=68 native=0", result.stderr)

    def test_no_measured_calls_do_not_read_or_report_execution_profile(self):
        result = self.run_profile_core("current", max_frames=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("[libretro-host][execution]", result.stderr)
        self.assertNotIn("[signal-core][profile-reads]", result.stderr)

    def test_native_compilation_worker_counters_are_v2_only(self):
        for offered in ("v1", "v2", "both"):
            with self.subTest(offered=offered):
                result = subprocess.run(
                    [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
                     "--hidden-window", "--no-audio", "--max-frames", "3", "--timing-report",
                     "--timing-warmup", "1", "--profile-native-compilation"],
                    capture_output=True, text=True, timeout=10,
                    env=dict(os.environ, SDL_VIDEODRIVER="dummy", BMSX_TEST_NATIVE_COMPILATION_PROFILE=offered),
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                reports = [dict(re.findall(r"(\w+)=([^\s]+)", line))
                           for line in result.stderr.splitlines() if "[libretro-host][native-compilation]" in line]
                self.assertEqual(len(reports), 1)
                report = reports[0]
                self.assertEqual(report["frames"], "2")
                self.assertEqual(report["prepares"], "8")
                if offered == "v1":
                    self.assertEqual(report["profile_version"], "1")
                    self.assertEqual(report["capacity_events_v1"], "4")
                    for key in ("capacity_evicted_regions", "background_completed", "background_cancelled", "background_ns"):
                        self.assertNotIn(key, report)
                else:
                    self.assertEqual(report["profile_version"], "2")
                    self.assertNotIn("capacity_events_v1", report)
                    for key, value in {"capacity_evicted_regions": "4", "background_completed": "6",
                                       "background_cancelled": "2", "background_ns": "2468"}.items():
                        self.assertEqual(report[key], value, key)
                self.assertIn("[signal-core][profile-reads] execution=0 native=4", result.stderr)

    def test_unrequested_profiles_are_not_read(self):
        result = subprocess.run(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--max-frames", "3", "--timing-report", "--timing-warmup", "1"],
            capture_output=True, text=True, timeout=10,
            env=dict(os.environ, SDL_VIDEODRIVER="dummy", BMSX_TEST_NATIVE_COMPILATION_PROFILE="both",
                     BMSX_TEST_EXECUTION_PROFILE="current"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("[signal-core][profile-reads]", result.stderr)
        self.assertNotIn("[libretro-host][execution]", result.stderr)
        self.assertNotIn("[libretro-host][native-compilation]", result.stderr)

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
