import json
import io
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


CONTROL = Path(__file__).resolve().parents[2] / "scripts/snesmini/control.py"
EVENT = struct.Struct("<iiHHi")
sys.path.insert(0, str(CONTROL.parent))
from mini_keyboard import KeyboardButtons, KeyboardSession, KeyboardWindow


class MiniControlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="bmsx-mini-control-")
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.root = root
        ssh = root / "ssh"
        ssh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["TEST_ROOT"])
device = "reset" if "sunxi-keyboard" in sys.argv[-1] else "controller"
(root / (device + "-arguments.json")).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("TEST_SSH_FAIL") == device:
    print("Input device not found", file=sys.stderr)
    sys.exit(3)
sys.stdout.buffer.write(b"READY\\n")
sys.stdout.buffer.flush()
(root / (device + "-stream")).write_bytes(sys.stdin.buffer.read())
''')
        ssh.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", TEST_ROOT=str(root))

    def run_control(self, *args):
        return subprocess.run([sys.executable, str(CONTROL), "--ssh", "root@mini", *args],
                              env=self.env, capture_output=True, text=True, timeout=5)

    def events(self, device="controller"):
        return list(EVENT.iter_unpack((self.root / f"{device}-stream").read_bytes()))

    def arguments(self, device="controller"):
        return json.loads((self.root / f"{device}-arguments.json").read_text())

    def test_reset_emits_the_physical_two_key_press_and_release(self):
        result = self.run_control("reset")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events("reset"), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        args = self.arguments("reset")
        self.assertEqual(args[-2], "root@mini")
        self.assertIn("sunxi-keyboard", args[-1])
        self.assertIn("bs=48 iflag=fullblock", args[-1])

    def test_reset_is_also_a_button_without_a_connected_controller(self):
        result = self.run_control("button", "RESET", "--duration-ms", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events("reset"), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        self.assertFalse((self.root / "controller-arguments.json").exists())

    def test_button_reasserts_then_releases_on_the_selected_controller(self):
        result = self.run_control("button", "START", "--player", "2", "--duration-ms", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertGreaterEqual(len(events), 6)
        self.assertEqual(events[-2:], [(0, 0, 1, 0x13b, 0), (0, 0, 0, 0, 0)])
        for index in range(0, len(events) - 2, 2):
            self.assertEqual(events[index:index + 2], [(0, 0, 1, 0x13b, 1), (0, 0, 0, 0, 0)])
        args = self.arguments()
        self.assertIn("Nintendo Clovercon - controller2", args[-1])

    def test_buttons_are_pressed_and_released_in_one_report(self):
        result = self.run_control("button", "b", "Y", "l", "--duration-ms", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        press = [(0, 0, 1, 0x131, 1), (0, 0, 1, 0x134, 1),
                 (0, 0, 1, 0x136, 1), (0, 0, 0, 0, 0)]
        release = [(0, 0, 1, 0x131, 0), (0, 0, 1, 0x134, 0),
                   (0, 0, 1, 0x136, 0), (0, 0, 0, 0, 0)]
        self.assertGreaterEqual(len(events), 12)
        self.assertEqual(events[-4:], release)
        for index in range(0, len(events) - 4, 4):
            self.assertEqual(events[index:index + 4], press)
        self.assertIn("bs=64 iflag=fullblock", self.arguments()[-1])

    def test_reset_can_be_held_with_controller_buttons(self):
        result = self.run_control("button", "start", "select", "reset", "--duration-ms", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        controller = self.events()
        self.assertEqual(controller[:3], [(0, 0, 1, 0x13b, 1), (0, 0, 1, 0x13a, 1), (0, 0, 0, 0, 0)])
        self.assertEqual(controller[-3:], [(0, 0, 1, 0x13b, 0), (0, 0, 1, 0x13a, 0), (0, 0, 0, 0, 0)])
        self.assertEqual(self.events("reset"), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])

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
        self.env["TEST_SSH_FAIL"] = "controller"
        result = self.run_control("button", "a")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Input device not found", result.stderr)
        self.assertFalse((self.root / "controller-stream").exists())

    def test_missing_second_device_does_not_press_the_first(self):
        self.env["TEST_SSH_FAIL"] = "reset"
        result = self.run_control("button", "start", "reset")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), [])

    def test_invalid_duration_is_rejected_before_connecting(self):
        result = self.run_control("button", "left", "--duration-ms", "0")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "controller-arguments.json").exists())


class KeyboardControlTests(unittest.TestCase):
    def test_buttons_remain_held_together_until_released(self):
        controller, reset = io.BytesIO(), io.BytesIO()
        buttons = KeyboardButtons(controller, reset)
        buttons.set("a", True)
        buttons.set("b", True)
        buttons.set("b", True)  # PC key-repeat does not create another transition.
        buttons.repeat()
        buttons.set("reset", True)
        buttons.set("a", False)
        buttons.repeat()
        buttons.release_all()
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue())), [
            (0, 0, 1, 0x130, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x130, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x130, 0), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x131, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(list(EVENT.iter_unpack(reset.getvalue())), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(buttons.held, set())

    def test_focus_loss_releases_controls_and_cancels_key_repeat(self):
        class Root:
            def __init__(self):
                self.timers = {}
                self.next_timer = 0
            def title(self, _title): pass
            def bind(self, _event, _callback): pass
            def protocol(self, _event, _callback): pass
            def quit(self): pass
            def update_idletasks(self): pass
            def after(self, _delay, callback, *args):
                self.next_timer += 1
                self.timers[self.next_timer] = (callback, args)
                return self.next_timer
            def after_idle(self, callback, *args):
                return self.after(0, callback, *args)
            def after_cancel(self, timer):
                del self.timers[timer]
        controller, reset = io.BytesIO(), io.BytesIO()
        buttons, root = KeyboardButtons(controller, reset), Root()
        session = SimpleNamespace(buttons=buttons, reset_release_pending=False)
        with patch("mini_keyboard.tk.Label") as label, patch("mini_keyboard.tk.StringVar"):
            label.return_value.pack.return_value = None
            window = KeyboardWindow(root, session)
        window.press(SimpleNamespace(keysym="Left"))
        window.press(SimpleNamespace(keysym="F5"))
        window.release(SimpleNamespace(keysym="Left"))
        window.press(SimpleNamespace(keysym="Left"))  # X11 repeat cancels the pending release.
        self.assertIn("left", buttons.held)
        self.assertEqual(window.pending_releases, {})
        window.focus_out(None)
        self.assertEqual(buttons.held, set())
        self.assertEqual(root.timers, {})
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue()))[-2:],
                         [(0, 0, 1, 0x2c0, 0), (0, 0, 0, 0, 0)])
        self.assertEqual(list(EVENT.iter_unpack(reset.getvalue()))[-3:],
                         [(0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0)])

    def test_disconnect_releases_reset_after_reconnect_without_repeating_the_press(self):
        class Stream:
            def __init__(self):
                self.packets = []
                self.broken = False
            def write(self, packet):
                if self.broken:
                    raise BrokenPipeError("disconnected")
                self.packets.append(packet)
                return len(packet)
            def fileno(self): return 3
            def close(self): pass
        class Process:
            def __init__(self):
                self.stdin = Stream()
                self.stdout = Stream()
            def poll(self): return 0
            def wait(self, timeout=None): return 0
        first_controller, first_reset, next_controller, next_reset = [Process() for _ in range(4)]
        session = KeyboardSession("root@mini", 1)
        with patch("mini_keyboard.open_input_stream", side_effect=[
            first_controller, first_reset, next_controller, next_reset,
        ]), patch("mini_keyboard.os.set_blocking"):
            session.connect()
            session.buttons.set("reset", True)
            first_reset.stdin.broken = True
            self.assertIsInstance(session.disconnect(), BrokenPipeError)
            self.assertTrue(session.reset_release_pending)
            session.connect()
            self.assertFalse(session.reset_release_pending)
            self.assertEqual([event for packet in next_reset.stdin.packets for event in EVENT.iter_unpack(packet)], [
                (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
            ])
            session.disconnect()

    def test_broken_connection_keeps_window_open_and_f9_reconnects(self):
        class Root:
            def __init__(self): self.quit_called = False
            def title(self, _title): pass
            def bind(self, _event, _callback): pass
            def protocol(self, _event, _callback): pass
            def update_idletasks(self): pass
            def quit(self): self.quit_called = True
            def after(self, _delay, _callback): return 1
            def after_cancel(self, _timer): pass
        class Broken:
            def write(self, _packet): raise BrokenPipeError("disconnected")
        class Session:
            def __init__(self):
                self.buttons = KeyboardButtons(Broken(), io.BytesIO())
                self.new_controller = io.BytesIO()
                self.reset_release_pending = False
            def disconnect(self):
                self.buttons = None
                return BrokenPipeError("release not delivered")
            def connect(self):
                self.buttons = KeyboardButtons(self.new_controller, io.BytesIO())
        root, session = Root(), Session()
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.StringVar"):
            window = KeyboardWindow(root, session)
        window.press(SimpleNamespace(keysym="a"))
        self.assertIsNone(session.buttons)
        self.assertFalse(root.quit_called)
        window.press(SimpleNamespace(keysym="F9"))
        window.press(SimpleNamespace(keysym="b"))
        self.assertIsNotNone(session.buttons)
        self.assertEqual(list(EVENT.iter_unpack(session.new_controller.getvalue())), [
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
        ])


if __name__ == "__main__":
    unittest.main()
