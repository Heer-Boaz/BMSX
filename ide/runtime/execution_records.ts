import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import { GC_OBJECT_PREFIX, GC_RECORD_MASK } from '../../machine/ts/machine/cpu/gc_object';
import { GlobalBank } from '../../machine/ts/machine/cpu/global_bank';
import { THREAD_RECORD_KIND, ThreadField, ThreadLayout, ThreadRecords } from '../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valuePayload, valueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET } from '../../machine/ts/spec/blua32/execution_domain';
import { CPU_FIXED_STACK_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

/** Inspect executable references on a stopped machine without deciding object liveness. */
export function visitRuntimeExecutionRecords(cpu: CPU, visitClosure: (closure: number) => void,
	visitThread?: (thread: number, frameDepth: number) => void): void {
	const { memory, tables, heapAllocator } = cpu;
	const objects: number[] = [];
	const upvalues: number[] = [];
	const seen = new Set<number>();
	const threads = new ThreadRecords(memory);
	const layout = new ThreadLayout();
	const registers = new ValueSlots(0);
	// Stored weak edges can outlive the backings they name. Keep the stopped
	// inspection's issued-record check, not the collector's marking policy.
	const issuedRecord = (reference: number, kind: number) => {
		const offset = reference & GC_RECORD_MASK;
		return memory.readRamRecordByte(offset) === kind
			&& heapAllocator.issuedObjectStart(offset - GC_OBJECT_PREFIX) ? RAM_BASE + offset : 0;
	};
	const addRecord = (tag: ValueTag, word: number) => {
		switch (tag) {
			case ValueTag.Table:
			case ValueTag.Closure: {
				const address = issuedRecord(word, tag);
				if (address !== 0) objects.push(address);
				break;
			}
			case ValueTag.Thread:
				objects.push(word);
				break;
		}
	};
	const addValue = (value: Value) => addRecord(valueTag(value), valuePayload(value));
	const addTableEntry = (key: Value, value: Value) => {
		addValue(key);
		addValue(value);
	};
	const addSlots = (slots: ValueSlots, count: number) => {
		for (let index = 0; index < count; ++index) addRecord(slots.getTag(index), slots.getPayload(index));
	};

	for (const offset of [SYSTEM_GLOBAL_BANK_OFFSET, GLOBAL_BANK_OFFSET]) {
		const globals = new GlobalBank(memory, CPU_FIXED_STACK_BASE + offset);
		globals.bind();
		addSlots(globals.slots, globals.count);
	}
	const completionValues: Value[] = [];
	cpu.readCompletionValues(completionValues);
	for (const value of completionValues) addValue(value);
	addRecord(ValueTag.Table, cpu.stringIndexTableAddress);
	objects.push(cpu.rootThread.address, cpu.activeThread.address);
	if (cpu.completionThreadAddress !== 0) objects.push(cpu.completionThreadAddress);
	if (cpu.haltedUntilIrqThreadAddress !== 0) objects.push(cpu.haltedUntilIrqThreadAddress);

	while (objects.length !== 0 || upvalues.length !== 0) {
		if (upvalues.length !== 0) {
			const cell = upvalues.pop()!;
			if (seen.has(cell)) continue;
			seen.add(cell);
			if (Upvalue.isOpen(memory, cell)) {
				const thread = memory.readRamRecordWord(cell + Upvalue.UPVALUE_OWNER);
				if (thread !== 0) objects.push(thread);
			}
			addValue(Upvalue.load(memory, cell));
			continue;
		}
		const address = objects.pop()!;
		if (seen.has(address)) continue;
		seen.add(address);
		switch (memory.readRamRecordByte(address)) {
			case ValueTag.Closure:
				visitClosure(address);
				for (let index = 0, count = Closure.captureCount(memory, address); index < count; ++index) {
					const cell = issuedRecord(Closure.captureAddress(memory, address, index), Upvalue.UPVALUE_RECORD_KIND);
					if (cell !== 0) upvalues.push(cell);
				}
				break;
			case ValueTag.Table: {
				const meta = tables.metatableAddress(address);
				if (meta !== 0) addRecord(ValueTag.Table, meta);
				// A still-stored weak edge can be used again before firmware sweeps it.
				tables.forEachStoredEntry(address, addTableEntry);
				break;
			}
			case THREAD_RECORD_KIND: {
				addRecord(ValueTag.Closure, memory.readRamRecordWord(address + ThreadField.Entry));
				const resumer = cpu.readThreadResumer(address);
				if (resumer !== 0) objects.push(resumer);
				addValue(cpu.readThreadError(address));
				threads.readLayout(address, layout);
				visitThread?.(address, layout.depth);
				registers.bindRam(memory, layout.offset, layout.capacity, false, true);
				addSlots(registers, layout.top);
				for (let index = layout.depth - 1; index >= 0; --index) {
					const frame = threads.frameAddress(layout, index);
					addRecord(ValueTag.Closure, memory.readRamRecordWord(frame + FrameField.Closure));
					let head = memory.readRamRecordWord(frame + FrameField.OpenHead);
					for (let remaining = Upvalue.UPVALUE_CHAIN_LIMIT; head !== 0 && remaining !== 0; --remaining) {
						const cell = issuedRecord(head, Upvalue.UPVALUE_RECORD_KIND);
						if (cell === 0 || !Upvalue.isOpen(memory, cell)) break;
						upvalues.push(cell);
						head = memory.readRamRecordWord(cell + Upvalue.UPVALUE_NEXT);
					}
				}
				break;
			}
		}
	}
}
