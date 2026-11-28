#pragma once

#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "gc_heap_reference.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/upvalue.h"
#include "machine/memory/bus_signals.h"

#include <span>
#include <stdexcept>

namespace bmsx::test {

inline void initializeClosureFixture(Memory& memory, u32 address, const FunctionPrototype& prototype, u8 white, u32 count, bool canonical, bool latched) {
	const u32 flags = ClosureRecord::domainBits(prototype.executionDomainId)
		| (canonical ? CLOSURE_CANONICAL : 0u) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (static_cast<u32>(white) << 8)
		| (flags << 16) | ((count >> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + CLOSURE_COUNT_WORD, count << CLOSURE_COUNT_SHIFT);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype.functionAddress);
	if (latched) {
		const u32 tail = ClosureRecord::captureWordAddress(address, count);
		memory.writeRamRecordWord(tail, prototype.entry.codeAddress);
		memory.writeRamRecordWord(tail + 4u, prototype.entry.numParams);
		memory.writeRamRecordWord(tail + 8u, prototype.entry.maxStack);
		memory.writeRamRecordWord(tail + 12u, prototype.entry.flags);
		memory.writeRamRecordWord(tail + 16u, prototype.upvalueTableAddress);
		memory.writeRamRecordWord(tail + 20u, prototype.recordUpvalueCount);
	}
}

inline void setClosureCaptureFixture(Memory& memory, u32 address, u32 index, u32 reference) {
	memory.writeRamRecordWord(ClosureRecord::captureWordAddress(address, index), reference);
}

inline void bindOpenUpvalueFixture(Memory& memory, u32 address, u32 owner, u32 slot, u32 next) {
	const u32 offset = address & RAM_REFERENCE_MASK;
	auto* record = memory.ramData() + offset;
	record[UPVALUE_FLAGS] = UPVALUE_OPEN;
	writeLE32(record + UPVALUE_VALUE_WORD, slot);
	writeLE32(record + UPVALUE_OWNER, owner);
	writeLE32(record + UPVALUE_NEXT, next);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

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
					heap.memory.writeRamRecordPair(cell, UPVALUE_RECORD_KIND | (static_cast<u32>(white) << 8u), 0u);
					heap.memory.writeRamRecordPair(cell + UPVALUE_OWNER, 0u, 0u);
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
	initializeClosureFixture(memory, record, prototype, heap.white(), 0u, true, false);
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
	initializeClosureFixture(memory, record, prototype, heap.white(), count, false, latched);
	for (u32 index = 0; index < count; ++index)
		setClosureCaptureFixture(memory, record, index, captures[index]);
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
	initializeClosureFixture(memory, record, prototype, heap.white(), 0u, canonical, true);
	heap.publishObject(record);
	if (canonical) cpu.restoreRuntimeState(cpu.captureRuntimeState());
	return record;
}

} // namespace bmsx::test
