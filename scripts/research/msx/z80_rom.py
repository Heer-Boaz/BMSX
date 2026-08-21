from collections.abc import Iterator

from msx.debugger.disasm import disassemble


def banked_rom_offset(bank_size: int, bank: int, cpu_address: int) -> int:
    return bank * bank_size + (cpu_address & (bank_size - 1))


def mapped_banked_rom_offset(
    banks: list[int],
    bank_size: int,
    first_cpu_window: int,
    cpu_address: int,
) -> tuple[int, int]:
    window = (cpu_address - first_cpu_window) // bank_size
    bank = banks[window]
    return banked_rom_offset(bank_size, bank, cpu_address), bank


def disassemble_range(
    rom: bytes,
    file_offset: int,
    file_limit: int,
    cpu_address: int,
    instruction_count: int,
) -> Iterator[str]:
    pc = cpu_address
    offset = file_offset
    address_delta = file_offset - cpu_address

    def read(address: int) -> int:
        return rom[address + address_delta]

    for _ in range(instruction_count):
        if offset >= file_limit:
            return
        mnemonic, byte_count = disassemble(read, pc)
        raw = " ".join(f"{value:02X}" for value in rom[offset:offset + byte_count])
        yield f"{pc:04X}: {raw:<20} {mnemonic}"
        offset += byte_count
        pc += byte_count


def disassemble_linear(
    rom: bytes,
    base_address: int,
    cpu_address: int,
    instruction_count: int,
) -> Iterator[str]:
    return disassemble_range(
        rom,
        cpu_address - base_address,
        len(rom),
        cpu_address,
        instruction_count,
    )


def disassemble_banked(
    rom: bytes,
    bank_size: int,
    bank: int,
    cpu_address: int,
    instruction_count: int,
) -> Iterator[str]:
    bank_offset = bank * bank_size
    return disassemble_range(
        rom,
        banked_rom_offset(bank_size, bank, cpu_address),
        bank_offset + bank_size,
        cpu_address,
        instruction_count,
    )


def find_bytes(rom: bytes, pattern: bytes, base_address: int) -> Iterator[int]:
    offset = rom.find(pattern)
    while offset >= 0:
        yield base_address + offset
        offset = rom.find(pattern, offset + 1)
