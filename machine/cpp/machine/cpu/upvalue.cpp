#include "machine/cpu/upvalue.h"

#include "common/endian.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/thread.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {
struct CapturePorts {
	u32 word;
	u32 tag;
};

CapturePorts openCapturePorts(const Memory& memory, u32 cell, u32 slot) {
	const u32 owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
	const u32 block = memory.readRamRecordWord(owner + static_cast<u32>(ThreadField::StackBlock)) & RAM_RECORD_WORD_MASK;
	const u32 capacity = memory.readRamRecordWord(owner + static_cast<u32>(ThreadField::StackCapacity));
	return {block + 4u * slot, block + 4u * capacity + slot};
}
}

void Upvalue::initialize(Memory& memory, u32 address, u8 white) {
	memory.writeRamRecordPair(address, UPVALUE_RECORD_KIND | (static_cast<u32>(white) << 8u), 0u);
	memory.writeRamRecordPair(address + UPVALUE_OWNER, 0u, 0u);
}

bool Upvalue::isOpen(const Memory& memory, u32 address) {
	return (memory.readRamRecordByte((address & UPVALUE_ADDRESS_MASK) + UPVALUE_FLAGS) & UPVALUE_OPEN) != 0;
}

void Upvalue::bindOpen(Memory& memory, u32 address, u32 owner, u32 slot, u32 next) {
	const u32 offset = address & UPVALUE_ADDRESS_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] = UPVALUE_OPEN;
	writeLE32(record + UPVALUE_VALUE_WORD, slot);
	writeLE32(record + UPVALUE_OWNER, owner);
	writeLE32(record + UPVALUE_NEXT, next);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

void Upvalue::close(GcHeap& heap, u32 address) {
	auto& memory = heap.memory;
	const Value captured = load(memory, address);
	const u32 offset = address & UPVALUE_ADDRESS_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
	record[UPVALUE_VALUE_TAG] = static_cast<u8>(valueTag(captured));
	writeLE32(record + UPVALUE_VALUE_WORD, valuePayload(captured));
	writeLE32(record + UPVALUE_OWNER, 0);
	writeLE32(record + UPVALUE_NEXT, 0);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
	if (valueTagHasGcEdge(valueTag(captured))) heap.writeBarrier(offset, UPVALUE_NEXT);
}

Value Upvalue::load(const Memory& memory, u32 address) {
	const u32 cell = address & UPVALUE_ADDRESS_MASK;
	const u32 word = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	if (!isOpen(memory, cell))
		return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG)), word);
	const auto ports = openCapturePorts(memory, cell, word);
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(ports.tag)), memory.readRamRecordWord(ports.word));
}

bool Upvalue::tryStoreWithoutBarrier(Memory& memory, u32 cell, Value value) {
	CapturePorts ports{cell + UPVALUE_VALUE_WORD, cell + UPVALUE_VALUE_TAG};
	if ((memory.readRamRecordByte(cell + UPVALUE_FLAGS) & UPVALUE_OPEN) != 0u) {
		ports = openCapturePorts(memory, cell, memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD));
	} else if (valueTagHasGcEdge(valueTag(value))
		&& (memory.readRamRecordByte(cell + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u) {
		return false;
	}
	memory.writeRamRecordWord(ports.word, valuePayload(value));
	memory.writeRamRecordByte(ports.tag, static_cast<u8>(valueTag(value)));
	return true;
}

void Upvalue::store(GcHeap& heap, u32 address, Value value) {
	auto& memory = heap.memory;
	const u32 cell = address & UPVALUE_ADDRESS_MASK;
	if (tryStoreWithoutBarrier(memory, cell, value)) return;
	heap.writeBlackClosedValue(cell, value);
	memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, valuePayload(value));
	memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, static_cast<u8>(valueTag(value)));
}
} // namespace bmsx
