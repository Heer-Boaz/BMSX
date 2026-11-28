import { writeLE32 } from '../../../machine/ts/common/endian';
import {
	UPVALUE_ADDRESS_MASK, UPVALUE_FLAGS, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OPEN,
	UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD,
} from '../../../machine/ts/machine/cpu/upvalue';
import type { Memory } from '../../../machine/ts/machine/memory/memory';

export function initialize(memory: Memory, address: number, white: number): void {
	memory.writeRamRecordPair(address, UPVALUE_RECORD_KIND | (white << 8), 0);
	memory.writeRamRecordPair(address + UPVALUE_OWNER, 0, 0);
}

export function bindOpen(memory: Memory, address: number, owner: number, slot: number, next: number): void {
	const offset = address & UPVALUE_ADDRESS_MASK;
	const ram = memory.ramData();
	ram[offset + UPVALUE_FLAGS] = UPVALUE_OPEN;
	writeLE32(ram, offset + UPVALUE_VALUE_WORD, slot);
	writeLE32(ram, offset + UPVALUE_OWNER, owner);
	writeLE32(ram, offset + UPVALUE_NEXT, next);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}
