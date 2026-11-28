#pragma once

#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "gc_heap_reference.h"
#include "thread_storage_reference.h"

#include <algorithm>
#include <cstring>

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
	const ThreadStorageLayout layout{valueBlock, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, frameBlock};
	const u32 control = layout.frameAddress(0);
	std::fill_n(memory.ramData() + control, layout.frameBytes(), u8{0});
	memory.invalidateRamWrite(control, layout.frameBytes());
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	layout.slots(memory).clear(0, THREAD_INITIAL_VALUES);
}

inline u32 allocateThreadRecordReference(CPU& cpu, u32 entry) {
	GcHeap gc(cpu);
	auto& budget = gc.budget;
	constexpr u32 valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	constexpr u32 frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const u32 charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const Value root = entry != 0u ? valueClosure(entry) : valueNil();
	auto recovery = budget.admit(charged, root);
	if (GcHeap::pacedPhase(gc.phase())) gc.assistBeforeReservation(charged + GC_OBJECT_PREFIX, root);
	auto& arena = gc.arena;
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

inline u32 growReferenceThreadFrames(GcHeap& heap, u32 address, u32 capacity, u32 staged) {
	auto& memory = heap.memory;
	const u32 previous = ThreadRecord::count(memory, address, ThreadField::FrameCapacity);
	const u32 oldBlock = ThreadRecord::read(memory, address, ThreadField::FrameBlock);
	const u32 bytes = capacity * FRAME_CONTROL_BYTES;
	const u32 block = staged ? staged : (oldBlock ? heap.arena.resizeBacking(oldBlock, bytes) : heap.arena.allocate(bytes, true));
	if (!block) return 0;
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	auto* destination = memory.ramData() + offset;
	const u32 occupied = ThreadRecord::count(memory, address, ThreadField::FrameDepth) * FRAME_CONTROL_BYTES;
	if (staged) std::memcpy(destination, memory.ramData() + (oldBlock & RAM_RECORD_WORD_MASK), occupied);
	std::memset(destination + occupied, 0, bytes - occupied);
	const u32 dirty = staged ? 0u : occupied;
	memory.invalidateRamWrite(offset + dirty, bytes - dirty);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameBlock), block);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameCapacity), capacity);
	if (staged) heap.arena.free(oldBlock);
	heap.budget.resizeRecordCharge(previous * FRAME_CONTROL_BYTES, bytes);
	return block;
}

inline void reserveReferenceThreadStorage(GcHeap heap, u32 address, u32 valueCapacity, u32 frameCapacity, Value root) {
	const u32 valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
	const u32 frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
	const auto& memory = heap.memory;
	const u32 previousValues = valueCapacity != 0u ? ThreadRecord::read(memory, address, ThreadField::StackCapacity) * THREAD_STACK_SLOT_BYTES : 0u;
	const u32 previousFrames = frameCapacity != 0u ? ThreadRecord::count(memory, address, ThreadField::FrameCapacity) * FRAME_CONTROL_BYTES : 0u;
	if (!valueBytes && frameBytes) {
		auto recovery = heap.budget.admit(frameBytes - previousFrames, root, valueNil(), valueNil(), address);
		if (GcHeap::pacedPhase(heap.phase())) heap.assistBeforeReservation(frameBytes, root, valueNil(), valueNil(), address);
		for (;;) {
			if (growReferenceThreadFrames(heap, address, frameCapacity, 0u)) return;
			recovery = heap.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
		}
	}
	const u32 requested = valueBytes + frameBytes, previous = previousValues + previousFrames;
	auto recovery = requested > previous
		? heap.budget.admit(requested - previous, root, valueNil(), valueNil(), address)
		: LuaAllocationRecovery::CurrentOrFresh;
	if (GcHeap::pacedPhase(heap.phase())) heap.assistBeforeReservation(requested, root, valueNil(), valueNil(), address);
	auto& arena = heap.arena;
	for (;;) {
		// Stage control storage first: a successful realloc can consume the
		// old stack. There must be no fallible reservation after that point.
		const u32 frames = frameBytes ? arena.allocate(frameBytes, true) : 0u;
		if (!frameBytes || frames) {
			if (!valueBytes || resizeReferenceThreadBacking(heap, address, valueCapacity)) {
				if (frames) growReferenceThreadFrames(heap, address, frameCapacity, frames);
				return;
			}
			if (frames) arena.free(frames);
		}
		recovery = heap.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
	}
}

inline void resizeReferenceThreadStack(GcHeap heap, Thread& thread, size_t capacity) {
	if (capacity == thread.stackCapacity) return;
	if (capacity < thread.stackCapacity)
		resizeReferenceThreadBacking(heap, thread.address, static_cast<u32>(capacity));
	else reserveReferenceThreadStorage(heap, thread.address, static_cast<u32>(capacity), 0u, valueNil());
	thread.bindStack();
}

inline void reserveReferenceThreadFrame(GcHeap heap, Thread& thread, size_t valueEnd) {
	// The last control slot is reserved for an exception activation.
	const u32 currentFrames = ThreadRecord::count(heap.memory, thread.address, ThreadField::FrameCapacity);
	const size_t wanted = std::max<size_t>(THREAD_INITIAL_FRAMES, thread.frameDepth() + 2u);
	if (valueEnd <= thread.stackCapacity && wanted <= currentFrames) return;
	u32 frames = std::max(THREAD_INITIAL_FRAMES, currentFrames);
	while (frames < wanted) frames *= 2;
	const u32 valueChange = valueEnd <= thread.stackCapacity ? 0u : static_cast<u32>(std::max<size_t>(THREAD_INITIAL_VALUES, nextPowerOfTwo(valueEnd)));
	const u32 frameChange = frames == currentFrames ? 0u : frames;
	reserveReferenceThreadStorage(heap, thread.address, valueChange, frameChange, valueNil());
	thread.bindStack();
}

} // namespace bmsx::test
