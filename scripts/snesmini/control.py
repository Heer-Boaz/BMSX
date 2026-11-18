#!/usr/bin/env python3
"""Send physical SNES Mini input events over SSH."""

import argparse
from contextlib import ExitStack
import sys
import time

from input_stream import BUTTONS, KEY_HOME, KEY_VOLUMEUP, input_packet, open_input_stream, write_input


def send_input(target, devices, duration_ms):
    streams = []
    try:
        for device_name, codes, mode in devices:
            process = open_input_stream(target, device_name, mode)
            press = input_packet(codes, True)
            release = input_packet(codes, False)
            streams.append((process, press, release))

        with ExitStack() as pressed:
            for process, press, release in streams:
                pressed.callback(write_input, process.stdin, release)
                write_input(process.stdin, press)
            time.sleep(duration_ms / 1000)
    finally:
        results = []
        # The controller proxy restores Clover's physical binding when it
        # exits, after the other virtual devices have disappeared.
        for process, _, _ in reversed(streams):
            process.stdin.close()
            process.stdout.close()
            results.append(process.wait())
    return next((result for result in results if result), 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh", required=True, metavar="USER@HOST", help="SSH target for the Mini")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("reset", help="press and release the Mini's physical RESET input")
    keyboard = commands.add_parser("keyboard", help="control the Mini with the PC keyboard")
    keyboard.add_argument("--player", type=int, choices=(1, 2), default=1)
    button = commands.add_parser("button", help="press one or more buttons together")
    button.add_argument("buttons", metavar="BUTTON", nargs="+", type=str.lower,
                        choices=[*BUTTONS, "reset"],
                        help="button names: " + ", ".join([*BUTTONS, "reset"]))
    button.add_argument("--player", type=int, choices=(1, 2), default=1)
    button.add_argument("--duration-ms", type=int,
                        help="press interval in milliseconds (default: 100; reset alone: 150)")
    args = parser.parse_args()
    if args.command == "keyboard":
        from mini_keyboard import run_keyboard
        return run_keyboard(args.ssh, args.player)
    if args.command == "reset":
        devices = [("sunxi-keyboard", (KEY_VOLUMEUP, KEY_HOME), "reset")]
        duration_ms = 150
    else:
        if args.duration_ms is not None and args.duration_ms <= 0:
            parser.error("--duration-ms must be positive")
        buttons = tuple(dict.fromkeys(args.buttons))
        codes = tuple(BUTTONS[name] for name in buttons if name != "reset")
        devices = []
        if codes:
            devices.append((f"Nintendo Clovercon - controller{args.player}", codes, "controller"))
        if "reset" in buttons:
            devices.append(("sunxi-keyboard", (KEY_VOLUMEUP, KEY_HOME), "reset"))
        duration_ms = args.duration_ms if args.duration_ms is not None else (100 if codes else 150)
    try:
        return send_input(args.ssh, devices, duration_ms)
    except OSError as error:
        print(f"SNES Mini input was not completed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
