"""Drive SNES Mini input devices with physical PC keyboard events."""

import os
import subprocess
import sys
import tkinter as tk

from input_stream import BUTTONS, KEY_HOME, KEY_VOLUMEUP, input_packet, open_input_stream, write_input
from keyboard_bindings import GamepadBindings


RESET_CODES = (KEY_VOLUMEUP, KEY_HOME)
X11_EVDEV_OFFSET = 8
KEY_F1 = 59
KEY_F9 = 67
KEY_LEFTCTRL = 29
KEY_RIGHTCTRL = 97


class KeyboardButtons:
    def __init__(self, controller, reset, keyboard):
        self.controller = controller
        self.reset = reset
        self.keyboard = keyboard
        self.held = set()
        self.held_keys = set()

    def set(self, name, down):
        if (name in self.held) == down:
            return
        if name == "reset":
            write_input(self.reset, input_packet(RESET_CODES, down))
        else:
            write_input(self.controller, input_packet((BUTTONS[name],), down))
        if down:
            self.held.add(name)
        else:
            self.held.remove(name)

    def set_key(self, code, down):
        if (code in self.held_keys) == down:
            return
        write_input(self.keyboard, input_packet((code,), down))
        if down:
            self.held_keys.add(code)
        else:
            self.held_keys.remove(code)

    def release_all(self):
        codes = tuple(code for button, code in BUTTONS.items() if button in self.held)
        try:
            if codes:
                write_input(self.controller, input_packet(codes, False))
        finally:
            try:
                try:
                    if self.held_keys:
                        write_input(self.keyboard, input_packet(tuple(self.held_keys), False))
                finally:
                    if "reset" in self.held:
                        write_input(self.reset, input_packet(RESET_CODES, False))
            finally:
                self.held.clear()
                self.held_keys.clear()


class KeyboardSession:
    def __init__(self, target, player):
        self.target = target
        self.player = player
        self.streams = []
        self.buttons = None

    def connect(self):
        try:
            self.streams.append(open_input_stream(
                self.target, f"Nintendo Clovercon - controller{self.player}", "controller", 3))
            self.streams.append(open_input_stream(self.target, "BMSX Remote Keyboard", "keyboard", 3))
            self.streams.append(open_input_stream(self.target, "sunxi-keyboard", "reset", 3))
            for process in self.streams:
                os.set_blocking(process.stdin.fileno(), False)
            self.buttons = KeyboardButtons(self.streams[0].stdin, self.streams[2].stdin, self.streams[1].stdin)
        except OSError:
            self.disconnect()
            raise

    def disconnect(self):
        release_error = None
        if self.buttons is not None:
            try:
                self.buttons.release_all()
            except OSError as error:
                release_error = error
        self.buttons = None
        # Reannounce the physical controller only after the other virtual
        # devices from this session have disappeared.
        for process in reversed(self.streams):
            process.stdin.close()
            process.stdout.close()
            try:
                status = process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                process.terminate()
                status = process.wait()
            if status and release_error is None:
                release_error = ConnectionError(f"SNES Mini input proxy exited with status {status}")
        self.streams.clear()
        return release_error


class KeyboardWindow:
    def __init__(self, root, session):
        self.root = root
        self.session = session
        self.bindings = GamepadBindings()
        self.mode = "gamepad"
        self.binding_target = None
        self.active_keys = {}
        self.physical_keys = set()
        self.ignored_keys = set()
        self.pending_releases = {}
        self.monitor_timer = None
        self.status = tk.StringVar(value="Connecting...")
        self.mode_status = tk.StringVar(value="Gamepad mode")
        root.title("SNES Mini keyboard control")
        tk.Label(root, justify="left", padx=18, pady=8, text=(
            "Click this window and use your physical keyboard.\n"
            "Click a gamepad binding, then press its new key."
        )).pack()
        modes = tk.Frame(root)
        modes.pack()
        tk.Button(modes, text="Gamepad", takefocus=False, command=lambda: self.set_mode("gamepad")).pack(side="left")
        tk.Button(modes, text="Keyboard", takefocus=False, command=lambda: self.set_mode("keyboard")).pack(side="left")
        tk.Label(modes, textvariable=self.mode_status, padx=12).pack(side="left")
        bindings = tk.Frame(root, padx=18, pady=8)
        bindings.pack()
        self.binding_labels = {}
        for index, (name, (_, label)) in enumerate(self.bindings.keys.items()):
            self.binding_labels[name] = tk.StringVar(value=f"{name.upper()}: {label}")
            tk.Button(bindings, textvariable=self.binding_labels[name], takefocus=False,
                      command=lambda button=name: self.begin_binding(button)).grid(row=index // 3, column=index % 3, sticky="ew")
        tk.Label(root, text="Ctrl+F1: switch mode   •   F9: reconnect when disconnected", padx=18).pack()
        tk.Label(root, textvariable=self.status, padx=18, pady=4).pack()
        root.bind("<KeyPress>", self.press)
        root.bind("<KeyRelease>", self.release)
        root.bind("<FocusOut>", self.focus_out)
        root.protocol("WM_DELETE_WINDOW", root.quit)

    def connect(self):
        if self.session.buttons is not None:
            return
        self.status.set("Connecting...")
        self.root.update_idletasks()
        try:
            self.session.connect()
        except OSError as error:
            self.status.set(f"Not connected: {error}. Press F9 to retry.")
            return
        self.status.set("Connected. Click here and use your keyboard.")
        self.monitor_timer = self.root.after(500, self.check_connection)

    def check_connection(self):
        self.monitor_timer = None
        if any(process.poll() is not None for process in self.session.streams):
            self.connection_lost(ConnectionError("SSH connection closed"))
        else:
            self.monitor_timer = self.root.after(500, self.check_connection)

    def connection_lost(self, error):
        for timer in self.pending_releases.values():
            self.root.after_cancel(timer)
        self.pending_releases.clear()
        self.active_keys.clear()
        self.physical_keys.clear()
        self.ignored_keys.clear()
        if self.monitor_timer is not None:
            self.root.after_cancel(self.monitor_timer)
            self.monitor_timer = None
        release_error = self.session.disconnect()
        suffix = " Release could not be delivered." if release_error else ""
        self.status.set(f"Connection lost: {error}.{suffix} Press F9 to reconnect.")

    def release_keys(self):
        for code, timer in self.pending_releases.items():
            self.root.after_cancel(timer)
            self.physical_keys.discard(code)
            self.ignored_keys.discard(code)
        self.pending_releases.clear()
        self.active_keys.clear()
        if self.session.buttons is not None:
            self.session.buttons.release_all()

    def set_mode(self, mode):
        try:
            self.release_keys()
            self.ignored_keys.update(self.physical_keys)
        except OSError as error:
            self.connection_lost(error)
            return
        self.binding_target = None
        self.mode = mode
        self.mode_status.set("Gamepad mode" if mode == "gamepad" else "Keyboard mode")
        self.root.focus_set()

    def begin_binding(self, name):
        try:
            self.release_keys()
            self.ignored_keys.update(self.physical_keys)
        except OSError as error:
            self.connection_lost(error)
            return
        self.mode = "gamepad"
        self.mode_status.set("Gamepad mode")
        self.binding_target = name
        self.status.set(f"Press a key for {name.upper()}.")
        self.root.focus_set()

    def press(self, event):
        code = event.keycode - X11_EVDEV_OFFSET
        pending = self.pending_releases.pop(code, None)
        if pending is not None:
            self.root.after_cancel(pending)
        if code in self.physical_keys:
            return "break"
        self.physical_keys.add(code)
        if self.binding_target is not None:
            name = self.binding_target
            self.binding_target = None
            self.ignored_keys.add(code)
            try:
                self.bindings.assign(name, code, event.keysym)
            except OSError as error:
                self.status.set(f"Binding is active but could not be saved: {error}")
            else:
                self.status.set("Binding saved. Click here and use your keyboard.")
            self.binding_labels[name].set(f"{name.upper()}: {event.keysym}")
            return "break"
        if code == KEY_F1 and (KEY_LEFTCTRL in self.physical_keys or KEY_RIGHTCTRL in self.physical_keys):
            self.set_mode("keyboard" if self.mode == "gamepad" else "gamepad")
            return "break"
        buttons = self.session.buttons
        if buttons is None and code == KEY_F9:
            self.connect()
            return "break"
        if buttons is None:
            return
        try:
            if self.mode == "keyboard":
                buttons.set_key(code, True)
                self.active_keys[code] = None
            else:
                names = tuple(name for name, (key, _) in self.bindings.keys.items() if key == code)
                for name in names:
                    buttons.set(name, True)
                if names:
                    self.active_keys[code] = names
        except OSError as error:
            self.connection_lost(error)
            return "break"
        return "break"

    def release(self, event):
        code = event.keycode - X11_EVDEV_OFFSET
        if code in self.physical_keys and code not in self.pending_releases:
            # X11 auto-repeat may send a release immediately before the next press.
            self.pending_releases[code] = self.root.after_idle(self.finish_release, code)
        return "break"

    def finish_release(self, code):
        del self.pending_releases[code]
        self.physical_keys.remove(code)
        if code in self.ignored_keys:
            self.ignored_keys.remove(code)
            return
        if code not in self.active_keys:
            return
        names = self.active_keys.pop(code)
        buttons = self.session.buttons
        try:
            if names is None:
                buttons.set_key(code, False)
            else:
                for name in names:
                    buttons.set(name, False)
        except OSError as error:
            self.connection_lost(error)
            return

    def focus_out(self, _event):
        try:
            self.release_keys()
        except OSError as error:
            self.connection_lost(error)
        self.physical_keys.clear()
        self.ignored_keys.clear()


def run_keyboard(target, player):
    root = tk.Tk()
    if root.tk.call("tk", "windowingsystem") != "x11":
        root.destroy()
        print("SNES Mini keyboard control requires an X11/WSLg evdev keyboard", file=sys.stderr)
        return 1
    session = KeyboardSession(target, player)
    window = KeyboardWindow(root, session)
    root.after_idle(window.connect)
    try:
        root.mainloop()
    finally:
        error = session.disconnect()
        if error:
            print(f"Could not release all SNES Mini inputs: {error}", file=sys.stderr)
        root.destroy()
    return 0
