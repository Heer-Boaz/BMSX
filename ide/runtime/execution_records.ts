import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import { GcDiagnosticField } from '../../machine/ts/machine/cpu/gc_heap';
import { GlobalBank } from '../../machine/ts/machine/cpu/global_bank';
import { THREAD_RECORD_KIND, ThreadField, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valuePayload, valueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET } from '../../machine/ts/spec/blua32/execution_domain';

/** Inspect executable references on a stopped machine without deciding object liveness. */
export function visitRuntimeExecutionRecords(cpu: CPU, visitClosure: (closure: number) => void,
	visitThread?: (thread: number, frameDepth: number) => void): void {
	const { memory, gc } = cpu;
	const objects: number[] = [];
	const upvalues: number[] = [];
	const seen = new Set<number>();
	const layout = new ThreadLayout();
	const registers = new ValueSlots(0);
	const addRecord = (tag: ValueTag, word: number) => {
		switch (tag) {
			case ValueTag.Table: {
				const table = gc.tableRecordAddress(word);
				if (table !== 0) objects.push(table);
				break;
			}
			case ValueTag.Closure: {
				const closure = gc.closureRecordAddress(word);
				if (closure !== 0) objects.push(closure);
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

	const management = cpu.heapAllocator.managementOffset();
	for (const offset of [SYSTEM_GLOBAL_BANK_OFFSET, GLOBAL_BANK_OFFSET]) {
		const globals = new GlobalBank(memory, management + offset);
		globals.bind();
		addSlots(globals.slots, globals.count);
	}
	const completionValues: Value[] = [];
	cpu.readCompletionValues(completionValues);
	for (const value of completionValues) addValue(value);
	addRecord(gc.diagnosticWord(GcDiagnosticField.StringIndexTag), gc.diagnosticWord(GcDiagnosticField.StringIndexWord));
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
					const cell = gc.cellRecordAddress(Closure.captureAddress(memory, address, index));
					if (cell !== 0) upvalues.push(cell);
				}
				break;
			case ValueTag.Table: {
				const meta = gc.tables.metatableAddress(address);
				if (meta !== 0) addRecord(ValueTag.Table, meta);
				// A still-stored weak edge can be used again before firmware sweeps it.
				gc.tables.forEachStoredEntry(address, addTableEntry);
				break;
			}
			case THREAD_RECORD_KIND: {
				addRecord(ValueTag.Closure, memory.readRamRecordWord(address + ThreadField.Entry));
				const resumer = cpu.readThreadResumer(address);
				if (resumer !== 0) objects.push(resumer);
				addValue(cpu.readThreadError(address));
				gc.threads.readLayout(address, layout);
				visitThread?.(address, layout.depth);
				registers.bindRam(memory, layout.offset, layout.capacity, false, true);
				addSlots(registers, layout.top);
				for (let index = layout.depth - 1; index >= 0; --index) {
					const frame = gc.threads.frameAddress(layout, index);
					addRecord(ValueTag.Closure, memory.readRamRecordWord(frame + FrameField.Closure));
					let head = memory.readRamRecordWord(frame + FrameField.OpenHead);
					for (let remaining = Upvalue.UPVALUE_CHAIN_LIMIT; head !== 0 && remaining !== 0; --remaining) {
						const cell = gc.openCellAddress(head);
						if (cell === 0) break;
						upvalues.push(cell);
						head = memory.readRamRecordWord(cell + Upvalue.UPVALUE_NEXT);
					}
				}
				break;
			}
		}
	}
}
