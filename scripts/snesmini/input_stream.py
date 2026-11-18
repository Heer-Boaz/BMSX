"""Linux input-event streams to SNES Mini devices over SSH."""

import shlex
import struct
import subprocess


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


def input_packet(codes, down):
    return (b"".join(INPUT_EVENT.pack(0, 0, EV_KEY, code, int(down)) for code in codes)
            + INPUT_EVENT.pack(0, 0, EV_SYN, 0, 0))


def write_input(stream, packet):
    if stream.write(packet) != len(packet):
        raise BlockingIOError("SSH input stream is not accepting complete events")


def open_input_stream(target, device_name, mode, connect_timeout=10):
    if mode == "keyboard":
        remote = '''\
modprobe -q uinput || exit 1
exec flock -n /tmp/bmsx-input-keyboard.lock /root/bmsx_snesmini_input keyboard
'''
    else:
        remote = f'''\
modprobe -q uinput || exit 1
for name in /sys/class/input/event*/device/name; do
    [ "$(cat "$name")" = {shlex.quote(device_name)} ] || continue
    [ "$(cat "${{name%/name}}/phys")" != bmsx/snesmini-input ] || continue
    event=${{name#/sys/class/input/}}
    event=${{event%%/*}}
    exec flock -n "/tmp/bmsx-input-$event.lock" /root/bmsx_snesmini_input {shlex.quote(mode)} "/dev/input/$event"
done
printf 'Input device not found: %s\\n' {shlex.quote(device_name)} >&2
exit 1
'''
    process = subprocess.Popen(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={connect_timeout}",
         "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "--", target, remote],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0,
    )
    if process.stdout.readline() != b"READY\n":
        process.stdin.close()
        process.stdout.close()
        status = process.wait()
        raise ConnectionError(f"Could not open {device_name} over SSH (exit {status})")
    return process
