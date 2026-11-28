#include "machine/cpu/upvalue.h"

#include "common/endian.h"
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

bool Upvalue::isOpen(const Memory& memory, u32 address) {
	return (memory.readRamRecordByte((address & RAM_REFERENCE_MASK) + UPVALUE_FLAGS) & UPVALUE_OPEN) != 0;
}

void Upvalue::close(Memory& memory, u32 address) {
	const Value captured = load(memory, address);
	const u32 offset = address & RAM_REFERENCE_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
	record[UPVALUE_VALUE_TAG] = static_cast<u8>(valueTag(captured));
	writeLE32(record + UPVALUE_VALUE_WORD, valuePayload(captured));
	writeLE32(record + UPVALUE_OWNER, 0);
	writeLE32(record + UPVALUE_NEXT, 0);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

Value Upvalue::load(const Memory& memory, u32 address) {
	const u32 cell = address & RAM_REFERENCE_MASK;
	const u32 word = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	if (!isOpen(memory, cell))
		return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG)), word);
	const auto ports = openCapturePorts(memory, cell, word);
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(ports.tag)), memory.readRamRecordWord(ports.word));
}

bool Upvalue::tryStoreDirect(Memory& memory, u32 cell, Value value) {
	CapturePorts ports{cell + UPVALUE_VALUE_WORD, cell + UPVALUE_VALUE_TAG};
	if ((memory.readRamRecordByte(cell + UPVALUE_FLAGS) & UPVALUE_OPEN) != 0u) {
		ports = openCapturePorts(memory, cell, memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD));
	} else if (valueTagIsStorageReference(valueTag(value))) {
		return false;
	}
	memory.writeRamRecordWord(ports.word, valuePayload(value));
	memory.writeRamRecordByte(ports.tag, static_cast<u8>(valueTag(value)));
	return true;
}
} // namespace bmsx
