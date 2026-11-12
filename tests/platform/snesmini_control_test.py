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
from keyboard_bindings import DEFAULT_BINDINGS, GamepadBindings
from control import send_input
from input_stream import open_input_stream


class KeyboardTestRoot:
    def __init__(self):
        self.timers = {}
        self.next_timer = 0
    def title(self, _title): pass
    def bind(self, _event, _callback): pass
    def protocol(self, _event, _callback): pass
    def focus_set(self): pass
    def quit(self): pass
    def after_idle(self, callback, *args):
        self.next_timer += 1
        self.timers[self.next_timer] = (callback, args)
        return self.next_timer
    def after_cancel(self, timer): del self.timers[timer]
    def run_idle(self):
        for timer in list(self.timers):
            callback, args = self.timers.pop(timer)
            callback(*args)


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

    def test_reset_emits_the_two_key_press_and_release(self):
        result = self.run_control("reset")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events("reset"), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        args = self.arguments("reset")
        self.assertEqual(args[-2], "root@mini")
        self.assertIn("sunxi-keyboard", args[-1])
        self.assertIn("bmsx_snesmini_input reset", args[-1])

    def test_reset_is_also_a_button_without_a_connected_controller(self):
        result = self.run_control("button", "RESET", "--duration-ms", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events("reset"), [
            (0, 0, 1, 115, 1), (0, 0, 1, 102, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0),
        ])
        self.assertFalse((self.root / "controller-arguments.json").exists())

    def test_button_has_one_press_and_release_on_the_selected_controller(self):
        result = self.run_control("button", "START", "--player", "2", "--duration-ms", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertEqual(events, [(0, 0, 1, 0x13b, 1), (0, 0, 0, 0, 0),
                                  (0, 0, 1, 0x13b, 0), (0, 0, 0, 0, 0)])
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
        self.assertEqual(events, press + release)
        self.assertIn("bmsx_snesmini_input controller", self.arguments()[-1])

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

    def test_combined_command_closes_reset_before_controller_cleanup(self):
        order = []
        class Process:
            def __init__(self, name):
                self.name = name
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()
            def wait(self):
                order.append(self.name)
                return 0
        processes = [Process("controller"), Process("reset")]
        with patch("control.open_input_stream", side_effect=processes), patch("control.time.sleep"):
            self.assertEqual(send_input("root@mini", [("pad", (0x13b,), "controller"),
                                                       ("reset", (115, 102), "reset")], 20), 0)
        self.assertEqual(order, ["reset", "controller"])

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

    def test_keyboard_stream_creates_a_virtual_device_without_a_physical_keyboard(self):
        with patch.dict(os.environ, self.env, clear=True):
            process = open_input_stream("root@mini", "BMSX Remote Keyboard", "keyboard")
            process.stdin.close()
            process.stdout.close()
            self.assertEqual(process.wait(), 0)
        self.assertIn("bmsx_snesmini_input keyboard", self.arguments()[-1])
        self.assertNotIn("/dev/input/event", self.arguments()[-1])

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
        buttons = KeyboardButtons(controller, reset, io.BytesIO())
        buttons.set("a", True)
        buttons.set("b", True)
        buttons.set("b", True)  # PC key-repeat does not create another transition.
        buttons.set("reset", True)
        buttons.set("a", False)
        buttons.release_all()
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue())), [
            (0, 0, 1, 0x130, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 0x130, 0), (0, 0, 0, 0, 0),
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
        buttons, root = KeyboardButtons(controller, reset, io.BytesIO()), Root()
        session = SimpleNamespace(buttons=buttons)
        with patch("mini_keyboard.tk.Label") as label, patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            label.return_value.pack.return_value = None
            window = KeyboardWindow(root, session)
        window.press(SimpleNamespace(keysym="Left", keycode=105 + 8))
        window.press(SimpleNamespace(keysym="F5", keycode=63 + 8))
        window.release(SimpleNamespace(keysym="Left", keycode=105 + 8))
        window.press(SimpleNamespace(keysym="Left", keycode=105 + 8))  # X11 repeat cancels the pending release.
        self.assertIn("left", buttons.held)
        self.assertEqual(window.pending_releases, {})
        window.focus_out(None)
        self.assertEqual(buttons.held, set())
        self.assertEqual(root.timers, {})
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue()))[-2:],
                         [(0, 0, 1, 0x2c0, 0), (0, 0, 0, 0, 0)])
        self.assertEqual(list(EVENT.iter_unpack(reset.getvalue()))[-3:],
                         [(0, 0, 1, 115, 0), (0, 0, 1, 102, 0), (0, 0, 0, 0, 0)])

    def test_disconnect_does_not_replay_stale_reset_events_on_reconnect(self):
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
        first_controller, first_keyboard, first_reset, next_controller, next_keyboard, next_reset = [Process() for _ in range(6)]
        session = KeyboardSession("root@mini", 1)
        with patch("mini_keyboard.open_input_stream", side_effect=[
            first_controller, first_keyboard, first_reset, next_controller, next_keyboard, next_reset,
        ]), patch("mini_keyboard.os.set_blocking"):
            session.connect()
            session.buttons.set("reset", True)
            first_reset.stdin.broken = True
            self.assertIsInstance(session.disconnect(), BrokenPipeError)
            session.connect()
            self.assertEqual(next_reset.stdin.packets, [])
            session.disconnect()

    def test_proxy_cleanup_failure_is_reported_without_crashing(self):
        class Process:
            def __init__(self):
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()
            def wait(self, timeout=None): return 1
        session = KeyboardSession("root@mini", 1)
        session.streams.append(Process())
        error = session.disconnect()
        self.assertIsInstance(error, ConnectionError)
        self.assertEqual(session.streams, [])

    def test_controller_is_reannounced_after_the_reset_device_is_gone(self):
        order = []
        class Process:
            def __init__(self, name):
                self.name = name
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()
            def wait(self, timeout=None):
                order.append(self.name)
                return 0
        session = KeyboardSession("root@mini", 1)
        session.streams = [Process("controller"), Process("keyboard"), Process("reset")]
        self.assertIsNone(session.disconnect())
        self.assertEqual(order, ["reset", "keyboard", "controller"])

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
                self.buttons = KeyboardButtons(Broken(), io.BytesIO(), io.BytesIO())
                self.new_controller = io.BytesIO()
            def disconnect(self):
                self.buttons = None
                return BrokenPipeError("release not delivered")
            def connect(self):
                self.buttons = KeyboardButtons(self.new_controller, io.BytesIO(), io.BytesIO())
        root, session = Root(), Session()
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            window = KeyboardWindow(root, session)
        window.press(SimpleNamespace(keysym="x", keycode=45 + 8))
        self.assertIsNone(session.buttons)
        self.assertFalse(root.quit_called)
        window.press(SimpleNamespace(keysym="F9", keycode=67 + 8))
        window.press(SimpleNamespace(keysym="z", keycode=44 + 8))
        self.assertIsNotNone(session.buttons)
        self.assertEqual(list(EVENT.iter_unpack(session.new_controller.getvalue())), [
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0),
        ])

    def test_keyboard_mode_forwards_physical_keys_and_modifier_independently(self):
        root = KeyboardTestRoot()
        controller, reset, keyboard = io.BytesIO(), io.BytesIO(), io.BytesIO()
        session = SimpleNamespace(buttons=KeyboardButtons(controller, reset, keyboard))
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            window = KeyboardWindow(root, session)
        window.set_mode("keyboard")
        window.press(SimpleNamespace(keycode=42 + 8, keysym="Shift_L"))
        window.press(SimpleNamespace(keycode=30 + 8, keysym="A"))
        window.release(SimpleNamespace(keycode=42 + 8, keysym="Shift_L"))
        window.release(SimpleNamespace(keycode=30 + 8, keysym="a"))
        root.run_idle()
        for code, name in ((59, "F1"), (63, "F5"), (67, "F9")):
            window.press(SimpleNamespace(keycode=code + 8, keysym=name))
            window.release(SimpleNamespace(keycode=code + 8, keysym=name))
            root.run_idle()
        self.assertEqual(list(EVENT.iter_unpack(keyboard.getvalue())), [
            (0, 0, 1, 42, 1), (0, 0, 0, 0, 0), (0, 0, 1, 30, 1), (0, 0, 0, 0, 0),
            (0, 0, 1, 42, 0), (0, 0, 0, 0, 0), (0, 0, 1, 30, 0), (0, 0, 0, 0, 0),
            (0, 0, 1, 59, 1), (0, 0, 0, 0, 0), (0, 0, 1, 59, 0), (0, 0, 0, 0, 0),
            (0, 0, 1, 63, 1), (0, 0, 0, 0, 0), (0, 0, 1, 63, 0), (0, 0, 0, 0, 0),
            (0, 0, 1, 67, 1), (0, 0, 0, 0, 0), (0, 0, 1, 67, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(controller.getvalue(), b"")
        self.assertEqual(reset.getvalue(), b"")

    def test_mode_switch_releases_the_old_input_before_routing_a_new_press(self):
        root = KeyboardTestRoot()
        controller, reset, keyboard = io.BytesIO(), io.BytesIO(), io.BytesIO()
        session = SimpleNamespace(buttons=KeyboardButtons(controller, reset, keyboard))
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            window = KeyboardWindow(root, session)
        z = SimpleNamespace(keycode=44 + 8, keysym="z")
        window.press(z)
        window.set_mode("keyboard")
        window.press(z)  # X11 repeat of the key still held at the switch is ignored.
        self.assertEqual(keyboard.getvalue(), b"")
        window.release(z); root.run_idle()
        window.press(z); window.release(z); root.run_idle()
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue())), [
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0), (0, 0, 1, 0x131, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(list(EVENT.iter_unpack(keyboard.getvalue())), [
            (0, 0, 1, 44, 1), (0, 0, 0, 0, 0), (0, 0, 1, 44, 0), (0, 0, 0, 0, 0),
        ])

    def test_ctrl_f1_switches_modes_without_forwarding_f1_or_sticking_keys(self):
        root = KeyboardTestRoot()
        controller, reset, keyboard = io.BytesIO(), io.BytesIO(), io.BytesIO()
        session = SimpleNamespace(buttons=KeyboardButtons(controller, reset, keyboard))
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            window = KeyboardWindow(root, session)
        z = SimpleNamespace(keycode=44 + 8, keysym="z")
        left_ctrl = SimpleNamespace(keycode=29 + 8, keysym="Control_L")
        right_ctrl = SimpleNamespace(keycode=97 + 8, keysym="Control_R")
        f1 = SimpleNamespace(keycode=59 + 8, keysym="F1")
        window.press(z); window.press(left_ctrl); window.press(f1)
        self.assertEqual(window.mode, "keyboard")
        self.assertEqual(list(EVENT.iter_unpack(controller.getvalue())), [
            (0, 0, 1, 0x131, 1), (0, 0, 0, 0, 0), (0, 0, 1, 0x131, 0), (0, 0, 0, 0, 0),
        ])
        window.press(f1)  # Repeat does not toggle back.
        window.release(f1); window.release(left_ctrl); window.release(z); root.run_idle()
        window.press(f1); window.release(f1); root.run_idle()  # F1 alone remains a guest key.
        window.press(right_ctrl); window.press(f1)
        self.assertEqual(window.mode, "gamepad")
        window.release(f1); window.release(right_ctrl); root.run_idle()
        self.assertEqual(list(EVENT.iter_unpack(keyboard.getvalue())), [
            (0, 0, 1, 59, 1), (0, 0, 0, 0, 0), (0, 0, 1, 59, 0), (0, 0, 0, 0, 0),
            (0, 0, 1, 97, 1), (0, 0, 0, 0, 0), (0, 0, 1, 97, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(reset.getvalue(), b"")
        self.assertEqual(window.physical_keys, set())
        self.assertEqual(window.ignored_keys, set())

    def test_pending_release_and_focus_loss_do_not_leave_keyboard_keys_stuck(self):
        root = KeyboardTestRoot()
        controller, reset, keyboard = io.BytesIO(), io.BytesIO(), io.BytesIO()
        session = SimpleNamespace(buttons=KeyboardButtons(controller, reset, keyboard))
        with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                patch("mini_keyboard.GamepadBindings", return_value=SimpleNamespace(keys=dict(DEFAULT_BINDINGS))):
            window = KeyboardWindow(root, session)
        z = SimpleNamespace(keycode=44 + 8, keysym="z")
        window.press(z); window.release(z)  # Its X11 key-up is waiting for idle.
        window.set_mode("keyboard")
        window.press(z)  # The completed release must not suppress this new press.
        window.focus_out(None)
        self.assertEqual(list(EVENT.iter_unpack(keyboard.getvalue())), [
            (0, 0, 1, 44, 1), (0, 0, 0, 0, 0), (0, 0, 1, 44, 0), (0, 0, 0, 0, 0),
        ])
        self.assertEqual(window.physical_keys, set())
        self.assertEqual(window.ignored_keys, set())
        self.assertEqual(root.timers, {})

    def test_gamepad_binding_can_be_changed_and_persists(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            bindings = GamepadBindings(path)
            self.assertEqual(bindings.keys["l"], (32, "D"))
            self.assertEqual(bindings.keys["r"], (46, "C"))
            root = KeyboardTestRoot()
            controller = io.BytesIO()
            session = SimpleNamespace(buttons=KeyboardButtons(controller, io.BytesIO(), io.BytesIO()))
            with patch("mini_keyboard.tk.Label"), patch("mini_keyboard.tk.Frame"), \
                    patch("mini_keyboard.tk.Button"), patch("mini_keyboard.tk.StringVar"), \
                    patch("mini_keyboard.GamepadBindings", return_value=bindings):
                window = KeyboardWindow(root, session)
            p = SimpleNamespace(keycode=25 + 8, keysym="p")
            window.begin_binding("l")
            window.press(p); window.press(p)  # Capturing a key never sends a gamepad press.
            self.assertEqual(controller.getvalue(), b"")
            window.release(p); root.run_idle()
            window.press(p); window.release(p); root.run_idle()
            self.assertEqual(list(EVENT.iter_unpack(controller.getvalue())), [
                (0, 0, 1, 0x136, 1), (0, 0, 0, 0, 0), (0, 0, 1, 0x136, 0), (0, 0, 0, 0, 0),
            ])
            self.assertEqual(GamepadBindings(path).keys["l"], [25, "p"])


if __name__ == "__main__":
    unittest.main()
