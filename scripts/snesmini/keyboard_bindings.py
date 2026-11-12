"""User-configurable PC keys for the SNES Mini gamepad."""

import json
import os
from pathlib import Path


# Linux evdev key codes. The labels are only for display in the control window.
DEFAULT_BINDINGS = {
    "up": (103, "Up"), "down": (108, "Down"), "left": (105, "Left"), "right": (106, "Right"),
    "a": (45, "X"), "b": (44, "Z"), "x": (31, "S"), "y": (30, "A"),
    "l": (32, "D"), "r": (46, "C"), "start": (28, "Enter"), "select": (14, "Backspace"),
    "reset": (63, "F5"),
}


class GamepadBindings:
    def __init__(self, path=None):
        config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        self.path = path if path is not None else config_home / "bmsx" / "snesmini-keys.json"
        self.keys = json.loads(self.path.read_text()) if self.path.exists() else dict(DEFAULT_BINDINGS)

    def assign(self, button, code, label):
        self.keys[button] = (code, label)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.keys, indent=2) + "\n")
