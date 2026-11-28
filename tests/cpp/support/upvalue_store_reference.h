#pragma once

#include "machine/cpu/cpu.h"
#include "gc_heap_reference.h"
#include "machine/cpu/upvalue.h"

namespace bmsx::test {

// Former native SETUP/debug write, kept as an independent policy reference.
inline void storeUpvalueReference(CPU& cpu, u32 address, Value value) {
	GcHeap heap(cpu);
	auto& memory = heap.memory;
	const u32 cell = address & UPVALUE_ADDRESS_MASK;
	if (Upvalue::tryStoreDirect(memory, cell, value)) return;
	if ((memory.readRamRecordByte(cell + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u) {
		if (heap.phase() == GcPhase::MarkAgain) {
			heap.markValue(value);
			// MarkAgain only credits the current epoch.
			if (const auto work = cpu.stringPool().takeMarkWork()) {
				const u32 offset = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_EPOCH_WORK;
				memory.writeRamRecordWord(offset, heap.epochWork() + static_cast<u32>(work));
			}
		} else {
			const u32 queue = heap.changedHeadOffset();
			memory.writeRamRecordWord(cell + UPVALUE_NEXT, memory.readRamRecordWord(queue) & GC_GRAY_INDEX_MASK);
			memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 2);
			memory.writeRamRecordWord(queue, (cell & GC_RECORD_MASK) >> GC_RECORD_SHIFT);
		}
	}
	memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, valuePayload(value));
	memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, static_cast<u8>(valueTag(value)));
}

} // namespace bmsx::test
