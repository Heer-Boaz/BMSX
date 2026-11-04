#include "machine/cpu/cpu.h"
#include "machine/cpu/lua_heap.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void requireSameSnapshot(const StringPoolState& actual, const StringPoolState& expected) {
	require(actual.entries.size() == expected.entries.size(), "snapshot contains only allocated string entries");
	for (size_t index = 0; index < actual.entries.size(); ++index) {
		const auto& a = actual.entries[index];
		const auto& b = expected.entries[index];
		require(a.id == b.id && a.value == b.value && a.tracked == b.tracked, "snapshot preserves IDs, text and RAM ownership");
	}
}

struct PoolMachine {
	Memory memory{MemoryInit{}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
};

void reclaimTextAndSnapshotStorage() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	cpu.collectHeap();
	const auto baselineBytes = cpu.luaHeap().usedBytes();
	const auto baseline = pool.captureState();
	const std::string suffix(512, 'x');
	for (int round = 0; round < 8; ++round) {
		for (int index = 0; index < 128; ++index) pool.intern("garbage-" + std::to_string(round) + "-" + std::to_string(index) + "-" + suffix);
		cpu.collectHeap();
		require(cpu.luaHeap().usedBytes() == baselineBytes, "collection releases the actual RAM debit");
		require(!pool.find("garbage-" + std::to_string(round) + "-0-" + suffix), "unreachable text leaves the intern index");
		requireSameSnapshot(pool.captureState(), baseline);
	}
}

void recycleUnicodeAndUntrackedStrings() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	const auto baselineTracked = pool.trackedLuaHeapBytes();
	const auto old = pool.intern("retired literal", false);
	pool.intern("");
	cpu.collectHeap();
	require(!pool.find("retired literal") && !pool.find(""), "ROM accounting and empty payloads do not imply immortality");
	const auto replacement = pool.intern("β😀");
	require(replacement == old, "dead trailing IDs are recycled without growing the pool");
	require(pool.toString(replacement) == "β😀" && pool.codepointCount(replacement) == 2, "recycled slots publish the new Unicode metadata");
	require(pool.trackedLuaHeapBytes() == baselineTracked + 6, "new runtime text owns its actual UTF-8 payload bytes");
}

void promoteAcrossReservationCollection() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	const std::string text = "an existing untracked entry";
	const auto id = pool.intern(text, false);
	const auto heap = cpu.luaHeap().captureState();
	cpu.luaHeap().restoreState({heap.trackedBytes, 0});
	require(pool.intern(text) == id && pool.find(text) == id, "intern roots an existing entry before collection can free it");
	require(pool.toString(id) == text, "the existing native entry survives the reserve call");
	cpu.collectHeap();
	require(!pool.find(text), "the reservation root expires when intern returns");
}

void retainNestedMaterializationRoots() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	StringId outerId = 0;
	{
		auto outer = cpu.acquireLocalRoots();
		outerId = pool.intern("outer string");
		{
			auto inner = cpu.acquireLocalRoots();
			const auto innerId = pool.intern("inner string", false);
			cpu.collectHeap();
			require(pool.toString(outerId) == "outer string" && pool.toString(innerId) == "inner string", "nested scopes retain their own returned IDs");
		}
		cpu.collectHeap();
		require(!pool.find("inner string") && pool.find("outer string") == outerId, "inner roots retire without releasing the outer phase");
		auto* table = cpu.createTable();
		const auto key = pool.intern("nested key");
		table->setStringKey(key, valueNumber(7));
		cpu.collectHeap();
		require(asNumber(table->getStringKey(key)) == 7, "the same CPU materialization phase owns tables and strings");
	}
	cpu.collectHeap();
	require(!pool.find("outer string") && !pool.find("nested key"), "CPU scope retirement releases string roots");
}

void replaySparseAllocationOrder() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	pool.beginLocalRoots();
	pool.intern("left anchor");
	pool.beginLocalRoots();
	const std::array holes{pool.intern("hole one"), pool.intern("hole two"), pool.intern("hole three")};
	pool.endLocalRoots();
	const auto right = pool.intern("right anchor");
	cpu.collectHeap();
	require(pool.intern("partially reused") == holes[2], "the canonical allocator consumes the highest vacant ID first");
	pool.endLocalRoots();
	const auto snapshot = pool.captureState();
	const std::array future{pool.intern("future one"), pool.intern("future two"), pool.intern("future three")};
	require(future == std::array{holes[1], holes[0], right + 1}, "partial reuse leaves canonical holes followed by append storage");
	const auto expected = pool.captureState();
	pool.restoreState(snapshot);
	require(std::array{pool.intern("future one"), pool.intern("future two"), pool.intern("future three")} == future, "sparse restore reproduces the next allocation IDs");
	requireSameSnapshot(pool.captureState(), expected);
}

void reuseDeletedStringKeyId() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	const auto root = pool.intern("table root", false);
	auto* table = cpu.createTable(0, 8);
	cpu.setGlobalByKey(root, valueTable(table));
	const auto removed = pool.intern("removed key");
	table->setStringKey(removed, valueNumber(19));
	table->setStringKey(removed, valueNil());
	const auto retained = pool.intern("retained key");
	table->setStringKey(retained, valueNumber(23));
	cpu.collectHeap();
	require(!pool.find("removed key"), "dead hash nodes do not own their former string text");
	const auto replacement = pool.intern("replacement key");
	require(replacement == removed && isNil(table->getStringKey(replacement)), "recycled IDs do not resurrect removed mappings");
	table->setStringKey(replacement, valueNumber(29));
	require(asNumber(table->getStringKey(replacement)) == 29 && asNumber(table->getStringKey(retained)) == 23, "a new mapping coexists with retained keys");
	Value key = valueNil(), value = valueNil();
	std::vector<std::string> keys;
	while (table->nextEntry(key, key, value)) {
		require(valueIsString(key), "the fixture's live mappings retain string representation");
		keys.push_back(pool.toString(asStringId(key)));
	}
	std::sort(keys.begin(), keys.end());
	require(keys == std::vector<std::string>{"replacement key", "retained key"}, "iteration exposes exactly the new and retained mappings");
}

test::Blua32TestImage externalCallImage() {
	test::Blua32TestImage image;
	image.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3}, {.firstWord = 3, .wordCount = 1, .numParams = 1, .maxStack = 512, .staticClosure = false}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	return image;
}

void admitExternalArgumentsAcrossStackGrowth() {
	for (const bool explicitDomain : {false, true}) {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, externalCallImage());
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		cpu.reset();
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "the real image returns a dynamic callee");
		const auto completion = cpu.readCompletionValues();
		require(valueIsClosure(completion[0]), "call admission receives an actual guest closure");
		auto* closure = asClosure(completion[0]);
		const std::string text(4096, 'a');
		const auto id = cpu.stringPool().intern(text);
		const std::array args{valueString(id)};
		const auto heap = cpu.luaHeap().captureState();
		cpu.luaHeap().restoreState({heap.trackedBytes, 0});
		if (explicitDomain) cpu.beginCompletionClosureInExecutionDomain(-1, *closure, BuiltinArgsView(args.data(), args.size()));
		else cpu.beginCompletionCall(*closure, BuiltinArgsView(args.data(), args.size()));
		require(cpu.stringPool().find(text) == id, "stack growth cannot collect incoming host arguments");
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "the admitted callee returns normally");
		const auto result = cpu.readCompletionValues();
		require(result.size() == 1 && valueIsString(result[0]) && asStringId(result[0]) == id, "the real call preserves the original string ID");
		require(cpu.stringPool().toString(id) == text, "the result owns its original payload");
		const BuiltinArgsView forwarded(result.data(), result.size());
		if (explicitDomain) cpu.beginCompletionClosureInExecutionDomain(-1, *closure, forwarded);
		else cpu.beginCompletionCall(*closure, forwarded);
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "completion-latch arguments can be admitted as the next call's input");
		const auto forwardedResult = cpu.readCompletionValues();
		require(forwardedResult.size() == 1 && asStringId(forwardedResult[0]) == id, "admission consumes its retained argument copy before clearing the old latch");
	}
}
} // namespace

int main() {
	try {
		reclaimTextAndSnapshotStorage();
		recycleUnicodeAndUntrackedStrings();
		promoteAcrossReservationCollection();
		retainNestedMaterializationRoots();
		replaySparseAllocationOrder();
		reuseDeletedStringKeyId();
		admitExternalArgumentsAcrossStackGrowth();
		std::cout << "String pool lifetime tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
