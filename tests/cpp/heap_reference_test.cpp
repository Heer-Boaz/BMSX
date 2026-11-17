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
		require(cpu.gcHeap().reference(cpu.gcHeap().object(id)) == id, "reference round-trips its live allocation");
		highest = std::max(highest, id);
	}
	return highest;
}

void liveReferencesAndReuse() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	static_assert(sizeof(decltype(cpu.gcHeap().reference(cpu.rootThread()))) == sizeof(u32));
#if UINTPTR_MAX == UINT32_MAX
	static_assert(offsetof(GCObject, next) == 8, "32-bit objects have no directory id");
#endif
	for (auto* object : {static_cast<GCObject*>(cpu.rootThread()), static_cast<GCObject*>(frame.closure),
		static_cast<GCObject*>(asClosure(frame.registers[1])), static_cast<GCObject*>(asClosure(frame.registers[1])->upvalues[0])})
		require(cpu.gcHeap().object(cpu.gcHeap().reference(object)) == object, "threads, closures and upvalues have references at construction");
	auto* roots = cpu.createTable(512);
	frame.registers[0] = valueTable(roots); frame.top = 2;
	ValueStorage slots(400);
	for (size_t i = 0; i < slots.capacity(); ++i) {
		auto* table = cpu.createTable(); roots->setInteger(static_cast<int>(i + 1), valueTable(table));
		slots.words()[i] = cpu.gcHeap().reference(table); slots.tags()[i] = static_cast<u8>(ValueTag::Table);
	}
	cpu.collectHeap();
	for (size_t i = 0; i < slots.capacity(); ++i)
		require(cpu.gcHeap().object(slots.words()[i]) == asTable(roots->getInteger(static_cast<int>(i + 1))), "32-bit payloads survive allocation growth and collection");
	checkReferences(cpu);
	auto* dead = cpu.createTable(); const u32 freeId = cpu.gcHeap().reference(dead), hash = dead->hashId;
	cpu.collectHeap();
	auto* replacement = cpu.createTable();
	require(cpu.gcHeap().reference(replacement) == freeId && replacement->hashId != hash, "a recycled payload id is not a hash identity");
	require(cpu.gcHeap().object(freeId) == replacement, "recycled ids resolve the replacement object");
	frame.registers[2] = valueTable(replacement); frame.top = 3;
}

void restoreRebindsWithoutRetainingDiscardedFutures() {
	Machine machine; auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	auto* roots = cpu.createTable(4); frame.registers[0] = valueTable(roots); frame.top = 2;
	for (int i = 1; i <= 4; ++i) roots->setInteger(i, valueTable(cpu.createTable()));
	cpu.collectHeap();
	const auto saved = cpu.captureRuntimeState();
	const u32 thread = cpu.gcHeap().reference(cpu.rootThread()), canonical = cpu.gcHeap().reference(frame.closure);
	u32 peak = 0;
	for (int iteration = 0; iteration < 64; ++iteration) {
		for (int i = 0; i < 12; ++i) cpu.createTable();
		cpu.restoreRuntimeState(saved);
		require(cpu.gcHeap().object(thread) == cpu.rootThread() && cpu.gcHeap().reference(cpu.rootThread()->currentFrame->closure) == canonical,
			"restore preserves root and canonical closure registrations");
		const u32 highest = checkReferences(cpu);
		if constexpr (sizeof(void*) > sizeof(u32)) {
			if (iteration < 2) peak = std::max(peak, highest);
			else require(highest <= peak, "discarded futures recycle directory ids across repeated restore");
		}
		const auto restored = cpu.captureRuntimeState();
		require(std::ranges::equal(saved.snapshot.words(), restored.snapshot.words())
			&& std::ranges::equal(saved.snapshot.objectWords(), restored.snapshot.objectWords()), "reference metadata does not change serialized guest state");
	}
}

void incrementalRestore() {
	Machine machine; auto& cpu = machine.cpu; auto& frame = *cpu.rootThread()->currentFrame;
	auto* roots = cpu.createTable(1024); frame.registers[0] = valueTable(roots); frame.top = 2;
	for (int i = 1; i <= 1000; ++i) {
		roots->setInteger(i, valueTable(cpu.createTable(1, 1)));
		auto* dead = cpu.createTable(1); dead->setInteger(1, valueTable(cpu.createTable()));
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
	frame.registers[0] = valueTable(functions); frame.top = 2;
	const auto before = cpu.gcHeap().captureState([&](const GCObject* object) { return cpu.gcHeap().reference(object); });
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		functions->setInteger(static_cast<int>(i + 1), cpu.createBuiltinFunction(static_cast<BuiltinFunctionId>(i)));
	const auto after = cpu.gcHeap().captureState([&](const GCObject* object) { return cpu.gcHeap().reference(object); });
	require(before.allocations == after.allocations, "builtin functions have CPU-owned ids, not GC registrations");
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	functions = asTable(cpu.rootThread()->currentFrame->registers[0]);
	for (size_t i = 0; i < BUILTIN_FUNCTION_COUNT; ++i)
		require(asBuiltinFunction(functions->getInteger(static_cast<int>(i + 1)))->id == static_cast<BuiltinFunctionId>(i),
			"builtin ids survive restore including zero");
}

void isolatedHeaps() {
	Machine first, second;
	auto* a = first.cpu.createTable(); auto* b = second.cpu.createTable();
	const u32 ar = first.cpu.gcHeap().reference(a), br = second.cpu.gcHeap().reference(b);
	require(a != b, "concurrent CPUs own distinct allocations");
#if UINTPTR_MAX == UINT32_MAX
	require(ar == reinterpret_cast<uintptr_t>(a) && br == reinterpret_cast<uintptr_t>(b),
		"32-bit references are the complete native pointer without indirection");
#else
	require(ar == br, "directory ids are local to equally initialized heaps");
#endif
	require(first.cpu.gcHeap().object(ar) == a && second.cpu.gcHeap().object(br) == b,
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
