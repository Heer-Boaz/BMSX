#include "machine/cpu/closure.h"
#include "machine/cpu/gc_heap.h"

#include "machine/cpu/thread.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"

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

void Upvalue::close(GcHeap& heap) {
	const Value captured = value();
	const u32 offset = address & CELL_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
	record[UPVALUE_VALUE_TAG] = static_cast<u8>(valueTag(captured));
	writeLE32(record + UPVALUE_VALUE_WORD, valuePayload(captured));
	writeLE32(record + UPVALUE_OWNER, 0);
	writeLE32(record + UPVALUE_NEXT, 0);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
	heap.writeBarrier(address, UPVALUE_NEXT);
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

bool Closure::hasLatchedPrototype() const {
	return (memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS) & CLOSURE_LATCHED_PROTOTYPE) != 0u;
}

void Closure::initializeRecord(u8 white, u32 count, bool latched) {
	const u32 flags = static_cast<u32>(prototype->executionDomainId + 1)
		| (canonical ? CLOSURE_CANONICAL : 0u) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (static_cast<u32>(white) << 8)
		| (flags << 16) | ((count >> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + GC_RECORD_LINK, count << GC_GRAY_INDEX_BITS);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype->functionAddress);
	if (latched) {
		const u32 tail = captureWordAddress(address, count);
		memory.writeRamRecordWord(tail, prototype->codeAddress);
		memory.writeRamRecordWord(tail + 4u, prototype->numParams);
		memory.writeRamRecordWord(tail + 8u, prototype->maxStack);
		memory.writeRamRecordWord(tail + 12u, prototype->flags);
		memory.writeRamRecordWord(tail + 16u, prototype->upvalueTableAddress);
		memory.writeRamRecordWord(tail + 20u, prototype->recordUpvalueCount);
	}
}

FunctionPrototype Closure::readBinding(const Memory& memory, u32 address, u8 flags) {
	FunctionPrototype record;
	record.functionAddress = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
	const u32 bank = flags & CLOSURE_BINDING_DOMAIN_MASK;
	record.executionDomainId = bank >= 2u ? 1 : static_cast<i32>(bank) - 1;
	if ((flags & CLOSURE_LATCHED_PROTOTYPE) != 0u) {
		const u32 tail = captureWordAddress(address, captureCount(memory, address));
		record.codeAddress = memory.readRamRecordWord(tail);
		record.numParams = memory.readRamRecordWord(tail + 4u);
		record.maxStack = memory.readRamRecordWord(tail + 8u);
		record.flags = memory.readRamRecordWord(tail + 12u);
		record.upvalueTableAddress = memory.readRamRecordWord(tail + 16u);
		record.recordUpvalueCount = memory.readRamRecordWord(tail + 20u);
	} else {
		Span<const u8> view;
		// The ROM port does not clock the bus. An undriven binding has zero data lanes.
		if (memory.bindRomByteView(record.functionAddress, BLUA32_FUNCTION_RECORD_SIZE, bank >= 2u, view)) {
			const auto* bytes = view.data();
			record.codeAddress = readLE32(bytes + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
			record.numParams = readLE32(bytes + BLUA32_FUNCTION_NUM_PARAMS_OFFSET);
			record.maxStack = readLE32(bytes + BLUA32_FUNCTION_MAX_STACK_OFFSET);
			record.flags = readLE32(bytes + BLUA32_FUNCTION_FLAGS_OFFSET);
			record.upvalueTableAddress = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET);
			record.recordUpvalueCount = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
		}
	}
	return record;
}

u32 Closure::captureCount(const Memory& memory, u32 address) {
	const u32 low = memory.readRamRecordWord(address + GC_RECORD_LINK) >> GC_GRAY_INDEX_BITS;
	const u32 high = memory.readRamRecordByte(address + CLOSURE_COUNT_HIGH_BYTE) & 0x7fu;
	return low | (high << CLOSURE_COUNT_LOW_BITS);
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
