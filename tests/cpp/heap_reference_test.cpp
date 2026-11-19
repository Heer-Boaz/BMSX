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

u32 checkReferences(CPU& cpu) {
	const auto state = cpu.gcHeap().captureState([&](const GCObject* object) { return cpu.gcHeap().reference(object); });
	std::unordered_set<u32> ids;
	u32 highest = 0;
	for (u32 id : state.allocations) {
		require(id != 0 && ids.insert(id).second, "every allocation has one nonzero reference");
		require(cpu.gcHeap().reference(id >= RAM_BASE ? static_cast<GCObject*>(cpu.gcHeap().tableAt(id)) : cpu.gcHeap().object(id)) == id, "reference round-trips its live allocation");
		highest = std::max(highest, id);
	}
	return highest;
}

void liveReferencesAndReuse() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	static_assert(sizeof(decltype(cpu.gcHeap().reference(cpu.rootThread()))) == sizeof(u32));
	for (auto* object : {static_cast<GCObject*>(cpu.rootThread()), static_cast<GCObject*>(frame.closure),
		static_cast<GCObject*>(asClosure(frame.registers.get(1),cpu.gcHeap())), static_cast<GCObject*>(cpu.gcHeap().object(asClosure(frame.registers.get(1),cpu.gcHeap())->upvalues[0]))})
		require(cpu.gcHeap().object(cpu.gcHeap().reference(object)) == object, "threads, closures and upvalues have references at construction");
	auto* roots = cpu.createTable(512);
	frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.top = 2;
	ValueStorage slots(400);
	for (size_t i = 0; i < slots.capacity(); ++i) {
		auto* table = cpu.createTable(); roots->setInteger(static_cast<int>(i + 1), valueTable(cpu.gcHeap().reference(table)));
		slots.words()[i] = cpu.gcHeap().reference(table); slots.tags()[i] = static_cast<u8>(ValueTag::Table);
	}
	cpu.collectHeap();
	for (size_t i = 0; i < slots.capacity(); ++i)
		require(cpu.gcHeap().tableAt(slots.words()[i]) == asTable(roots->getInteger(static_cast<int>(i + 1)),cpu.gcHeap()), "32-bit payloads survive allocation growth and collection");
	checkReferences(cpu);
	auto* dead = cpu.createTable(); const u32 freeId = cpu.gcHeap().reference(dead), hash = dead->hashId;
	cpu.collectHeap();
	auto* replacement = cpu.createTable();
	require(cpu.gcHeap().reference(replacement) == freeId && replacement->hashId != hash, "allocator reuses the record address; collector ordinals remain distinct");
	require(cpu.gcHeap().tableAt(freeId) == replacement, "recycled ids resolve the replacement object");
	frame.registers.set(2,valueTable(cpu.gcHeap().reference(replacement))); frame.top = 3;
}

void restoreRebindsWithoutRetainingDiscardedFutures() {
	Machine machine; auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	auto* roots = cpu.createTable(4); frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.top = 2;
	for (int i = 1; i <= 4; ++i) roots->setInteger(i, valueTable(cpu.gcHeap().reference(cpu.createTable())));
	// Leave holes before saving, then consume them on a discarded timeline.
	cpu.createTable();
	cpu.createTable();
	cpu.collectHeap();
	const auto saved = cpu.captureRuntimeState();
	const auto ram = cpu.memory().captureSaveState();
	const u32 rootsRef = cpu.gcHeap().reference(roots);
	const Value fourth = roots->getInteger(4);
	require(std::count(saved.gc.references.begin(), saved.gc.references.end(), 0) == 5,
		"the five physical tables do not consume directory slots");
	for (int iteration = 0; iteration < 64; ++iteration) {
		std::array<u32, 12> future{};
		for (auto& address : future) address = cpu.createTable()->address();
		cpu.memory().restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		const Value restoredRoots = cpu.rootThread()->currentFrame->registers.get(0);
		require(valuePayload(restoredRoots) == rootsRef &&
			asTable(restoredRoots, cpu.gcHeap())->getInteger(4) == fourth,
			"raw reference words still bind the restored table and its entries");
		checkReferences(cpu);
		const auto restored = cpu.captureRuntimeState();
		require(std::ranges::equal(saved.snapshot.words(), restored.snapshot.words())
			&& std::ranges::equal(saved.snapshot.objectWords(), restored.snapshot.objectWords())
			&& saved.gc.references == restored.gc.references
			&& saved.gc.freeReferences == restored.gc.freeReferences,
			"restore preserves slot identities and the directory allocation order");
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
	auto* roots = cpu.createTable(1024); frame.registers.set(0,valueTable(cpu.gcHeap().reference(roots))); frame.top = 2;
	for (int i = 1; i <= 1000; ++i) {
		roots->setInteger(i, valueTable(cpu.gcHeap().reference(cpu.createTable(1, 1))));
		auto* dead = cpu.createTable(1); dead->setInteger(1, valueTable(cpu.gcHeap().reference(cpu.createTable())));
	}
	std::unordered_set<GcPhase> phases;
	for (int step = 0; step < 1000; ++step) {
		cpu.gcHeap().step(valueNil(), valueNil(), valueNil()); checkReferences(cpu);
		const auto saved = cpu.captureRuntimeState(); phases.insert(saved.gc.phase);
		cpu.restoreRuntimeState(saved); checkReferences(cpu);
		const auto restored = cpu.captureRuntimeState();
		require(std::ranges::equal(saved.snapshot.words(), restored.snapshot.words())
			&& std::ranges::equal(saved.snapshot.objectWords(), restored.snapshot.objectWords())
			&& saved.gc.allocations == restored.gc.allocations && saved.gc.colors == restored.gc.colors,
			"restoring a partial collection preserves graph and allocation order");
		if (!cpu.gcHeap().active()) break;
	}
	for (auto phase : {GcPhase::Mark, GcPhase::Atomic, GcPhase::Sweep, GcPhase::Pause})
		require(phases.contains(phase), "reference test traverses marking and retirement");
}

void builtinIdentitiesStayOutsideTheGcHeap() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	auto* functions = cpu.createTable(BUILTIN_FUNCTION_COUNT);
	frame.registers.set(0,valueTable(cpu.gcHeap().reference(functions))); frame.top = 2;
	const auto before = cpu.gcHeap().captureState([&](const GCObject* object) { return cpu.gcHeap().reference(object); });
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		functions->setInteger(static_cast<int>(i + 1), cpu.createBuiltinFunction(static_cast<BuiltinFunctionId>(i)));
	const auto after = cpu.gcHeap().captureState([&](const GCObject* object) { return cpu.gcHeap().reference(object); });
	require(before.allocations == after.allocations, "builtin functions have CPU-owned ids, not GC registrations");
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	functions = asTable(cpu.rootThread()->currentFrame->registers.get(0),cpu.gcHeap());
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		require(asBuiltinFunctionId(functions->getInteger(static_cast<int>(i + 1))) == static_cast<BuiltinFunctionId>(i),
			"builtin ids survive restore including zero");
}

void isolatedHeaps() {
	Machine first, second;
	auto* a = first.cpu.createTable(); auto* b = second.cpu.createTable();
	const u32 ar = first.cpu.gcHeap().reference(a), br = second.cpu.gcHeap().reference(b);
	require(a != b, "concurrent CPUs own distinct allocations");
	require(ar == br, "directory slots are local to equally initialized heaps");
	require(first.cpu.gcHeap().tableAt(ar) == a && second.cpu.gcHeap().tableAt(br) == b,
		"each CPU resolves its own object references");
}
}
int main() {
	try {
		liveReferencesAndReuse(); restoreRebindsWithoutRetainingDiscardedFutures(); incrementalRestore();
		builtinIdentitiesStayOutsideTheGcHeap(); isolatedHeaps();
		std::cout << "heap reference tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
