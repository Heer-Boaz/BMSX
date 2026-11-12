"""Drive SNES Mini input devices with physical PC keyboard events."""

import os
import subprocess
import sys
import tkinter as tk

from input_stream import BUTTONS, INPUT_EVENT, KEY_HOME, KEY_VOLUMEUP, input_packet, open_input_stream, write_input


KEY_NAMES = {name: name for name in BUTTONS}
KEY_NAMES.update({"return": "start", "backspace": "select", "f5": "reset"})
RESET_CODES = (KEY_VOLUMEUP, KEY_HOME)


class KeyboardButtons:
    def __init__(self, controller, reset):
        self.controller = controller
        self.reset = reset
        self.held = set()
        self.controller_packets = ()

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
        if name != "reset":
            codes = tuple(code for button, code in BUTTONS.items() if button in self.held)
            self.controller_packets = tuple(input_packet((code,), True) for code in codes)

    def repeat(self):
        for packet in self.controller_packets:
            write_input(self.controller, packet)

    def release_all(self):
        codes = tuple(code for button, code in BUTTONS.items() if button in self.held)
        try:
            for code in codes:
                write_input(self.controller, input_packet((code,), False))
        finally:
            try:
                if "reset" in self.held:
                    write_input(self.reset, input_packet(RESET_CODES, False))
            finally:
                self.held.clear()
                self.controller_packets = ()


class KeyboardSession:
    def __init__(self, target, player):
        self.target = target
        self.player = player
        self.streams = []
        self.buttons = None
        self.reset_release_pending = False

    def connect(self):
        try:
            self.streams.append(open_input_stream(
                self.target, f"Nintendo Clovercon - controller{self.player}", INPUT_EVENT.size * 2, 3))
            self.streams.append(open_input_stream(self.target, "sunxi-keyboard", INPUT_EVENT.size * 3, 3))
            for process in self.streams:
                os.set_blocking(process.stdin.fileno(), False)
            if self.reset_release_pending:
                write_input(self.streams[1].stdin, input_packet(RESET_CODES, False))
                self.reset_release_pending = False
            self.buttons = KeyboardButtons(self.streams[0].stdin, self.streams[1].stdin)
        except OSError:
            self.disconnect()
            raise

    def disconnect(self):
        release_error = None
        if self.buttons is not None:
            self.reset_release_pending |= "reset" in self.buttons.held
            try:
                self.buttons.release_all()
                self.reset_release_pending = False
            except OSError as error:
                release_error = error
        self.buttons = None
        for process in self.streams:
            process.stdin.close()
            process.stdout.close()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait()
        self.streams.clear()
        return release_error


class KeyboardWindow:
    def __init__(self, root, session):
        self.root = root
        self.session = session
        self.pending_releases = {}
        self.repeat_timer = None
        self.monitor_timer = None
        self.status = tk.StringVar(value="Connecting...")
        root.title("SNES Mini keyboard control")
        tk.Label(root, justify="left", padx=18, pady=16, text=(
            "Click this window, then use your physical keyboard:\n\n"
            "Arrow keys: D-pad     A / B / X / Y: buttons\n"
            "L / R: shoulders     Enter: Start     Backspace: Select\n"
            "F5: RESET\n\n"
            "F9: reconnect     Close this window to disconnect."
        )).pack()
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
        if self.repeat_timer is not None:
            self.root.after_cancel(self.repeat_timer)
            self.repeat_timer = None
        if self.monitor_timer is not None:
            self.root.after_cancel(self.monitor_timer)
            self.monitor_timer = None
        release_error = self.session.disconnect()
        suffix = " Release could not be delivered." if release_error else ""
        self.status.set(f"Connection lost: {error}.{suffix} Press F9 to reconnect.")

    def press(self, event):
        if event.keysym.lower() == "f9":
            self.connect()
            return "break"
        name = KEY_NAMES.get(event.keysym.lower())
        buttons = self.session.buttons
        if name is None or buttons is None:
            return
        pending = self.pending_releases.pop(name, None)
        if pending is not None:
            self.root.after_cancel(pending)
        try:
            buttons.set(name, True)
        except OSError as error:
            self.connection_lost(error)
            return "break"
        if name != "reset" and self.repeat_timer is None:
            self.repeat_timer = self.root.after(1, self.repeat)
        return "break"

    def release(self, event):
        name = KEY_NAMES.get(event.keysym.lower())
        buttons = self.session.buttons
        if name is not None and buttons is not None and name in buttons.held and name not in self.pending_releases:
            # X11 auto-repeat may send a release immediately before the next press.
            self.pending_releases[name] = self.root.after_idle(self.finish_release, name)
        return "break"

    def finish_release(self, name):
        del self.pending_releases[name]
        buttons = self.session.buttons
        try:
            buttons.set(name, False)
        except OSError as error:
            self.connection_lost(error)
            return
        if not buttons.controller_packets and self.repeat_timer is not None:
            self.root.after_cancel(self.repeat_timer)
            self.repeat_timer = None

    def repeat(self):
        buttons = self.session.buttons
        try:
            buttons.repeat()
        except OSError as error:
            self.repeat_timer = None
            self.connection_lost(error)
            return
        self.repeat_timer = self.root.after(1, self.repeat) if buttons.controller_packets else None

    def focus_out(self, _event):
        for timer in self.pending_releases.values():
            self.root.after_cancel(timer)
        self.pending_releases.clear()
        if self.repeat_timer is not None:
            self.root.after_cancel(self.repeat_timer)
            self.repeat_timer = None
        if self.session.buttons is not None:
            reset_was_held = "reset" in self.session.buttons.held
            try:
                self.session.buttons.release_all()
            except OSError as error:
                self.session.reset_release_pending |= reset_was_held
                self.connection_lost(error)


def run_keyboard(target, player):
    root = tk.Tk()
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
