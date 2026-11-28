import { nativeHeapReference } from './native_heap/reference';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { close, tryStoreDirect, UPVALUE_ADDRESS_MASK, UPVALUE_NEXT, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { type ValueTag, valueFromTag, valueTagHasGcEdge } from '../../machine/ts/machine/cpu/value';
import { GC_LAST_EPOCH_WORK, GcPhase } from './native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from './firmware_heap_layout';

// The former native SETUP/debug closed-cell policy, retained only for differential tests.
export function writeBlackClosedValueReference(cpu: CPU, cell: number, tag: ValueTag, word: number): void {
	const { memory } = cpu, { gc, stringPool } = nativeHeapReference(cpu);
	if (gc.phase() === GcPhase.MarkAgain) {
		gc.markValue(valueFromTag(tag, word));
		const work = stringPool.takeMarkWork();
		// MarkAgain is an active epoch, so this credits only the current-work word.
		if (work !== 0) {
			const offset = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK - 4;
			memory.writeRamRecordWord(offset, gc.epochWork() + work);
		}
	} else {
		const queue = gc.changedHeadOffset();
		memory.writeRamRecordWord(cell + UPVALUE_NEXT, memory.readRamRecordWord(queue) & GC_GRAY_INDEX_MASK);
		const color = cell + GC_COLOR_OFFSET;
		memory.writeRamRecordByte(color, (memory.readRamRecordByte(color) & ~GC_COLOR_MASK) | 2);
		memory.writeRamRecordWord(queue, (cell & GC_RECORD_MASK) >>> GC_RECORD_SHIFT);
	}
}

export function writeClosedValueReference(cpu: CPU, cell: number, tag: ValueTag, word: number): void {
	if (!valueTagHasGcEdge(tag) || (cpu.memory.readRamRecordByte(cell + GC_COLOR_OFFSET) & GC_COLOR_MASK) !== 3) return;
	writeBlackClosedValueReference(cpu, cell, tag, word);
}

export function storeUpvalueReference(cpu: CPU, address: number, tag: ValueTag, word: number): void {
	const { memory } = cpu;
	const cell = address & UPVALUE_ADDRESS_MASK;
	if (tryStoreDirect(memory, cell, tag, word)) return;
	writeClosedValueReference(cpu, cell, tag, word);
	memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, word);
	memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, tag);
}

export function closeUpvalueReference(cpu: CPU, address: number): void {
	const cell = address & UPVALUE_ADDRESS_MASK;
	close(cpu.memory, cell);
	if (valueTagHasGcEdge(cpu.memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG))) nativeHeapReference(cpu).gc.writeBarrier(cell, UPVALUE_NEXT);
}
