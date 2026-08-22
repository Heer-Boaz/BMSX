#!/usr/bin/env python3

import argparse
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path
import sys

WORKSPACE = Path(__file__).resolve().parents[2]
PYMSX_ROOT = WORKSPACE / ".external/py-msx-emulator"
sys.path.insert(0, str(WORKSPACE))
sys.path.insert(0, str(PYMSX_ROOT))

from msx.machine_loader import build_machine, load_device_registry, load_machine_spec
from msx.psg import SAMPLE_RATE, SAMPLES_PER_FRAME

from scripts.nemesis_s.trace_nemesis2 import DEFAULT_ROM_PATH, MACHINE_NAME

OUTPUT_DIR = WORKSPACE / "carts/nemesis_s/res/sound"
FIRE_FRAME = 760
FIRST_FRAME = 1
LAST_FRAME = 850
SFX_SCC_CHANNEL_MASK = 1
MUTED_PSG_VOLUME_REGISTERS = (9, 10)
STAGE_RUN_WRITES = (
    (0xE200, 0x99),
    (0xE400, 2),
)
WEAPON_LEVEL_ADDRESSES = {
    "laser": 0xE432,
    "uplaser": 0xE434,
}
WEAPON_LEVEL_RESET_ADDRESSES = (
    0xE430,
    0xE431,
    0xE432,
    0xE433,
    0xE434,
    0xE435,
    0xE436,
    0xE439,
)


@dataclass(frozen=True, slots=True)
class WeaponAudioProfile:
    family: str
    level: int
    output_name: str


PROFILES = {
    "uplaser": WeaponAudioProfile(
        family="uplaser",
        level=1,
        output_name="nemesis2_uplaser@p=3.wav",
    ),
    "extended_laser": WeaponAudioProfile(
        family="laser",
        level=3,
        output_name="nemesis2_extended_laser@p=4.wav",
    ),
}


def build_source_machine(rom: bytes, family: str, level: int):
    config_root = PYMSX_ROOT / "config"
    machine_spec = load_machine_spec(
        MACHINE_NAME,
        config_root,
        load_device_registry(config_root),
        PYMSX_ROOT,
    )
    machine = build_machine(machine_spec, cartridge=rom, mapper="auto")
    writes = list(STAGE_RUN_WRITES)
    writes.extend((address, 0) for address in WEAPON_LEVEL_RESET_ADDRESSES)
    writes.append((WEAPON_LEVEL_ADDRESSES[family], level))
    return machine, tuple(writes)


def run_source_frame(machine, retained_writes, frame: int) -> tuple[int, int]:
    input_state = machine.input
    if frame in (180, 300, 420, FIRE_FRAME):
        input_state.joystick_button_down(0, 4)
    if frame in (184, 304, 424, FIRE_FRAME + 4):
        input_state.joystick_button_up(0, 4)
    frame_start = machine.cycle_count
    machine.run_frame(skip_render=True)
    for address, value in retained_writes:
        machine.memory.write(address, value)
    return frame_start, machine.cycle_count


def sfx_channel_state(machine):
    psg = machine.psg
    scc = machine.scc
    return (
        tuple(psg.regs[:14]),
        scc._freq[0],
        scc._vol[0],
        scc._enable & SFX_SCC_CHANNEL_MASK,
    )


def render_psg_channel_zero(psg, frame_start: int, frame_end: int) -> array:
    synth_state = psg.snapshot_synth()
    registers = psg.regs[:]
    events = psg._events[:]
    base_registers = psg._regs_base[:]
    base_generator = psg._gen_base

    for register in MUTED_PSG_VOLUME_REGISTERS:
        psg.regs[register] = 0
        if psg._regs_base:
            psg._regs_base[register] = 0
    psg._events = [
        (cycle, register, 0 if register in MUTED_PSG_VOLUME_REGISTERS else value)
        for cycle, register, value in psg._events
    ]
    samples = array("h")
    samples.frombytes(psg.generate_samples(SAMPLES_PER_FRAME, frame_start, frame_end))

    psg.restore_synth(synth_state)
    psg.regs[:] = registers
    psg._events = events
    psg._regs_base = base_registers
    psg._gen_base = base_generator
    psg.generate_samples(SAMPLES_PER_FRAME, frame_start, frame_end)
    return samples


def render_scc_channel_zero(scc) -> array:
    state = scc.snapshot()
    scc._enable &= SFX_SCC_CHANNEL_MASK
    samples = array("h")
    samples.frombytes(scc.generate_samples(SAMPLES_PER_FRAME))
    scc.restore(state)
    scc.generate_samples(SAMPLES_PER_FRAME)
    return samples


def write_stereo_wave(path: Path, samples: list[int]) -> None:
    mean = sum(samples) / len(samples)
    stereo = array("h")
    for sample in samples:
        centered = round(sample - mean)
        if centered > 32767:
            centered = 32767
        elif centered < -32768:
            centered = -32768
        stereo.extend((centered, centered))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(stereo.tobytes())


def extract_profile(rom: bytes, profile: WeaponAudioProfile, output_dir: Path) -> None:
    baseline, baseline_writes = build_source_machine(rom, profile.family, 0)
    source, source_writes = build_source_machine(rom, profile.family, profile.level)
    samples: list[int] = []
    recording = False

    for frame in range(FIRST_FRAME, LAST_FRAME + 1):
        baseline_start, baseline_end = run_source_frame(baseline, baseline_writes, frame)
        source_start, source_end = run_source_frame(source, source_writes, frame)
        differs = sfx_channel_state(baseline) != sfx_channel_state(source)

        render_psg_channel_zero(baseline.psg, baseline_start, baseline_end)
        render_scc_channel_zero(baseline.scc)
        source_psg = render_psg_channel_zero(source.psg, source_start, source_end)
        source_scc = render_scc_channel_zero(source.scc)

        if frame < FIRE_FRAME:
            continue
        if not differs:
            if recording:
                break
            continue
        recording = True
        samples.extend(psg + scc for psg, scc in zip(source_psg, source_scc))

    output_path = output_dir / profile.output_name
    write_stereo_wave(output_path, samples)
    print(f"wrote {output_path} ({len(samples) / SAMPLE_RATE:.3f}s)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture the dedicated PSG/SCC effect channel for Nemesis 2 "
            "player weapons without retaining the stage music channels."
        ),
    )
    parser.add_argument("profiles", nargs="*", choices=tuple(PROFILES), default=tuple(PROFILES))
    parser.add_argument("--rom", type=Path, default=DEFAULT_ROM_PATH)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rom = args.rom.read_bytes()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for profile_name in args.profiles:
        extract_profile(rom, PROFILES[profile_name], args.output_dir)


if __name__ == "__main__":
    main()
