#!/usr/bin/env python3

import argparse
import sys
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]
PYMSX_ROOT = WORKSPACE / ".external/py-msx-emulator"
sys.path.insert(0, str(PYMSX_ROOT))

from scripts.research.msx.z80_rom import (
    disassemble_banked,
    disassemble_linear,
    find_bytes,
)

DEFAULT_ROM_PATH = WORKSPACE / ".external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom"
DEFAULT_OUTPUT_DIR = WORKSPACE / ".external/nemesis2rom"
BASE_ADDRESS = 0x4000
BANK_SIZE = 0x2000

ENTRY_SEGMENTS = (
    0x47E0,
    0x4845,
    0x4889,
    0x5928,
    0x5A22,
    0x5D30,
    0x6790,
    0x68E4,
    0x6900,
    0x67B9,
    0x6826,
    0x6A27,
    0x6ACC,
    0x6B85,
    0x781C,
    0x7930,
    0x7946,
    0x7A00,
    0x81DA,
    0x827C,
    0x8388,
    0x87A4,
    0x9034,
    0x90C6,
    0x9167,
    0x92C1,
    0x92F6,
    0xAB92,
    0xAC30,
    0xB0B4,
    0xB0FB,
    0xBECA,
)

STAGE4_BANKED_SEGMENTS = {
    0x0B: (0xBB06, 0xBADC, 0xBBA0, 0xBC10, 0xBE49, 0xBEE6, 0xBF10),
    0x02: (0x9B62,),
}


def write_lines(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {path} ({len(lines)} lines)")


def write_entry_dump(rom: bytes, output_dir: Path) -> None:
    lines = list(disassemble_linear(rom, BASE_ADDRESS, 0x4090, 1400))
    write_lines(output_dir / "disasm_entry_0x4090.txt", lines)


def write_segment_dump(rom: bytes, output_dir: Path) -> None:
    lines: list[str] = []
    for address in ENTRY_SEGMENTS:
        lines.append(f"\n===== {address:04X} =====")
        lines.extend(disassemble_linear(rom, BASE_ADDRESS, address, 120))
    write_lines(output_dir / "disasm_segments_candidate.txt", lines)


def write_stage4_banked_dump(rom: bytes, output_dir: Path) -> None:
    lines: list[str] = []
    for bank, addresses in STAGE4_BANKED_SEGMENTS.items():
        for address in addresses:
            lines.append(f"\n===== bank {bank:02X}, cpu {address:04X} =====")
            lines.extend(disassemble_banked(rom, BANK_SIZE, bank, address, 120))
    write_lines(output_dir / "disasm_stage4_banked.txt", lines)


def write_snsmat_call_sites(rom: bytes, output_dir: Path) -> None:
    call_sites = list(find_bytes(rom, bytes((0xCD, 0x41, 0x01)), BASE_ADDRESS))
    lines = [f"SNSMAT call sites in ROM: {len(call_sites)}"]
    lines.extend(f"0x{address:04X}" for address in call_sites)
    path = output_dir / "snsmat_call_sites.txt"
    write_lines(path, lines)
    print(f"found {len(call_sites)} SNSMAT call sites")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reproduce the mapper-aware Nemesis 2 disassembly used by nemesis_s.",
    )
    parser.add_argument("--rom", type=Path, default=DEFAULT_ROM_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rom = args.rom.read_bytes()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_entry_dump(rom, args.output_dir)
    write_segment_dump(rom, args.output_dir)
    write_stage4_banked_dump(rom, args.output_dir)
    write_snsmat_call_sites(rom, args.output_dir)


if __name__ == "__main__":
    main()
