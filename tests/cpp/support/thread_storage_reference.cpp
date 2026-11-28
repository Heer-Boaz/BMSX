#include "thread_storage_reference.h"

#include <algorithm>
#include <cstring>

#include "gc_heap_reference.h"

namespace bmsx::test {

bool resizeReferenceThreadBacking(GcHeap& heap, u32 address, u32 capacity) {
	auto& memory = heap.memory;
	const u32 old = ThreadRecord::read(memory, address, ThreadField::StackBlock);
	const u32 previous = ThreadRecord::read(memory, address, ThreadField::StackCapacity);
	const u32 bytes = capacity * THREAD_STACK_SLOT_BYTES;
	u32 block = old;
	if (capacity > previous) {
		block = heap.arena.resizeBacking(old, bytes);
		if (!block) return false;
	}
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	auto* data = memory.ramData() + offset;
	const u32 kept = std::min(previous, capacity);
	// realloc preserves the old planes as bytes. Move tags before clearing
	// new words on growth, and before releasing the suffix on shrink.
	std::memmove(data + capacity * sizeof(u32), data + previous * sizeof(u32), kept);
	if (capacity > previous) {
		std::memset(data + previous * sizeof(u32), 0, (capacity - previous) * sizeof(u32));
		std::memset(data + capacity * sizeof(u32) + previous, 0, capacity - previous);
	}
	memory.invalidateRamWrite(offset + kept * sizeof(u32), bytes - kept * sizeof(u32));
	if (capacity < previous) heap.arena.shrinkBacking(old, bytes);
	memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::StackBlock), block, capacity);
	heap.budget.resizeRecordCharge(previous * THREAD_STACK_SLOT_BYTES, bytes);
	return true;
}

u32 shrinkReferenceThreadStack(GcHeap& heap, u32 address, const ThreadStorageLayout& layout) {
	auto& memory = heap.memory;
	const u32 depth = ThreadRecord::count(memory, address, ThreadField::FrameDepth);
	u32 used = ThreadRecord::read(memory, address, ThreadField::StackTop) & FRAME_WINDOW_MASK;
	u32 retained = 0;
	if (layout.valueCapacity > 16) {
		for (u32 index = 0; index < depth && static_cast<u64>(used) * 3 < layout.valueCapacity; ++index) {
			const u32 frame = layout.frameAddress(index);
			const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
			const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
			used = std::max(used, base + capacity);
		}
		if (static_cast<u64>(used) * 3 < layout.valueCapacity) {
			const u32 next = layout.valueCapacity / 2, bytes = next * THREAD_STACK_SLOT_BYTES;
			resizeReferenceThreadBacking(heap, address, next);
			retained = bytes;
		}
	}
	// The occupied frame prefix has no capacity-relative fields. Keep it in
	// place, clearing the retained spare records just as on fresh reservation.
	if (layout.frameCapacity > 4 && depth * 3 < layout.frameCapacity) {
		const u32 next = layout.frameCapacity / 2, bytes = next * FRAME_CONTROL_BYTES;
		const u32 occupied = depth * FRAME_CONTROL_BYTES;
		const u32 spare = (layout.frameBlock & RAM_RECORD_WORD_MASK) + occupied;
		std::memset(memory.ramData() + spare, 0, bytes - occupied);
		memory.invalidateRamWrite(spare, bytes - occupied);
		heap.arena.shrinkBacking(layout.frameBlock, bytes);
		memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameCapacity), next);
		heap.budget.resizeRecordCharge(layout.frameBytes(), bytes);
		retained += bytes;
	}
	return retained;
}

} // namespace bmsx::test
