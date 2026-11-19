#include "support/cpu_execution_parity.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/value_storage.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <unordered_set>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestImage program() {
	test::Blua32TestImage image;
	image.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord=0, .wordCount=3, .maxStack=8},
		{.firstWord=3, .wordCount=1, .maxStack=1, .staticClosure=false, .upvalues={{true, 0}}}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	return image;
}
struct Machine {
	test::Blua32TestRom rom{test::encodeBlua32TestRom(RomImageDomain::System, program())};
	Memory memory{MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
	Machine() { cpu.reset(); require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "fixture reaches HALT"); }
};

void checkReferences(CPU& cpu) {
	cpu.heapAllocator().visitObjectRecords(&cpu, [](void* context, u32 address) -> i32 {
		auto& cpu = *static_cast<CPU*>(context);
		auto& heap = cpu.gcHeap();
		switch (cpu.memory().readRamRecordByte(address)) {
			case static_cast<u8>(ValueTag::Table):
				require(heap.tableAt(address) && heap.tableAt(address)->address() == address, "issued table record has its view");
				break;
			case static_cast<u8>(ValueTag::Closure):
				require(heap.closureAt(address) && heap.closureAt(address)->address == address, "issued closure record has its view");
				break;
			case UPVALUE_RECORD_KIND:
				require(heap.cellAt(address) && heap.cellAt(address)->address == address, "issued cell record has its view");
				break;
			case THREAD_RECORD_KIND:
				require(heap.threadAt(address) && heap.threadAt(address)->address == address, "issued Thread record has its view");
				break;
		}
		return 1;
	});
}

void liveReferencesAndReuse() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	static_assert(sizeof(decltype(cpu.gcHeap().reference(cpu.rootThread()))) == sizeof(u32));
	const Value captured = frame.registers.get(1);
	auto* closure = asClosure(captured, cpu.gcHeap());
	auto* cell = cpu.gcHeap().cellAt(closure->captureAddress(0));
	require(valuePayload(captured) == closure->address, "the register contains the raw closure address");
	require(cpu.gcHeap().closureAt(cell->address) == nullptr, "a cell address cannot resolve to a closure");
	checkReferences(cpu);
	auto* roots = cpu.createTable(512);
	frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.writeControl(bmsx::FrameField::Top, 2);
	ValueStorage slots(400);
	for (size_t i = 0; i < slots.capacity(); ++i) {
		auto* table = cpu.createTable(); roots->setInteger(static_cast<int>(i + 1), valueTable(cpu.gcHeap().reference(table)));
		slots.words()[i] = cpu.gcHeap().reference(table); slots.tags()[i] = static_cast<u8>(ValueTag::Table);
	}
	cpu.collectHeap();
	for (size_t i = 0; i < slots.capacity(); ++i)
		require(cpu.gcHeap().tableAt(slots.words()[i]) == asTable(roots->getInteger(static_cast<int>(i + 1)),cpu.gcHeap()), "32-bit payloads survive allocation growth and collection");
	checkReferences(cpu);
	auto* dead = cpu.createTable(); const u32 freeId = cpu.gcHeap().reference(dead);
	cpu.collectHeap();
	auto* replacement = cpu.createTable();
	require(cpu.gcHeap().reference(replacement) == freeId, "a freed guest record address becomes available again");
	require(cpu.gcHeap().tableAt(freeId) == replacement, "recycled ids resolve the replacement object");
	frame.registers.set(2,valueTable(cpu.gcHeap().reference(replacement))); frame.writeControl(bmsx::FrameField::Top, 3);
}

void restoreRebindsWithoutRetainingDiscardedFutures() {
	Machine machine; auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	auto* roots = cpu.createTable(4); frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.writeControl(bmsx::FrameField::Top, 2);
	for (int i = 1; i <= 4; ++i) roots->setInteger(i, valueTable(cpu.gcHeap().reference(cpu.createTable())));
	// Leave holes before saving, then consume them on a discarded timeline.
	cpu.createTable();
	cpu.createTable();
	cpu.collectHeap();
	const auto saved = cpu.captureRuntimeState();
	const auto ram = cpu.memory().captureSaveState();
	const u32 rootsRef = cpu.gcHeap().reference(roots);
	const Value fourth = roots->getInteger(4);
	for (int iteration = 0; iteration < 64; ++iteration) {
		std::array<u32, 12> future{};
		for (auto& address : future) address = cpu.createTable()->address();
		cpu.memory().restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		const Value restoredRoots = cpu.rootThread()->currentFrame->registers.get(0);
		require(valuePayload(restoredRoots) == rootsRef &&
			asTable(restoredRoots, cpu.gcHeap())->getInteger(4) == fourth,
			"raw reference words still bind the restored table and its entries");
		for (const u32 address : future) require(cpu.gcHeap().tableAt(address) == nullptr, "discarded addresses have no attachment");
		checkReferences(cpu);
		const auto restored = cpu.captureRuntimeState();
		require(saved == restored,
			"restore preserves physical record identities");
		auto* first = cpu.createTable();
		auto* second = cpu.createTable();
		require(first->address() == future[0] && second->address() == future[1],
			"the allocator resumes its physical free chain from the RAM image");
		cpu.memory().restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
	}
}

void incrementalRestore() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	auto* roots = cpu.createTable(1024); frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.writeControl(bmsx::FrameField::Top, 2);
	for (int i = 1; i <= 1000; ++i) {
		roots->setInteger(i, valueTable(cpu.gcHeap().reference(cpu.createTable(1, 1))));
		auto* dead = cpu.createTable(1); dead->setInteger(1, valueTable(cpu.gcHeap().reference(cpu.createTable())));
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
	auto* functions = cpu.createTable(BUILTIN_FUNCTION_COUNT);
	frame.registers.set(0,valueTable(cpu.gcHeap().reference(functions))); frame.writeControl(bmsx::FrameField::Top, 2);
	const auto before = test::allocatedObjectRecords(cpu);
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		functions->setInteger(static_cast<int>(i + 1), cpu.createBuiltinFunction(static_cast<BuiltinFunctionId>(i)));
	const auto after = test::allocatedObjectRecords(cpu);
	require(before == after, "builtin functions have CPU-owned ids, not GC registrations");
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	functions = asTable(cpu.rootThread()->currentFrame->registers.get(0),cpu.gcHeap());
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		require(asBuiltinFunctionId(functions->getInteger(static_cast<int>(i + 1))) == static_cast<BuiltinFunctionId>(i),
			"builtin ids survive restore including zero");
}

void closedCellLivesInRam() {
	Machine machine; auto& cpu = machine.cpu; auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	auto* closure = asClosure(frame.registers.get(1), heap);
	const u32 key = cpu.stringPool().intern("saved_capture");
	cpu.setGlobalByKey(key, frame.registers.get(1));
	auto* cell = static_cast<Upvalue*>(heap.cellAt(closure->captureAddress(0)));
	const u32 address = cell->address;
	auto& memory = machine.memory;
	require(memory.readRamRecordWord(closure->address + CLOSURE_CAPTURE_WORDS) == cell->address,
		"closure owns the physical capture word");
	require(memory.readRamRecordByte(address + UPVALUE_FLAGS) == UPVALUE_OPEN
		&& memory.readRamRecordWord(address + UPVALUE_OWNER) == frame.thread->address
		&& memory.readRamRecordWord(address + UPVALUE_VALUE_WORD) == static_cast<u32>(frame.stackBase()),
		"the open variant records the owning Thread and absolute stack slot in RAM");
	const auto openSnapshot = cpu.captureRuntimeState();
	const auto openRam = memory.captureSaveState();
	const u32 oldStack = frame.thread->stackOffset();
	const size_t oldCapacity = frame.thread->stackCapacity;
	frame.thread->resizeStack(80);
	require(frame.thread->stackOffset() != oldStack, "the fixture relocates the defining Thread's stack");
	frame.registers.set(0, valueFloatBits(0xffa12345u));
	require(cpu.readClosureUpvalue(closure, 0) == valueFloatBits(0xffa12345u),
		"the open record follows the new stack block without being rewritten");
	frame.thread->resizeStack(oldCapacity);
	cpu.abortCompletionCall(0);
	require(!cell->isOpen() && memory.readRamRecordWord(address + UPVALUE_VALUE_WORD) == 0xffa12345u
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
	require(cpu.readClosureUpvalue(closure, 0) == valueFloatBits(0xffa12345u), "restore rebinds the saved cell");
	cpu.collectHeap();
	const auto occupied = cpu.heapAllocator().occupiedBytes();
	cpu.setGlobalByKey(key, valueNil());
	cpu.collectHeap();
	require(cpu.heapAllocator().occupiedBytes() == occupied - heapAllocationBytes(closureRecordBytes(1)) - UPVALUE_HEAP_BYTES,
		"collection releases both raw records");
}

void closureAndCellPagesChargeVacantSlots() {
	Machine machine;
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	auto* closure = asClosure(frame.registers.get(1), heap);
	const u32 closureAddress = closure->address;
	const u32 cellAddress = closure->captureAddress(0);
	const auto sweep = [&]() {
		while (heap.phase() != GcPhase::Sweep)
			heap.step(valueNil(), valueNil(), valueNil());
		const auto work = heap.step(valueNil(), valueNil(), valueNil());
		while (heap.active()) heap.step(valueNil(), valueNil(), valueNil());
		return work;
	};
	const auto occupied = sweep();
	frame.registers.set(1, valueNil());
	require(sweep() == occupied, "reclaiming an issued closure costs one slot visit");
	require(heap.closureAt(closureAddress) == nullptr &&
		cpu.memory().readRamRecordByte(closureAddress) == 0, "allocator sweep retires the closure slot");
	require(heap.cellAt(cellAddress) && heap.cellAt(cellAddress)->isOpen(), "an open frame still roots the cell");
	require(sweep() == occupied, "a free closure slot on a surviving object page still costs one visit");
}

void isolatedHeaps() {
	Machine first, second;
	auto* a = first.cpu.createTable(); auto* b = second.cpu.createTable();
	const u32 ar = first.cpu.gcHeap().reference(a), br = second.cpu.gcHeap().reference(b);
	require(a != b, "concurrent CPUs own distinct allocations");
	require(ar == br, "equally initialized heaps allocate the same guest addresses");
	require(first.cpu.gcHeap().tableAt(ar) == a && second.cpu.gcHeap().tableAt(br) == b,
		"each CPU resolves its own object references");
}
}
int main() {
	try {
		liveReferencesAndReuse(); restoreRebindsWithoutRetainingDiscardedFutures(); incrementalRestore();
		builtinIdentitiesStayOutsideTheGcHeap(); closedCellLivesInRam(); closureAndCellPagesChargeVacantSlots(); isolatedHeaps();
		std::cout << "heap reference tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
