import os
import subprocess
import sys
import unittest


HOST, CORE = sys.argv[1:]


class HostExecutionProfileTest(unittest.TestCase):
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
        self.assertIn("--profile-execution requires execution profile interface v1 from a diagnostic core", result.stderr)
        self.assertEqual(result.stdout, "", "capability rejection must happen before the first retro_run")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
