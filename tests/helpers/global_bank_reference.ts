import { nativeHeapReference } from './native_heap/reference';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_TRACE_HEAD, GcPhase, RemarkStage, type GcHeap } from './native_heap/gc_heap';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread_record';
import type { GlobalBank } from '../../machine/ts/machine/cpu/global_bank';
import type { StringId } from '../../machine/ts/machine/cpu/string_pool';
import { valueNil, valuePayload, valueString, valueTag, valueTagIsStorageReference, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { GlobalBankField } from '../../machine/ts/spec/blua32/execution_domain';
import { findStockGlobalName, findStockGlobalSlot, stockGlobalNameBucket, STOCK_GLOBAL_NAME_BYTES_PER_SLOT } from '../../toolchain/ts/firmware/stock_global_bank';

const GLOBAL_NAME_BUDGET_BYTES = 9;

// A GlobalBank has no weak lanes. Admission already classified this
// pair as a collector edge; only a marking epoch needs the insertion.
function writeGlobalRoot(gc: GcHeap, tag: ValueTag, word: number): void {
	const phase = gc.phase();
	if (phase < GcPhase.Mark || phase > GcPhase.Atomic) return;
	if (tag === ValueTag.String) {
		gc.markString(word);
		gc['creditBarrierMarks']();
		return;
	}
	// Before the remark detaches Changed, it replaces (not merges) Trace.
	const stage = phase === GcPhase.MarkAgain ? RemarkStage.Roots : gc['remarkStage']();
	const beforeDetach = stage <= RemarkStage.Weak && (stage !== RemarkStage.None || phase === GcPhase.Atomic);
	gc['markRecord'](word, tag === ValueTag.Thread ? THREAD_RECORD_KIND : tag,
		beforeDetach ? GC_CHANGED_HEAD : GC_TRACE_HEAD);
}

// Frozen native registration, mutation and retirement for fixtures and BIOS parity.
export function writeReferenceGlobalSlot(gc: GcHeap, bank: GlobalBank, slot: number, value: Value): void {
	const tag = valueTag(value), word = valuePayload(value);
	bank.slots.setEncoded(slot, tag, word);
	if (valueTagIsStorageReference(tag)) writeGlobalRoot(gc, tag, word);
}

export function clearReferenceGlobalBank(gc: GcHeap, bank: GlobalBank): void {
	const memory = bank['memory'], descriptor = bank['descriptor'];
	const base = memory.readRamRecordWord(descriptor + GlobalBankField.Values)
		- STOCK_GLOBAL_NAME_BYTES_PER_SLOT * memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
	if (base !== 0) gc.budget.releaseRecord(base, GLOBAL_NAME_BUDGET_BYTES * bank.count);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Values, 0);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Capacity, 0);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Count, 0);
	bank.slots.unbind();
}

function growReferenceBank(bank: GlobalBank, oldBase: number, base: number, capacity: number, count: number): void {
	const memory = bank['memory'], descriptor = bank['descriptor'];
	const offset = base & RAM_RECORD_WORD_MASK, source = oldBase & RAM_RECORD_WORD_MASK;
	const ram = memory.ramData();
	ram.fill(0, offset, offset + STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity);
	ram.copyWithin(offset, source, source + 4 * count);
	memory.invalidateRamWrite(offset, STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Values, base + STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Capacity, capacity);
	bank.slots.bindRam(memory, offset + STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity, capacity, true);
	for (let slot = 0; slot < count; ++slot) {
		const key = memory.readRamRecordWord(base + 4 * slot);
		memory.writeRamRecordWord(base + 4 * (capacity + stockGlobalNameBucket(memory, base, capacity, key)), slot + 1);
	}
}

export function registerReferenceGlobalName(gc: GcHeap, bank: GlobalBank, key: StringId, pending: Value = valueNil()): number {
	const memory = bank['memory'], descriptor = bank['descriptor'];
	let capacity = memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
	let base = memory.readRamRecordWord(descriptor + GlobalBankField.Values) - STOCK_GLOBAL_NAME_BYTES_PER_SLOT * capacity;
	const prior = findStockGlobalName(memory, base, capacity, key);
	if (prior !== undefined) return prior;
	const slot = bank.count;
	let oldBase = 0;
	if (slot === capacity) {
		capacity = capacity === 0 ? 8 : 2 * capacity;
		const backing = gc.budget.reserveBacking(17 * capacity, GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
		oldBase = base;
		growReferenceBank(bank, oldBase, backing, capacity, slot);
		base = backing;
	} else {
		gc.budget.admit(GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
	}
	const bucket = stockGlobalNameBucket(memory, base, capacity, key);
	memory.writeRamRecordWord(base + 4 * slot, key);
	bank.slots.setNil(slot);
	memory.writeRamRecordWord(base + 4 * (capacity + bucket), slot + 1);
	memory.writeRamRecordWord(descriptor + GlobalBankField.Count, slot + 1);
	gc.budget.replaceRecord(oldBase, 0, GLOBAL_NAME_BUDGET_BYTES);
	writeGlobalRoot(gc, ValueTag.String, key);
	return slot;
}

export function setReferenceGlobal(cpu: CPU, key: StringId, value: Value): void {
	const bank = cpu['globalBank'];
	const slot = registerReferenceGlobalName(nativeHeapReference(cpu).gc, bank, key, value);
	writeReferenceGlobalSlot(nativeHeapReference(cpu).gc, bank, slot, value);
}

export function setReferenceSystemGlobal(cpu: CPU, key: StringId, value: Value): void {
	const bank = cpu['systemGlobalBank'], slot = findStockGlobalSlot(cpu.memory, bank['descriptor'], key);
	if (slot === undefined)
		throw new Error(`System global '${cpu.stringPool.toString(key)}' has no register slot.`);
	writeReferenceGlobalSlot(nativeHeapReference(cpu).gc, bank, slot, value);
}
