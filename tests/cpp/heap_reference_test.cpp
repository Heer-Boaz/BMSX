#include "machine/cpu/upvalue.h"
#include "support/cpu_execution_parity.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/value_storage.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/closure_fixture.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <unordered_set>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestImage program() {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord=0, .wordCount=1, .maxStack=8},
		{.firstWord=1, .wordCount=1, .maxStack=1, .staticClosure=false, .upvalues={{true, 0}}}};
	return image;
}
struct Machine {
	test::Blua32TestRom rom{test::encodeBlua32TestRom(RomImageDomain::System, program())};
	Memory memory{MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
	Machine() {
		test::seedManagedFixture(cpu, addresses);
		auto& frame = *cpu.rootThread()->currentFrame;
		std::array<u32, 1> cells{};
		frame.registers.set(1, valueClosure(test::seedTestCapturedClosure(cpu, rom.functionAddresses[1], cells)));
		Upvalue::bindOpen(memory, cells[0], frame.thread->address, frame.stackBase(), 0u);
		frame.writeControl(FrameField::OpenHead, cells[0]);
		frame.setTop(2);
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "fixture reaches HALT");
	}
};

void checkReferences(CPU& cpu) {
	cpu.gcHeap().visitObjectRecords(&cpu, [](void* context, u32 address) {
		auto& cpu = *static_cast<CPU*>(context);
		auto& heap = cpu.gcHeap();
		switch (cpu.memory().readRamRecordByte(address)) {
			case static_cast<u8>(ValueTag::Table):
				require(heap.tableRecordAddress(address) == address, "an issued table is decoded by its RAM header");
				break;
			case static_cast<u8>(ValueTag::Closure):
				require(heap.closureRecordAddress(address) == address, "an issued closure is decoded by its RAM header");
				break;
			case UPVALUE_RECORD_KIND:
				require(heap.cellRecordAddress(address) == address, "an issued cell is decoded by its RAM header");
				break;
			case THREAD_RECORD_KIND:
				require(heap.threadRecordAddress(address) == address, "an issued Thread is decoded by its RAM header");
				break;
		}
	});
}

void markIssuedWhiteHeader() {
	Machine machine;
	auto& gc = machine.cpu.gcHeap();
	const u32 table = bmsx::test::allocateTableReference(machine.cpu).address();
	const u32 raw = DYNAMIC_RAM_BASE + 0x600;
	const u32 header = static_cast<u32>(ValueTag::Table) | ((0xfcu | gc.white()) << 8u);
	machine.memory.writeRamRecordWord(raw, header);
	require(!gc.markValue(valueTable(raw)) && machine.memory.readRamRecordWord(raw) == header,
		"a matching white header in ordinary RAM cannot enter the gray queue");
	machine.memory.writeRamRecordWord(table, header);
	require(!gc.markValue(valueClosure(table)), "the reference kind must match");
	require(gc.markValue(valueTable(table + MAIN_RAM_SIZE)), "the mirrored white record enters the queue");
	require(!gc.markValue(valueTable(table)), "the same gray record is not enqueued again");
}

void liveReferencesAndReuse() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	static_assert(sizeof(decltype(cpu.rootThread()->address)) == sizeof(u32));
	const Value captured = frame.registers.get(1);
	auto closure = asClosure(captured, cpu.gcHeap());
	const u32 cell = ClosureRecord::captureAddress(cpu.memory(), closure, 0);
	require(valuePayload(captured) == closure, "the register contains the raw closure address");
	require(cpu.gcHeap().closureRecordAddress(cell) == 0u, "a cell address cannot resolve to a closure");
	checkReferences(cpu);
	auto roots = bmsx::test::allocateTableReference(cpu, 512);
	frame.registers.set(0,valueTable(roots.address())); frame.writeControl(bmsx::FrameField::Top, 2);
	ValueStorage slots(400);
	for (size_t i = 0; i < slots.capacity(); ++i) {
		auto table = bmsx::test::allocateTableReference(cpu); roots.setInteger(static_cast<int>(i + 1), valueTable(table.address()));
		slots.words()[i] = table.address(); slots.tags()[i] = static_cast<u8>(ValueTag::Table);
	}
	cpu.collectHeap();
	for (size_t i = 0; i < slots.capacity(); ++i)
		require(cpu.gcHeap().tableRecordAddress(slots.words()[i]) == valuePayload(roots.getInteger(static_cast<int>(i + 1))), "32-bit payloads survive allocation growth and collection");
	checkReferences(cpu);
	auto dead = bmsx::test::allocateTableReference(cpu); const u32 freeId = dead.address();
	cpu.collectHeap();
	auto replacement = bmsx::test::allocateTableReference(cpu);
	require(replacement.address() == freeId, "a freed guest record address becomes available again");
	require(cpu.gcHeap().tableRecordAddress(freeId) == replacement.address(), "the recycled address names the new RAM record");
	frame.registers.set(2,valueTable(replacement.address())); frame.writeControl(bmsx::FrameField::Top, 3);
}

void restoreRebindsWithoutRetainingDiscardedFutures() {
	Machine machine; auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	auto roots = bmsx::test::allocateTableReference(cpu, 4); frame.registers.set(0,valueTable(roots.address())); frame.writeControl(bmsx::FrameField::Top, 2);
	for (int i = 1; i <= 4; ++i) roots.setInteger(i, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	// Leave holes before saving, then consume them on a discarded timeline.
	bmsx::test::allocateTableReference(cpu);
	bmsx::test::allocateTableReference(cpu);
	cpu.collectHeap();
	const auto saved = cpu.captureRuntimeState();
	const auto ram = cpu.memory().captureSaveState();
	const u32 rootsRef = roots.address();
	const Value fourth = roots.getInteger(4);
	for (int iteration = 0; iteration < 64; ++iteration) {
		std::array<u32, 12> future{};
		for (auto& address : future) address = bmsx::test::allocateTableReference(cpu).address();
		cpu.memory().restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		const Value restoredRoots = cpu.rootThread()->currentFrame->registers.get(0);
		require(valuePayload(restoredRoots) == rootsRef &&
			TableRecord(cpu.memory(), valuePayload(restoredRoots)).getInteger(4) == fourth,
			"raw reference words still bind the restored table and its entries");
		for (const u32 address : future) require(cpu.gcHeap().tableRecordAddress(address) == 0u, "discarded addresses have no issued Table header");
		checkReferences(cpu);
		const auto restored = cpu.captureRuntimeState();
		require(saved == restored,
			"restore preserves physical record identities");
		auto first = bmsx::test::allocateTableReference(cpu);
		auto second = bmsx::test::allocateTableReference(cpu);
		require(first.address() == future[0] && second.address() == future[1],
			"the allocator resumes its physical free chain from the RAM image");
		cpu.memory().restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
	}
}

void incrementalRestore() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	auto roots = bmsx::test::allocateTableReference(cpu, 1024); frame.registers.set(0,valueTable(roots.address())); frame.writeControl(bmsx::FrameField::Top, 2);
	for (int i = 1; i <= 1000; ++i) {
		roots.setInteger(i, valueTable(bmsx::test::allocateTableReference(cpu, 1, 1).address()));
		auto dead = bmsx::test::allocateTableReference(cpu, 1); dead.setInteger(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	}
	std::unordered_set<GcPhase> phases;
	for (int step = 0; step < 1000; ++step) {
		cpu.gcHeap().step(valueNil(), valueNil(), valueNil()); checkReferences(cpu);
		const auto saved = cpu.captureRuntimeState(); phases.insert(cpu.gcHeap().phase());
		cpu.restoreRuntimeState(saved); checkReferences(cpu);
		const auto restored = cpu.captureRuntimeState();
		require(saved == restored,
			"restoring a partial collection preserves CPU latches");
		if (!cpu.gcHeap().active()) break;
	}
	for (auto phase : {GcPhase::Mark, GcPhase::Atomic, GcPhase::Sweep, GcPhase::Pause})
		require(phases.contains(phase), "reference test traverses marking and retirement");
}

void builtinIdentitiesStayOutsideTheGcHeap() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	auto functions = bmsx::test::allocateTableReference(cpu, BUILTIN_FUNCTION_COUNT);
	frame.registers.set(0,valueTable(functions.address())); frame.writeControl(bmsx::FrameField::Top, 2);
	const auto before = test::allocatedObjectRecords(cpu);
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		functions.setInteger(static_cast<int>(i + 1), cpu.createBuiltinFunction(static_cast<BuiltinFunctionId>(i)));
	const auto after = test::allocatedObjectRecords(cpu);
	require(before == after, "builtin functions have CPU-owned ids, not GC registrations");
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	functions = bmsx::test::asReferenceTable(cpu.rootThread()->currentFrame->registers.get(0),cpu.gcHeap());
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		require(asBuiltinFunctionId(functions.getInteger(static_cast<int>(i + 1))) == static_cast<BuiltinFunctionId>(i),
			"builtin ids survive restore including zero");
}

void closedCellLivesInRam() {
	Machine machine; auto& cpu = machine.cpu; auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	auto closure = asClosure(frame.registers.get(1), heap);
	const u32 key = cpu.stringPool().intern("saved_capture");
	cpu.setGlobalByKey(key, frame.registers.get(1));
	const u32 address = ClosureRecord::captureAddress(cpu.memory(), closure, 0);
	require(heap.cellRecordAddress(address) == address, "capture is an issued allocator record");
	require(heap.openCellAddress(address + MAIN_RAM_SIZE) == address, "a mirrored open link selects the same physical cell");
	auto& memory = machine.memory;
	require(memory.readRamRecordWord(closure + CLOSURE_CAPTURE_WORDS) == address,
		"closure owns the physical capture word");
	require(memory.readRamRecordByte(address + UPVALUE_FLAGS) == UPVALUE_OPEN
		&& memory.readRamRecordWord(address + UPVALUE_OWNER) == frame.thread->address
		&& memory.readRamRecordWord(address + UPVALUE_VALUE_WORD) == static_cast<u32>(frame.stackBase()),
		"the open variant records the owning Thread and absolute stack slot in RAM");
	const auto openSnapshot = cpu.captureRuntimeState();
	const auto openRam = memory.captureSaveState();
	const u32 oldStack = frame.thread->stackOffset();
	const size_t oldCapacity = frame.thread->stackCapacity;
	test::resizeReferenceThreadStack(cpu.gcHeap(), *frame.thread, 80);
	require(frame.thread->stackOffset() != oldStack, "the fixture relocates the defining Thread's stack");
	frame.registers.set(0, valueFloatBits(0xffa12345u));
	require(cpu.readClosureUpvalue(closure, 0) == valueFloatBits(0xffa12345u),
		"the open record follows the new stack block without being rewritten");
	test::resizeReferenceThreadStack(cpu.gcHeap(), *frame.thread, oldCapacity);
	cpu.abortCompletionCall(0);
	require(!Upvalue::isOpen(memory, address) && memory.readRamRecordWord(address + UPVALUE_VALUE_WORD) == 0xffa12345u
		&& memory.readRamRecordByte(address + UPVALUE_VALUE_TAG) == static_cast<u8>(ValueTag::Float),
		"closing a capture writes the exact value to the allocated cell");
	const auto saved = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, 0x80000000u);
	require(cpu.readClosureUpvalue(closure, 0) == valueFloatBits(0x80000000u), "closed capture reads the physical word");
	// Restoring the closed checkpoint must not close the discarded frame
	// into the same cell of the already-installed RAM image.
	memory.restoreSaveState(openRam);
	cpu.restoreRuntimeState(openSnapshot);
	cpu.rootThread()->currentFrame->registers.set(0, valueInteger(44));
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	closure = asClosure(cpu.getGlobalByKey(key), heap);
	require(ClosureRecord::captureAddress(cpu.memory(), closure, 0) == address && cpu.readClosureUpvalue(closure, 0) == valueFloatBits(0xffa12345u),
		"restore retains the saved capture address and word");
	cpu.collectHeap();
	const auto occupied = cpu.heapAllocator().occupiedBytes();
	const auto closureBytes = cpu.heapAllocator().allocationBytes(closure - GC_OBJECT_PREFIX);
	const auto cellBytes = cpu.heapAllocator().allocationBytes(address - GC_OBJECT_PREFIX);
	cpu.setGlobalByKey(key, valueNil());
	cpu.collectHeap();
	require(cpu.heapAllocator().occupiedBytes() == occupied - closureBytes - cellBytes,
		"collection releases both raw records");
	require(heap.cellRecordAddress(address) == 0u && memory.readRamRecordByte(address) == 0u,
		"the freed capture has no live record header");
}

void sweepStopsVisitingReclaimedObjects() {
	Machine machine;
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	auto closure = asClosure(frame.registers.get(1), heap);
	const u32 closureAddress = closure;
	const u32 cellAddress = ClosureRecord::captureAddress(cpu.memory(), closure, 0);
	const auto sweep = [&]() {
		while (heap.phase() != GcPhase::Sweep)
			heap.step(valueNil(), valueNil(), valueNil());
		const auto work = heap.step(valueNil(), valueNil(), valueNil());
		while (heap.active()) heap.step(valueNil(), valueNil(), valueNil());
		return work;
	};
	const auto occupied = sweep();
	frame.registers.set(1, valueNil());
	require(sweep() == occupied, "reclaiming an object costs the same visit as retaining it");
	require(heap.closureRecordAddress(closureAddress) == 0u &&
		cpu.memory().readRamRecordByte(closureAddress) == 0, "the sweep retires the closure");
	require(heap.openCellAddress(cellAddress) == cellAddress, "an open frame still roots the cell");
	require(sweep() + 1 == occupied, "the next sweep does not visit the vacant record");
}

void sweepResumesAfterPublishingAndRestoring() {
	Machine machine;
	auto& cpu = machine.cpu;
	auto& gc = cpu.gcHeap();
	const u32 dead = bmsx::test::allocateTableReference(cpu).address();
	auto keep = bmsx::test::allocateTableReference(cpu);
	cpu.rootThread()->currentFrame->registers.set(0, valueTable(keep.address()));
	while (gc.phase() != GcPhase::Sweep) gc.step(valueNil(), valueNil(), valueNil());

	require(gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1) == 1
		&& gc.tableRecordAddress(dead) == dead, "one step stops after the newest retained record");

	const auto oldRam = cpu.memory().captureSaveState();
	const auto oldState = cpu.captureRuntimeState();
	const auto finish = [&] {
		const auto fresh = bmsx::test::allocateTableReference(cpu).address();
		require(gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1) == 1
			&& gc.tableRecordAddress(dead) == 0u, "a new head does not disturb the suspended sweep cursor");
		while (gc.active()) gc.step(valueNil(), valueNil(), valueNil());
		require(gc.tableRecordAddress(fresh) == fresh && gc.tableRecordAddress(keep.address()) == keep.address(),
			"a surviving predecessor and a new allocation both remain in the inventory");
		return fresh;
	};
	const u32 fresh = finish();
	const auto finishedRam = cpu.memory().captureSaveState();
	cpu.memory().restoreSaveState(oldRam);
	cpu.restoreRuntimeState(oldState);
	require(finish() == fresh && cpu.memory().captureSaveState().ram == finishedRam.ram,
		"restoring RAM resumes reclamation with the same allocation order and result");
}

void isolatedHeaps() {
	Machine first, second;
	auto a = bmsx::test::allocateTableReference(first.cpu); auto b = bmsx::test::allocateTableReference(second.cpu);
	const u32 ar = a.address(), br = b.address();
	require(ar == br, "equally initialized heaps allocate the same guest addresses");
	a.setInteger(1, valueInteger(73));
	b.setInteger(1, valueInteger(85));
	require(a.getInteger(1) == valueInteger(73) && b.getInteger(1) == valueInteger(85),
		"the same guest address belongs to its own physical CPU");
}
}
int main() {
	try {
		markIssuedWhiteHeader();
		liveReferencesAndReuse(); restoreRebindsWithoutRetainingDiscardedFutures(); incrementalRestore();
		builtinIdentitiesStayOutsideTheGcHeap(); closedCellLivesInRam(); sweepStopsVisitingReclaimedObjects();
		sweepResumesAfterPublishingAndRestoring(); isolatedHeaps();
		std::cout << "heap reference tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
