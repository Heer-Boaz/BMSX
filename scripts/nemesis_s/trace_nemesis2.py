#!/usr/bin/env python3

import argparse
import json
import sys
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]
PYMSX_ROOT = WORKSPACE / ".external/py-msx-emulator"
sys.path.insert(0, str(WORKSPACE))
sys.path.insert(0, str(PYMSX_ROOT))

from msx.diagnostics.logger import DebugLogger
from msx.machine_loader import build_machine, load_device_registry, load_machine_spec
from msx.vdp._geometry import OUTPUT_H

from scripts.research.msx.frame_capture import write_rgb24_ppm
from scripts.research.msx.z80_rom import mapped_banked_rom_offset

DEFAULT_ROM_PATH = WORKSPACE / ".external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom"
DEFAULT_OUTPUT_ROOT = WORKSPACE / ".external/nemesis2rom/traces"
MACHINE_NAME = "cbios_msx1_jp"
CARTRIDGE_FIRST_ADDRESS = 0x4000
CARTRIDGE_LAST_ADDRESS = 0xBFFF
BANK_SIZE = 0x2000
ACTOR_TABLE_FIRST = 0xE600
ACTOR_TABLE_LAST = 0xE8FF
ACTOR_RECORD_MASK = 0xFFC0


@dataclass(frozen=True, slots=True)
class TraceProfile:
    actor_type: int | None
    memory_first: int
    memory_last: int
    trace_first_frame: int
    trace_last_frame: int
    capture_first_frame: int
    capture_last_frame: int
    capture_stride: int
    history_length: int


TRACE_PROFILES = {
    "stage4_ray_open": TraceProfile(
        actor_type=0x41,
        memory_first=ACTOR_TABLE_FIRST,
        memory_last=ACTOR_TABLE_LAST,
        trace_first_frame=5740,
        trace_last_frame=5840,
        capture_first_frame=5750,
        capture_last_frame=5840,
        capture_stride=1,
        history_length=128,
    ),
    "stage4_ray_lifecycle": TraceProfile(
        actor_type=None,
        memory_first=0xE740,
        memory_last=0xE77F,
        trace_first_frame=9470,
        trace_last_frame=9520,
        capture_first_frame=9475,
        capture_last_frame=9520,
        capture_stride=1,
        history_length=96,
    ),
    "stage4_volcano": TraceProfile(
        actor_type=0x40,
        memory_first=ACTOR_TABLE_FIRST,
        memory_last=ACTOR_TABLE_LAST,
        trace_first_frame=7420,
        trace_last_frame=7700,
        capture_first_frame=7440,
        capture_last_frame=7540,
        capture_stride=2,
        history_length=160,
    ),
}


class MappedInstructionHistory(DebugLogger):
    def __init__(self, registers, banks: list[int], capacity: int) -> None:
        super().__init__()
        self._registers = registers
        self._banks = banks
        self.entries = deque(maxlen=capacity)

    def on_step(self, pc: int, _opcode: int) -> None:
        if pc < CARTRIDGE_FIRST_ADDRESS or pc > CARTRIDGE_LAST_ADDRESS:
            return
        rom_offset, bank = mapped_banked_rom_offset(
            self._banks,
            BANK_SIZE,
            CARTRIDGE_FIRST_ADDRESS,
            pc,
        )
        registers = self._registers
        self.entries.append((
            pc,
            rom_offset,
            bank,
            registers.IX,
            registers.IY,
            registers.SP,
        ))


class Nemesis2Stage4Trace:
    def __init__(self, machine, profile: TraceProfile) -> None:
        self.machine = machine
        self.profile = profile
        self.frame = 0
        self.stage_forced = False
        self.events: list[dict[str, object]] = []
        self._read = machine.memory.read
        self._write = machine.memory.write
        self._banks = machine.memory._mapper._banks
        self.history = MappedInstructionHistory(
            machine.cpu.registers,
            self._banks,
            profile.history_length,
        )
        machine.cpu.write_byte = self.write_memory

    def begin_frame(self, frame: int) -> None:
        self.frame = frame
        if frame == self.profile.trace_first_frame:
            # The CPU logger is py-msx's instruction hook. Attaching it only
            # for the trace window avoids both unrelated diagnostics and work
            # during the thousands of setup frames.
            self.machine.cpu._logger = self.history

    def write_memory(self, address: int, value: int) -> None:
        if address == 0xE201 and value == 1 and not self.stage_forced:
            value = 4
            self.stage_forced = True

        profile = self.profile
        if (
            profile.trace_first_frame <= self.frame <= profile.trace_last_frame
            and profile.memory_first <= address <= profile.memory_last
        ):
            slot = address & ACTOR_RECORD_MASK
            actor_type = self._read(slot)
            if profile.actor_type is None or actor_type == profile.actor_type or (
                address == slot and value == profile.actor_type
            ):
                previous = self._read(address)
                if previous != value:
                    cpu = self.machine.cpu
                    registers = cpu.registers
                    rom_offset, bank = mapped_banked_rom_offset(
                        self._banks,
                        BANK_SIZE,
                        CARTRIDGE_FIRST_ADDRESS,
                        cpu.instruction_pc,
                    )
                    self.events.append({
                        "frame": self.frame,
                        "pc": cpu.instruction_pc,
                        "rom_offset": rom_offset,
                        "bank": bank,
                        "slot": slot,
                        "address": address,
                        "previous": previous,
                        "value": value,
                        "registers": {
                            "a": registers.A,
                            "bc": registers.BC,
                            "de": registers.DE,
                            "hl": registers.HL,
                            "ix": registers.IX,
                            "iy": registers.IY,
                            "sp": registers.SP,
                        },
                        "history": list(self.history.entries),
                    })

        self._write(address, value)

    def apply_controls(self) -> None:
        frame = self.frame
        input_state = self.machine.input
        if frame in (180, 300, 420):
            input_state.joystick_button_down(0, 4)
        if frame in (184, 304, 424):
            input_state.joystick_button_up(0, 4)
        if frame >= 700:
            input_state.joystick_button_down(0, 4)
            direction = (frame // 240) & 1
            input_state.joystick_button_down(0, direction)
            input_state.joystick_button_up(0, direction ^ 1)

    def retain_stage_run(self) -> None:
        self._write(0xE200, 0x99)
        self._write(0xE400, 2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Replay the deterministic Nemesis 2 stage-4 research route, record "
            "mapper-aware actor writes, and capture native RGB24 PPM frames."
        ),
    )
    parser.add_argument("profile", choices=tuple(TRACE_PROFILES))
    parser.add_argument("--rom", type=Path, default=DEFAULT_ROM_PATH)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    profile = TRACE_PROFILES[args.profile]
    config_root = PYMSX_ROOT / "config"
    machine_spec = load_machine_spec(
        MACHINE_NAME,
        config_root,
        load_device_registry(config_root),
        PYMSX_ROOT,
    )
    machine = build_machine(
        machine_spec,
        cartridge=args.rom.read_bytes(),
        mapper="auto",
    )
    trace = Nemesis2Stage4Trace(machine, profile)
    output_dir = args.output_root / args.profile
    output_dir.mkdir(parents=True, exist_ok=True)

    for frame in range(1, profile.trace_last_frame + 1):
        trace.begin_frame(frame)
        trace.apply_controls()
        capture = (
            profile.capture_first_frame <= frame <= profile.capture_last_frame
            and (frame - profile.capture_first_frame) % profile.capture_stride == 0
        )
        framebuffer = machine.run_frame(skip_render=not capture)
        trace.retain_stage_run()
        if capture:
            write_rgb24_ppm(
                output_dir / f"frame_{frame:05}.ppm",
                machine.vdp.display_width,
                OUTPUT_H,
                machine.vdp.to_rgb24(framebuffer),
            )

    result = {
        "profile": asdict(profile),
        "history_columns": ("pc", "rom_offset", "bank", "ix", "iy", "sp"),
        "stage_forced": trace.stage_forced,
        "events": trace.events,
    }
    result_path = output_dir / "trace.json"
    result_path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {result_path} ({len(trace.events)} writes, "
        f"frames {profile.trace_first_frame}..{profile.trace_last_frame})"
    )


if __name__ == "__main__":
    main()
