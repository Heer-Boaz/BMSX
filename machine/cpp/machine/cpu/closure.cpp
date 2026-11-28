#include "machine/cpu/closure.h"

#include "machine/cpu/execution_image.h"
#include "machine/memory/memory.h"

namespace bmsx::ClosureRecord {
namespace {
FunctionEntry readEntryTail(const Memory& memory, u32 tail) {
	return {
		memory.readRamRecordWord(tail),
		memory.readRamRecordWord(tail + 4u),
		memory.readRamRecordWord(tail + 8u),
		memory.readRamRecordWord(tail + 12u),
	};
}
} // namespace

u32 recordAddress(const Memory& memory, u32 payload) {
	const u32 offset = payload & RAM_REFERENCE_MASK;
	return memory.readRamRecordByte(offset) == static_cast<u8>(ValueTag::Closure) ? RAM_BASE + offset : 0u;
}

FunctionPrototype readBinding(const Memory& memory, u32 address, BindingFlags binding,
	const Blua32RomFunctionDirectory& directory) {
	FunctionPrototype record{};
	record.functionAddress = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
	record.executionDomainId = binding.domain();
	if (binding.latched()) {
		const u32 tail = captureWordAddress(address, captureCount(memory, address));
		record.entry = readEntryTail(memory, tail);
		record.upvalueTableAddress = memory.readRamRecordWord(tail + 16u);
		record.recordUpvalueCount = memory.readRamRecordWord(tail + 20u);
	} else if (!directory.mappedCode) {
		const auto& version = *directory.find(record.functionAddress);
		record.entry = version.entry;
		record.upvalueTableAddress = version.upvalueTableAddress;
		record.recordUpvalueCount = version.upvalueCount;
	} else {
		Span<const u8> view;
		// The ROM port does not clock the bus. An undriven binding has zero data lanes.
		if (memory.bindRomByteView(record.functionAddress, BLUA32_FUNCTION_RECORD_SIZE, binding.domain() == 1, view)) {
			const auto* bytes = view.data();
			record.entry = FunctionEntry::fromRom(bytes);
			record.upvalueTableAddress = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET);
			record.recordUpvalueCount = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
		}
	}
	return record;
}

FunctionEntry readLatchedEntry(const Memory& memory, u32 address) {
	return readEntryTail(memory, captureWordAddress(address, captureCount(memory, address)));
}

u32 captureCount(const Memory& memory, u32 address) {
	const u32 low = memory.readRamRecordWord(address + CLOSURE_COUNT_WORD) >> CLOSURE_COUNT_SHIFT;
	const u32 high = memory.readRamRecordByte(address + CLOSURE_COUNT_HIGH_BYTE) & 0x7fu;
	return low | (high << CLOSURE_COUNT_LOW_BITS);
}

u32 captureAddress(const Memory& memory, u32 address, u32 index) {
	return memory.readRamRecordWord(captureWordAddress(address, index));
}

} // namespace bmsx::ClosureRecord
