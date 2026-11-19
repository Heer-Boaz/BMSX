#include "machine/cpu/closure.h"

#include "machine/cpu/thread.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {
constexpr u32 CELL_MASK = MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;

struct CapturePorts {
	u32 word;
	u32 tag;
};

CapturePorts capturePorts(const Memory& memory, u32 cell) {
	if ((memory.readRamRecordByte(cell + UPVALUE_FLAGS) & UPVALUE_OPEN) == 0)
		return {cell + UPVALUE_VALUE_WORD, cell + UPVALUE_VALUE_TAG};
	const u32 owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
	const u32 block = memory.readRamRecordWord(owner + static_cast<u32>(ThreadField::StackBlock)) & RAM_RECORD_WORD_MASK;
	const u32 capacity = memory.readRamRecordWord(owner + static_cast<u32>(ThreadField::StackCapacity));
	const u32 slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	return {block + 4u * slot, block + 4u * capacity + slot};
}
}

bool Upvalue::isOpen(const Memory& memory, u32 address) {
	return (memory.readRamRecordByte((address & CELL_MASK) + UPVALUE_FLAGS) & UPVALUE_OPEN) != 0;
}
bool Upvalue::isOpen() const { return isOpen(memory, address); }
u32 Upvalue::stackSlot() const { return memory.readRamRecordWord(address + UPVALUE_VALUE_WORD); }
u32 Upvalue::ownerAddress() const { return memory.readRamRecordWord(address + UPVALUE_OWNER); }
u32 Upvalue::nextAddress() const { return memory.readRamRecordWord(address + UPVALUE_NEXT); }
void Upvalue::setNextAddress(u32 next) { memory.writeRamRecordWord(address + UPVALUE_NEXT, next); }

void Upvalue::bind(u32 owner, u32 slot, u32 next) {
	const u32 offset = address & CELL_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] = UPVALUE_OPEN;
	writeLE32(record + UPVALUE_VALUE_WORD, slot);
	writeLE32(record + UPVALUE_OWNER, owner);
	writeLE32(record + UPVALUE_NEXT, next);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

void Upvalue::close() {
	const Value captured = value();
	writeBarrier();
	const u32 offset = address & CELL_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
	record[UPVALUE_VALUE_TAG] = static_cast<u8>(valueTag(captured));
	writeLE32(record + UPVALUE_VALUE_WORD, valuePayload(captured));
	writeLE32(record + UPVALUE_OWNER, 0);
	writeLE32(record + UPVALUE_NEXT, 0);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

Value Upvalue::load(const Memory& memory, u32 address) {
	const auto ports = capturePorts(memory, address & CELL_MASK);
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(ports.tag)), memory.readRamRecordWord(ports.word));
}

void Upvalue::store(Memory& memory, u32 address, Value value) {
	const auto ports = capturePorts(memory, address & CELL_MASK);
	memory.writeRamRecordWord(ports.word, valuePayload(value));
	memory.writeRamRecordByte(ports.tag, static_cast<u8>(valueTag(value)));
}

void Closure::initializeRecord() {
	const u32 flags = static_cast<u32>(prototype->executionDomainId + 1) | (canonical ? 4u : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (flags << 16));
	memory.writeRamRecordWord(address + CLOSURE_CAPTURE_COUNT, upvalueCount);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype->functionAddress);
}

u32 Closure::captureAddress(u32 index) const {
	return memory.readRamRecordWord(captureWordAddress(address, index));
}

void Closure::setCaptureAddress(u32 index, u32 reference) {
	memory.writeRamRecordWord(captureWordAddress(address, index), reference);
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// As with Table's native field map, the host ABI defines the complete object
// layout including its GCObject base. GCC/Clang support these offsets directly.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
size_t Closure::nativePrototypeOffset() { return offsetof(Closure, prototype); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif
} // namespace bmsx
