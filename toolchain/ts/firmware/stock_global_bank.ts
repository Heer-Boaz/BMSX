import type { StringId } from '../../../machine/ts/machine/cpu/string_pool';
import { hashCanonicalTableKey, valueFromTag, valueInteger, valueNil, type Value, type ValueTag } from '../../../machine/ts/machine/cpu/value';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import { GLOBAL_BANK_OFFSET, GlobalBankField } from '../../../machine/ts/spec/blua32/execution_domain';
import { CPU_FIXED_STACK_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';

export const STOCK_GLOBAL_NAME_BYTES_PER_SLOT = 12;

export function stockGlobalNameBucket(memory: Memory, base: number, capacity: number, key: StringId): number {
	const slots = base + 4 * capacity;
	const mask = 2 * capacity - 1;
	const start = hashCanonicalTableKey(valueInteger(key)) & mask;
	let bucket = start;
	do {
		const slot = memory.readRamRecordWord(slots + 4 * bucket);
		if (slot === 0 || memory.readRamRecordWord(base + 4 * ((slot - 1) & (capacity - 1))) === key) return bucket;
		bucket = (bucket + 1) & mask;
	} while (bucket !== start);
	return start;
}

export function findStockGlobalName(memory: Memory, base: number, capacity: number, key: StringId): number | undefined {
	if (capacity === 0) return undefined;
	const stored = memory.readRamRecordWord(base + 4 * (capacity + stockGlobalNameBucket(memory, base, capacity, key)));
	const slot = (stored - 1) & (capacity - 1);
	return stored !== 0 && memory.readRamRecordWord(base + 4 * slot) === key ? slot : undefined;
}

export function readStockGlobalName(memory: Memory, descriptor: number, slot: number): StringId {
	const capacity = memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
	const values = memory.readRamRecordWord(descriptor + GlobalBankField.Values);
	return memory.readRamRecordWord(values - STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity + 4 * slot);
}

export function findStockGlobalSlot(memory: Memory, descriptor: number, key: StringId): number | undefined {
	const capacity = memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
	const values = memory.readRamRecordWord(descriptor + GlobalBankField.Values);
	return findStockGlobalName(memory, values - STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity, capacity, key);
}

/** Names are a stock firmware data structure, not part of the ordinal operand path. */
export function readStockGlobalValue(memory: Memory, key: StringId, bank = GLOBAL_BANK_OFFSET): Value {
	const descriptor = CPU_FIXED_STACK_BASE + bank;
	const capacity = memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
	const values = memory.readRamRecordWord(descriptor + GlobalBankField.Values);
	const slot = findStockGlobalName(memory, values - STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity, capacity, key);
	const slots = values & RAM_RECORD_WORD_MASK;
	return slot === undefined ? valueNil()
		: valueFromTag(memory.readRamRecordByte(slots + 4 * capacity + slot) as ValueTag, memory.readRamRecordWord(slots + 4 * slot));
}
