#pragma once

#include "machine/cpu/call_state.h"
#include "machine/cpu/gc_object.h"

namespace bmsx {

class GcHeap;

enum class ThreadStatus : u32 { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 5;
constexpr u32 THREAD_INITIAL_VALUES = 8;
constexpr u32 THREAD_INITIAL_FRAMES = 2;
constexpr u32 THREAD_INITIAL_BACKING_BYTES = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
constexpr u32 THREAD_RECORD_KIND = 4;

enum class ThreadField : u32 {
	Header = 0, Gray = GC_RECORD_LINK, Status = 8, Resumer = 12, Entry = 16, StackTop = 20, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	FrameDepth = 56, ProtectedDepth = 60
};

// Eighteen count bits span the largest control reservation in the RAM bank.
constexpr u32 THREAD_CONTROL_COUNT_MASK = (1u << 18) - 1;

struct ThreadStackLayout {
	u32 block;
	u32 valueCapacity;
	u32 frameCapacity;
	u32 protectedCapacity;

	u32 offset() const { return block & RAM_RECORD_WORD_MASK; }
	u32 controlOffset() const { return (valueCapacity * THREAD_STACK_SLOT_BYTES + 3u) & ~3u; }
	u32 byteLength() const {
		return controlOffset() + frameCapacity * FRAME_CONTROL_BYTES + protectedCapacity * PROTECTED_CALL_BYTES;
	}
	u32 frameAddress(u32 index) const { return offset() + controlOffset() + index * FRAME_CONTROL_BYTES; }
	u32 protectedAddress(u32 index) const { return frameAddress(frameCapacity) + index * PROTECTED_CALL_BYTES; }
	ValueSpan slots(Memory& memory, bool wideWindow = false) const {
		const u32 start = offset();
		return {memory, start, start + valueCapacity * static_cast<u32>(sizeof(u32)), valueCapacity,
			wideWindow || valueCapacity > (MAIN_RAM_SIZE - start) / THREAD_STACK_SLOT_BYTES};
	}
};

namespace ThreadRecord {
inline u32 read(const Memory& memory, u32 address, ThreadField field) {
	return memory.readRamRecordWord(address + static_cast<u32>(field));
}
inline u32 count(const Memory& memory, u32 address, ThreadField field) {
	return read(memory, address, field) & THREAD_CONTROL_COUNT_MASK;
}
inline ThreadStackLayout stackLayout(const Memory& memory, u32 address) {
	return {
		read(memory, address, ThreadField::StackBlock),
		read(memory, address, ThreadField::StackCapacity),
		count(memory, address, ThreadField::FrameCapacity),
		count(memory, address, ThreadField::ProtectedCapacity),
	};
}
inline Value error(const Memory& memory, u32 address) {
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(address + static_cast<u32>(ThreadField::ErrorKind))),
		read(memory, address, ThreadField::ErrorWord));
}
void initialize(GcHeap&, u32 address, u32 entry);
void relocateStack(GcHeap&, u32 address, const ThreadStackLayout& from, const ThreadStackLayout& to);
u32 shrinkStack(GcHeap&, u32 address, const ThreadStackLayout& layout);
}

} // namespace bmsx
