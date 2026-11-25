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

void initialize(Memory& memory, u32 address, const FunctionPrototype& prototype, u8 white, u32 count, bool canonical, bool latched) {
	const u32 flags = domainBits(prototype.executionDomainId)
		| (canonical ? CLOSURE_CANONICAL : 0u) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (static_cast<u32>(white) << 8)
		| (flags << 16) | ((count >> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + GC_RECORD_LINK, count << GC_GRAY_INDEX_BITS);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype.functionAddress);
	if (latched) {
		const u32 tail = captureWordAddress(address, count);
		memory.writeRamRecordWord(tail, prototype.entry.codeAddress);
		memory.writeRamRecordWord(tail + 4u, prototype.entry.numParams);
		memory.writeRamRecordWord(tail + 8u, prototype.entry.maxStack);
		memory.writeRamRecordWord(tail + 12u, prototype.entry.flags);
		memory.writeRamRecordWord(tail + 16u, prototype.upvalueTableAddress);
		memory.writeRamRecordWord(tail + 20u, prototype.recordUpvalueCount);
	}
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
