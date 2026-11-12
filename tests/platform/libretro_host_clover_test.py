import gzip
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib


HOST, CORE = sys.argv[1:]
ENV = dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy")


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        ready, _, _ = select.select([stream], [], [], 10)
        if not ready:
            raise AssertionError("host did not reach the requested state")
        chunk = os.read(stream.fileno(), size - len(data))
        if not chunk:
            raise AssertionError("host exited before reaching the requested state")
        data.extend(chunk)
    return bytes(data)


class CloverStateTest(unittest.TestCase):
    def run_host(self, arguments, ready):
        log = tempfile.TemporaryFile(mode="w+")
        self.addCleanup(log.close)
        process = subprocess.Popen(
            [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--backend", "software",
             "--hidden-window", "--no-audio", "--rewind", "off", "--clover", *arguments],
            stdout=subprocess.PIPE, stderr=log, env=ENV,
        )
        self.addCleanup(process.stdout.close)

        def cleanup():
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.returncode:
                log.seek(0)
                print(log.read(), file=sys.stderr)

        self.addCleanup(cleanup)
        self.assertEqual(read_exact(process.stdout, len(ready)), ready)
        return process

    def stop(self, process):
        process.send_signal(signal.SIGTERM)
        self.assertEqual(process.wait(timeout=10), 0)

    def test_suspend_and_resume_through_clover_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            point = Path(directory) / "point with spaces"
            output = point / "rollback"
            output.mkdir(parents=True)
            screenshot = point / "state.png"
            time = point / "state.time"
            output_options = ["--rollback-output-dir", str(output),
                              "--save-screenshot-on-quit", str(screenshot),
                              "--save-time-path", str(time)]
            process = self.run_host(["--title-code", "TEST", "--rollback-mode", "record", *output_options], b"R")
            self.stop(process)
            state = gzip.decompress((output / "savestate").read_bytes())
            self.assertGreater(struct.unpack("=I", state)[0], 0)
            self.assertGreaterEqual(int(time.read_text()), 0)
            image = screenshot.read_bytes()
            self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
            image_data = bytearray()
            offset = 8
            while offset < len(image):
                length = struct.unpack_from(">I", image, offset)[0]
                kind = image[offset + 4:offset + 8]
                if kind == b"IDAT":
                    image_data.extend(image[offset + 8:offset + 8 + length])
                offset += length + 12
            self.assertIn(b"\x12\x34\x56\xff", zlib.decompress(image_data))

            # Clover can resume its volatile point with the same input/output directory.
            time.write_text("142")
            process = self.run_host(["--rollback-input-dir", str(output), "--load-time-path", str(time),
                                     "--rollback-mode", "record", *output_options], b"L" + state + b"R")
            self.stop(process)
            self.assertGreater(struct.unpack("=I", gzip.decompress((output / "savestate").read_bytes()))[0],
                               struct.unpack("=I", state)[0])
            self.assertGreaterEqual(int(time.read_text()), 142)

    def test_rewind_request_returns_to_clover_without_replacing_the_point(self):
        with tempfile.TemporaryDirectory() as directory:
            point = Path(directory) / "savestate"
            point.write_bytes(b"existing point")
            result = subprocess.run(
                [HOST, "--core", CORE, "--no-game", "--clover", "--rollback-mode", "replay",
                 "--rollback-input-dir", directory, "--rollback-output-dir", directory],
                capture_output=True, env=ENV, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(point.read_bytes(), b"existing point")
            self.assertIn(b"rewind is not supported", result.stderr)

    def test_demo_exit_does_not_make_a_suspend_point(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.run_host(["--replay-inputs", "--rollback-output-dir", directory], b"R")
            self.stop(process)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_incomplete_output_does_not_create_a_partial_suspend_point(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.run_host(["--rollback-output-dir", directory], b"R")
            process.send_signal(signal.SIGTERM)
            self.assertNotEqual(process.wait(timeout=10), 0)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_screenshot_write_failure_is_not_reported_as_a_saved_point(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.run_host(["--rollback-output-dir", directory,
                                     "--save-time-path", str(Path(directory) / "state.time"),
                                     "--save-screenshot-on-quit", "/dev/full"], b"R")
            process.send_signal(signal.SIGTERM)
            self.assertNotEqual(process.wait(timeout=10), 0)

    def test_unreadable_state_does_not_silently_start_a_new_game(self):
        with tempfile.TemporaryDirectory() as directory:
            time = Path(directory) / "state.time"
            time.write_text("12")
            point = Path(directory) / "savestate"
            for invalid in (b"not a state", gzip.compress(b"1234")[:-2], gzip.compress(b"12345")):
                with self.subTest(state=invalid):
                    point.write_bytes(invalid)
                    result = subprocess.run(
                        [HOST, "--core", CORE, "--no-game", "--video", "sdl", "--hidden-window", "--no-audio",
                         "--clover", "--rollback-input-dir", directory, "--load-time-path", str(time)],
                        capture_output=True, env=ENV, timeout=10,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(b"Failed to load the Clover suspend point", result.stderr)
                    self.assertEqual(point.read_bytes(), invalid)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
