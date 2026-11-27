#pragma once

#include "machine/cpu/cpu.h"
#include "machine/cpu/closure.h"
#include "machine/memory/bus_signals.h"

#include <stdexcept>

namespace bmsx::test {

// Some hand-authored MAPPED ROMs deliberately have no allocation firmware.
// Issue the immutable object in fixture RAM, then bind the completed
// checkpoint just as a normally restored machine binds its derived index.
// This setup must not admit a CALL, which could reserve extra stack storage
// or intentionally fail in a stack-admission test.
inline u32 seedTestRomClosure(CPU& cpu, u32 address, ExecutionDomainId domain = SYSTEM_EXECUTION_DOMAIN_ID) {
	auto& memory = cpu.memory();
	const auto bus = domain == SYSTEM_EXECUTION_DOMAIN_ID ? MAPPED_BUS_MASTER_CPU : mappedBusSignalsForCartridgeSlot(domain);
	Span<const u8> bytes;
	if (!memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, bus, bytes))
		throw std::logic_error("fixture closure prototype has no ROM backing");
	const FunctionEntry entry = FunctionEntry::fromRom(bytes.data());
	if ((entry.flags & BLUA32_FUNCTION_STATIC) == 0u || readLE32(bytes.data() + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) != 0u)
		throw std::logic_error("fixture must name a captureless STATIC prototype");
	const FunctionPrototype prototype{.functionAddress = address, .entry = entry, .executionDomainId = domain};
	const u32 record = cpu.luaHeap().allocateClosureRecord(0u);
	ClosureRecord::initialize(memory, record, prototype, cpu.gcHeap().white(), 0u, true, false);
	cpu.gcHeap().publishObject(record);
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	return record;
}

// Raw-CPU fixtures that exercise a later CALL/return/GC/inspection boundary
// build their input records directly. Capture addresses are chosen by the
// fixture, not sampled from the prototype's descriptors.
inline u32 seedTestCapturedClosure(CPU& cpu, u32 address, std::span<u32> newCells,
	std::span<const u32> captures = {}, ExecutionDomainId domain = SYSTEM_EXECUTION_DOMAIN_ID) {
	auto& memory = cpu.memory();
	const auto bus = domain == SYSTEM_EXECUTION_DOMAIN_ID ? MAPPED_BUS_MASTER_CPU : mappedBusSignalsForCartridgeSlot(domain);
	Span<const u8> bytes;
	if (!memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, bus, bytes))
		throw std::logic_error("fixture captured closure prototype has no physical backing");
	const auto count = readLE32(bytes.data() + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
	if (captures.empty()) captures = newCells;
	if (count != captures.size()) throw std::logic_error("fixture must supply each capture explicitly");
	const bool latched = address >= RAM_BASE && (address < CART_ROM_BASE || address >= CART_ROM_END);
	const FunctionPrototype prototype{.functionAddress = address, .entry = FunctionEntry::fromRom(bytes.data()),
		.upvalueTableAddress = readLE32(bytes.data() + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET),
		.recordUpvalueCount = count, .executionDomainId = domain};
	const u32 record = cpu.luaHeap().allocateClosureRecord(count, latched, newCells);
	ClosureRecord::initialize(memory, record, prototype, cpu.gcHeap().white(), count, false, latched);
	for (u32 index = 0; index < count; ++index)
		ClosureRecord::setCaptureAddress(memory, record, index, captures[index]);
	cpu.gcHeap().publishObject(record);
	return record;
}

} // namespace bmsx::test
