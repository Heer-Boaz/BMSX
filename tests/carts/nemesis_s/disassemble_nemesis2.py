#!/usr/bin/env python3

from pathlib import Path
from z80dis import z80

WORKSPACE = Path(__file__).resolve().parents[3]
ROM_PATH = WORKSPACE / ".external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom"
OUT_DIR = WORKSPACE / ".external/nemesis2rom"
BASE_ADDR = 0x4000
ENTRY_ADDR = 0x4090
BANK_SIZE = 0x2000


def disassemble_range(
	rom: bytes,
	offset: int,
	limit: int,
	address: int,
	count: int,
) -> list[str]:
	lines: list[str] = []
	pc = address
	for _ in range(count):
		if offset >= limit:
			break
		decoded = z80.decode(rom[offset : min(offset + 8, limit)], pc)
		if decoded.status != z80.DECODE_STATUS.OK or decoded.len <= 0:
			lines.append(f"{pc:04X}: db 0x{rom[offset]:02X}")
			offset += 1
			pc += 1
			continue
		raw = " ".join(f"{value:02X}" for value in rom[offset : offset + decoded.len])
		lines.append(f"{pc:04X}: {raw:<20} {z80.disasm(decoded)}")
		offset += decoded.len
		pc += decoded.len
	return lines


def disassemble_from(rom: bytes, address: int, count: int) -> list[str]:
	return disassemble_range(rom, address - BASE_ADDR, len(rom), address, count)


def disassemble_banked(rom: bytes, bank: int, address: int, count: int) -> list[str]:
	offset = bank * BANK_SIZE + (address & (BANK_SIZE - 1))
	return disassemble_range(rom, offset, (bank + 1) * BANK_SIZE, address, count)


def write_entry_dump(rom: bytes) -> None:
	lines = disassemble_from(rom, ENTRY_ADDR, 1400)
	target = OUT_DIR / "disasm_entry_0x4090.txt"
	target.write_text("\n".join(lines), encoding="utf-8")
	print(f"wrote {target} ({len(lines)} lines)")


def write_segment_dump(rom: bytes) -> None:
	segments = [
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
	]
	lines: list[str] = []
	for address in segments:
		lines.append(f"\n===== {address:04X} =====")
		lines.extend(disassemble_from(rom, address, 120))
	target = OUT_DIR / "disasm_segments_candidate.txt"
	target.write_text("\n".join(lines), encoding="utf-8")
	print(f"wrote {target} ({len(lines)} lines)")


def write_stage4_banked_dump(rom: bytes) -> None:
	segments = {
		11: (0xBB06, 0xBADC, 0xBBA0, 0xBC10, 0xBE49, 0xBEE6, 0xBF10),
		2: (0x9B62,),
	}
	lines: list[str] = []
	for bank, addresses in segments.items():
		for address in addresses:
			lines.append(f"\n===== bank {bank:02X}, cpu {address:04X} =====")
			lines.extend(disassemble_banked(rom, bank, address, 120))
	target = OUT_DIR / "disasm_stage4_banked.txt"
	target.write_text("\n".join(lines), encoding="utf-8")
	print(f"wrote {target} ({len(lines)} lines)")


def write_snsmat_call_sites(rom: bytes) -> None:
	pattern = bytes((0xCD, 0x41, 0x01))  # CALL 0x0141 (SNSMAT)
	offset = 0
	call_sites: list[int] = []
	while True:
		offset = rom.find(pattern, offset)
		if offset < 0:
			break
		call_sites.append(BASE_ADDR + offset)
		offset += 1

	lines = [f"SNSMAT call sites in ROM: {len(call_sites)}"]
	for address in call_sites:
		lines.append(f"0x{address:04X}")

	target = OUT_DIR / "snsmat_call_sites.txt"
	target.write_text("\n".join(lines), encoding="utf-8")
	print(f"wrote {target} ({len(call_sites)} call sites)")


def main() -> None:
	if not ROM_PATH.exists():
		raise FileNotFoundError(f"ROM not found: {ROM_PATH}")
	rom = ROM_PATH.read_bytes()
	OUT_DIR.mkdir(parents=True, exist_ok=True)
	write_entry_dump(rom)
	write_segment_dump(rom)
	write_stage4_banked_dump(rom)
	write_snsmat_call_sites(rom)


if __name__ == "__main__":
	main()
