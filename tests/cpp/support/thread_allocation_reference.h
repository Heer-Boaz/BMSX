#pragma once

#include "machine/cpu/cpu.h"

#include <algorithm>

namespace bmsx::test {

// Frozen native Thread constructor from 2d84747d2, for independent RAM and recovery comparison only.
inline void initializeReferenceThread(GcHeap& heap, u32 address, u32 valueBlock, u32 frameBlock, u32 entry) {
	auto& memory = heap.memory;
	const u32 offset = address & RAM_RECORD_WORD_MASK;
	auto* record = memory.ramData() + offset;
	std::fill_n(record, THREAD_HEAP_BYTES, u8{0});
	writeLE32(record, THREAD_RECORD_KIND | (static_cast<u32>(heap.white()) << 8u));
	writeLE32(record + static_cast<u32>(ThreadField::Entry), entry);
	writeLE32(record + static_cast<u32>(ThreadField::StackBlock), valueBlock);
	writeLE32(record + static_cast<u32>(ThreadField::FrameBlock), frameBlock);
	writeLE32(record + static_cast<u32>(ThreadField::StackCapacity), THREAD_INITIAL_VALUES);
	writeLE32(record + static_cast<u32>(ThreadField::FrameCapacity), THREAD_INITIAL_FRAMES);
	const ThreadStorageLayout layout{valueBlock, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, 0u, frameBlock, 0u};
	const u32 control = layout.frameAddress(0);
	std::fill_n(memory.ramData() + control, layout.frameBytes(), u8{0});
	memory.invalidateRamWrite(control, layout.frameBytes());
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	layout.slots(memory).clear(0, THREAD_INITIAL_VALUES);
}

inline u32 allocateThreadRecordReference(CPU& cpu, u32 entry) {
	auto& budget = cpu.luaHeap();
	auto& gc = cpu.gcHeap();
	constexpr u32 valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	constexpr u32 frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const u32 charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const Value root = entry != 0u ? valueClosure(entry) : valueNil();
	auto recovery = budget.admit(charged, root);
	if (GcHeap::pacedPhase(gc.phase())) gc.assistBeforeReservation(charged + GC_OBJECT_PREFIX, root);
	auto& arena = cpu.heapAllocator();
	for (;;) {
		if (const u32 block = arena.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false)) {
			if (const u32 values = arena.allocate(valueBytes, true)) {
				if (const u32 frames = arena.allocate(frameBytes, true)) {
					const u32 address = block + GC_OBJECT_PREFIX;
					initializeReferenceThread(gc, address, values, frames, entry);
					gc.publishObject(address);
					budget.resizeRecordCharge(0, charged);
					return address;
				}
				arena.free(values);
			}
			arena.free(block);
		}
		recovery = gc.recoverAllocation(recovery, root);
	}
}

} // namespace bmsx::test
