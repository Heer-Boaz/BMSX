#!/usr/bin/env python3
"""Send physical SNES Mini input events over SSH."""

import argparse
import shlex
import struct
import subprocess
import sys
import time


# The Mini is 32-bit, so its input_event has two 32-bit timeval fields.
INPUT_EVENT = struct.Struct("<iiHHi")
EV_SYN = 0
EV_KEY = 1
KEY_HOME = 102
KEY_VOLUMEUP = 115
BUTTONS = {
    "a": 0x130,
    "b": 0x131,
    "x": 0x133,
    "y": 0x134,
    "l": 0x136,
    "r": 0x137,
    "select": 0x13a,
    "start": 0x13b,
    "left": 0x2c0,
    "right": 0x2c1,
    "up": 0x2c2,
    "down": 0x2c3,
}


def send_input(target, device_name, codes, duration_ms, repeat):
    remote = f'''\
for name in /sys/class/input/event*/device/name; do
    [ "$(cat "$name")" = {shlex.quote(device_name)} ] || continue
    event=${{name#/sys/class/input/}}
    event=${{event%%/*}}
    exec 3>"/dev/input/$event" || exit 1
    printf 'READY\\n'
    exec dd bs=16 iflag=fullblock >&3 2>/dev/null
done
printf 'Input device not found: %s\\n' {shlex.quote(device_name)} >&2
exit 1
'''
    process = subprocess.Popen(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", target, remote],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0,
    )
    if process.stdout.readline() != b"READY\n":
        process.stdin.close()
        process.stdout.close()
        return process.wait() or 1

    sync = INPUT_EVENT.pack(0, 0, EV_SYN, 0, 0)
    press = b"".join(INPUT_EVENT.pack(0, 0, EV_KEY, code, 1) for code in codes) + sync
    release = b"".join(INPUT_EVENT.pack(0, 0, EV_KEY, code, 0) for code in codes) + sync
    try:
        process.stdin.write(press)
        deadline = time.monotonic() + duration_ms / 1000
        if repeat:
            # Clovercon polls the physical controller and releases injected keys.
            while time.monotonic() < deadline:
                time.sleep(0.001)
                process.stdin.write(press)
        else:
            time.sleep(duration_ms / 1000)
    finally:
        try:
            process.stdin.write(release)
        finally:
            process.stdin.close()
            process.stdout.close()
    return process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh", required=True, metavar="USER@HOST", help="SSH target for the Mini")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("reset", help="press and release the Mini's physical RESET input")
    button = commands.add_parser("button", help="press a Clovercon button")
    button.add_argument("button", type=str.lower, choices=BUTTONS)
    button.add_argument("--player", type=int, choices=(1, 2), default=1)
    button.add_argument("--duration-ms", type=int, default=500,
                        help="reassert the button for this many milliseconds (default: 500)")
    args = parser.parse_args()
    if args.command == "reset":
        return send_input(args.ssh, "sunxi-keyboard", (KEY_VOLUMEUP, KEY_HOME), 150, False)
    if args.duration_ms <= 0:
        parser.error("--duration-ms must be positive")
    return send_input(args.ssh, f"Nintendo Clovercon - controller{args.player}",
                      (BUTTONS[args.button],), args.duration_ms, True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        print("SNES Mini input connection closed before the button was released", file=sys.stderr)
        sys.exit(1)
