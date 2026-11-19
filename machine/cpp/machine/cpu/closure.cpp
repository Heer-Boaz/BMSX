#include "machine/cpu/closure.h"
#include "common/endian.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"

namespace bmsx::ClosureRecord {
void initialize(Memory& memory, u32 address, const FunctionPrototype& prototype, u8 white, u32 count, bool canonical, bool latched) {
	const u32 flags = static_cast<u32>(prototype.executionDomainId + 1)
		| (canonical ? CLOSURE_CANONICAL : 0u) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (static_cast<u32>(white) << 8)
		| (flags << 16) | ((count >> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + GC_RECORD_LINK, count << GC_GRAY_INDEX_BITS);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype.functionAddress);
	if (latched) {
		const u32 tail = captureWordAddress(address, count);
		memory.writeRamRecordWord(tail, prototype.codeAddress);
		memory.writeRamRecordWord(tail + 4u, prototype.numParams);
		memory.writeRamRecordWord(tail + 8u, prototype.maxStack);
		memory.writeRamRecordWord(tail + 12u, prototype.flags);
		memory.writeRamRecordWord(tail + 16u, prototype.upvalueTableAddress);
		memory.writeRamRecordWord(tail + 20u, prototype.recordUpvalueCount);
	}
}

FunctionPrototype readBinding(const Memory& memory, u32 address) {
	const u8 flags = memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS);
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

u32 captureCount(const Memory& memory, u32 address) {
	const u32 low = memory.readRamRecordWord(address + GC_RECORD_LINK) >> GC_GRAY_INDEX_BITS;
	const u32 high = memory.readRamRecordByte(address + CLOSURE_COUNT_HIGH_BYTE) & 0x7fu;
	return low | (high << CLOSURE_COUNT_LOW_BITS);
}

u32 captureAddress(const Memory& memory, u32 address, u32 index) {
	return memory.readRamRecordWord(captureWordAddress(address, index));
}

void setCaptureAddress(Memory& memory, u32 address, u32 index, u32 reference) {
	memory.writeRamRecordWord(captureWordAddress(address, index), reference);
}

} // namespace bmsx::ClosureRecord
