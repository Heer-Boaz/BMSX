import os
import select
import signal
import subprocess
import sys
import tempfile
import unittest


HOST, CORE = sys.argv[1:]


class HostSignalsTest(unittest.TestCase):
    def test_inherited_blocked_shutdown_signals_still_deinitialize_the_core(self):
        command = [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
                   "--hidden-window", "--no-audio"]
        env = dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy")
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=signum), tempfile.TemporaryFile(mode="w+") as log:
                process = subprocess.Popen(
                    command, stdout=subprocess.PIPE, stderr=log, env=env,
                    preexec_fn=lambda: signal.pthread_sigmask(
                        signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM, signal.SIGUSR1}),
                )
                try:
                    ready, _, _ = select.select([process.stdout], [], [], 10)
                    self.assertTrue(ready, "host did not reach its run loop")
                    self.assertEqual(process.stdout.read(1), b"R")
                    with open(f"/proc/{process.pid}/status") as status:
                        blocked = next(line.split()[1] for line in status if line.startswith("SigBlk:"))
                    self.assertTrue(int(blocked, 16) & (1 << (signal.SIGUSR1 - 1)),
                                    "unrelated inherited signal masks must be preserved")
                    process.send_signal(signum)
                    try:
                        result = process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.fail(f"host did not exit after {signum.name}")
                    self.assertEqual(result, 0)
                    self.assertEqual(process.stdout.read(), b"D", "core must be deinitialized")
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    process.stdout.close()
                    log.seek(0)
                    if process.returncode != 0:
                        print(log.read(), file=sys.stderr)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
