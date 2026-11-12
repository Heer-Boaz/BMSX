import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest


CONTROL = Path(__file__).resolve().parents[2] / "scripts/snesmini/control.py"
EVENT = struct.Struct("<iiHHi")


class MiniControlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="bmsx-mini-control-")
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.stream = root / "stream"
        self.arguments = root / "arguments.json"
        ssh = root / "ssh"
        ssh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
Path(os.environ["TEST_ARGUMENTS"]).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("TEST_SSH_FAIL"):
    print("Input device not found", file=sys.stderr)
    sys.exit(3)
sys.stdout.buffer.write(b"READY\\n")
sys.stdout.buffer.flush()
Path(os.environ["TEST_STREAM"]).write_bytes(sys.stdin.buffer.read())
''')
        ssh.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}",
                        TEST_STREAM=str(self.stream), TEST_ARGUMENTS=str(self.arguments))

    def run_control(self, *args):
        return subprocess.run([sys.executable, str(CONTROL), "--ssh", "root@mini", *args],
                              env=self.env, capture_output=True, text=True, timeout=5)

    def events(self):
        return list(EVENT.iter_unpack(self.stream.read_bytes()))

    def test_reset_emits_the_physical_two_key_press_and_release(self):
        result = self.run_control("reset")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        args = json.loads(self.arguments.read_text())
        self.assertEqual(args[-2], "root@mini")
        self.assertIn("sunxi-keyboard", args[-1])
        self.assertIn("iflag=fullblock", args[-1])

    def test_button_reasserts_then_releases_on_the_selected_controller(self):
        result = self.run_control("button", "START", "--player", "2", "--duration-ms", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertGreaterEqual(len(events), 6)
        self.assertEqual(events[-2:], [(0, 0, 1, 0x13b, 0), (0, 0, 0, 0, 0)])
        for index in range(0, len(events) - 2, 2):
            self.assertEqual(events[index:index + 2], [(0, 0, 1, 0x13b, 1), (0, 0, 0, 0, 0)])
        args = json.loads(self.arguments.read_text())
        self.assertIn("Nintendo Clovercon - controller2", args[-1])

    def test_snes_button_names_emit_the_clovercon_codes(self):
        buttons = {
            "a": 0x130, "b": 0x131, "x": 0x133, "y": 0x134,
            "l": 0x136, "r": 0x137, "select": 0x13a, "start": 0x13b,
            "left": 0x2c0, "right": 0x2c1, "up": 0x2c2, "down": 0x2c3,
        }
        for name, code in buttons.items():
            with self.subTest(button=name):
                result = self.run_control("button", name, "--duration-ms", "1")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.events()[0], (0, 0, 1, code, 1))
                self.assertEqual(self.events()[-2], (0, 0, 1, code, 0))

    def test_missing_device_is_a_failure(self):
        self.env["TEST_SSH_FAIL"] = "1"
        result = self.run_control("button", "a")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Input device not found", result.stderr)
        self.assertFalse(self.stream.exists())

    def test_invalid_duration_is_rejected_before_connecting(self):
        result = self.run_control("button", "left", "--duration-ms", "0")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.arguments.exists())


if __name__ == "__main__":
    unittest.main()
