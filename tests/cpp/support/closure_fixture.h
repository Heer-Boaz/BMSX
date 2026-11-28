#pragma once

#include "machine/cpu/cpu.h"
#include "gc_heap_reference.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/upvalue.h"
#include "machine/memory/bus_signals.h"

#include <span>
#include <stdexcept>

namespace bmsx::test {

// Native reference: reserve the closure and its new cells before publishing frame links.
inline u32 allocateClosureRecordReference(GcHeap heap, u32 captures, bool latched = false, std::span<u32> cells = {}) {
	const u32 bytes = closureRecordBytes(captures, latched);
	const u32 charged = bytes + static_cast<u32>(cells.size()) * UPVALUE_HEAP_BYTES;
	auto recovery = heap.budget.admit(charged, valueNil(), valueNil(), valueNil(), 0u);
	if (GcHeap::pacedPhase(heap.phase())) heap.assistBeforeReservation(charged + GC_OBJECT_PREFIX * (1u + cells.size()));
	auto& arena = heap.arena;
	for (;;) {
		if (const u32 closure = arena.allocate(bytes + GC_OBJECT_PREFIX, false)) {
			size_t count = 0;
			for (; count < cells.size(); ++count) {
				const u32 cell = arena.allocate(UPVALUE_HEAP_BYTES + GC_OBJECT_PREFIX, false);
				if (!cell) break;
				cells[count] = cell + GC_OBJECT_PREFIX;
			}
			if (count == cells.size()) {
				const u8 white = heap.white();
				for (u32 cell : cells) {
					Upvalue::initialize(heap.memory, cell, white);
					heap.publishObject(cell);
				}
				heap.budget.resizeRecordCharge(0u, charged);
				return closure + GC_OBJECT_PREFIX;
			}
			while (count != 0) arena.free(cells[--count] - GC_OBJECT_PREFIX);
			arena.free(closure);
		}
		recovery = heap.recoverAllocation(recovery);
	}
}

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
	GcHeap heap(cpu);
	const u32 record = allocateClosureRecordReference(heap, 0u);
	ClosureRecord::initialize(memory, record, prototype, heap.white(), 0u, true, false);
	heap.publishObject(record);
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
	GcHeap heap(cpu);
	const u32 record = allocateClosureRecordReference(heap, count, latched, newCells);
	ClosureRecord::initialize(memory, record, prototype, heap.white(), count, false, latched);
	for (u32 index = 0; index < count; ++index)
		ClosureRecord::setCaptureAddress(memory, record, index, captures[index]);
	heap.publishObject(record);
	return record;
}

// Seed a valid sampled value for mapped-record tests that precede the CALL,
// mutation, or cache-hit boundary they actually measure.
inline u32 seedTestMappedClosure(CPU& cpu, u32 address, bool canonical = true, ExecutionDomainId domain = SYSTEM_EXECUTION_DOMAIN_ID) {
	auto& memory = cpu.memory();
	const auto bus = domain == SYSTEM_EXECUTION_DOMAIN_ID ? MAPPED_BUS_MASTER_CPU : mappedBusSignalsForCartridgeSlot(domain);
	const auto sequence = memory.readBusFaultSequence();
	const FunctionPrototype prototype{
		.functionAddress = address,
		.entry = {memory.readMappedBusU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, bus),
			memory.readMappedBusU32LE(address + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, bus),
			memory.readMappedBusU32LE(address + BLUA32_FUNCTION_MAX_STACK_OFFSET, bus),
			memory.readMappedBusU32LE(address + BLUA32_FUNCTION_FLAGS_OFFSET, bus)},
		.upvalueTableAddress = memory.readMappedBusU32LE(address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, bus),
		.recordUpvalueCount = memory.readMappedBusU32LE(address + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, bus),
		.executionDomainId = domain,
	};
	if (sequence != memory.readBusFaultSequence() || prototype.recordUpvalueCount != 0u
		|| ((prototype.entry.flags & BLUA32_FUNCTION_STATIC) != 0u) != canonical)
		throw std::logic_error("fixture storage must provide the selected mapped captureless binding");
	GcHeap heap(cpu);
	const u32 record = allocateClosureRecordReference(heap, 0u, true);
	ClosureRecord::initialize(memory, record, prototype, heap.white(), 0u, canonical, true);
	heap.publishObject(record);
	if (canonical) cpu.restoreRuntimeState(cpu.captureRuntimeState());
	return record;
}

} // namespace bmsx::test
