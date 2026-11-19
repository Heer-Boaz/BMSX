#include "machine/cpu/cpu.h"
#include "machine/cpu/heap_allocator.h"
#include "spec/blua32/image_format.h"
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

struct PoolMachine {
	Memory memory{MemoryInit{}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
};

void indexBytesAcrossRestore() {
	PoolMachine machine;
	auto& pool = machine.cpu.stringPool();
	std::string ascii;
	for (int code = 0; code < 256; ++code) ascii.push_back(static_cast<char>(code));
	std::string unicode;
	for (int i = 0; i < 23; ++i) unicode += std::string("β😀A🚀\0é", 14);
	for (const auto& text : {ascii, std::string("Aé雪\0Z", 8),
		std::string("β😀A🚀\0é", 14), std::string("😀"), std::string(4096, 'a'), unicode}) {
		const auto id = pool.intern(text);
		require(pool.byteLength(id) == static_cast<int>(text.size()), "the byte count includes zero and invalid UTF-8");
		const auto state = machine.memory.captureSaveState();
		for (size_t index = text.size(); index > 0; --index) {
			require(pool.byteAt(id, index - 1u) == static_cast<u8>(text[index - 1u]), "indexing preserves exact bytes");
		}
		require((machine.memory.readRamRecordWord(id) & 0xffu) == BLUA32_STRING_RECORD_KIND, "payload addresses a physical String");
		require(machine.memory.readRamRecordWord(id + 8u) == text.size(), "record length is exact");
		machine.memory.restoreSaveState(state);
		for (size_t index = 0; index < text.size(); ++index) {
			require(pool.byteAt(id, index) == static_cast<u8>(text[index]), "indexing survives snapshot restore");
		}
	}
}

void reclaimUnreachableRecords() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	const std::string suffix(512, 'x');
	size_t steadyBytes = 0;
	for (int round = 0; round < 8; ++round) {
		for (int index = 0; index < 128; ++index) pool.intern("garbage-" + std::to_string(round) + "-" + std::to_string(index) + "-" + suffix);
		cpu.collectHeap();
		if (round == 0) steadyBytes = cpu.luaHeap().usedBytes();
		require(cpu.luaHeap().usedBytes() == steadyBytes, "the heap returns to its steady bucket capacity");
		for (int index = 0; index < 128; ++index) require(!pool.find("garbage-" + std::to_string(round) + "-" + std::to_string(index) + "-" + suffix), "unreachable String leaves its bucket");
	}
}

void collectEmptyString() {
	PoolMachine machine;
	auto& pool = machine.cpu.stringPool();
	const auto empty = pool.intern("");
	require(pool.intern("") == empty && pool.byteLength(empty) == 0u, "empty bytes have a canonical live String record");
	machine.cpu.collectHeap();
	require(!pool.find(""), "a RAM record with no suffix is still collectible");
}

void reclaimLongByteStrings() {
	PoolMachine machine;
	auto& cpu = machine.cpu; auto& pool = cpu.stringPool();
	cpu.collectHeap();
	const auto baseline = cpu.luaHeap().usedBytes();
	std::string text;
	for (int i = 0; i < 23; ++i) text += std::string("β😀A🚀\0é", 14);
	const auto old = pool.intern(text);
	require(cpu.luaHeap().usedBytes() == baseline + heapAllocationBytes(BLUA32_STRING_RECORD_HEADER_SIZE + text.size()), "the complete record allocation is charged");
	require(pool.byteAt(old, 128) == static_cast<u8>(text[128]), "long indexes address the exact byte");
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == baseline, "GC releases the long Unicode payload");
	text.clear(); for (int i = 0; i < 65; ++i) text += "😀";
	const auto id = pool.intern(text);
	require(pool.byteAt(id, 64) == 0xf0, "subsequent allocation publishes replacement bytes");
	cpu.collectHeap();
	require(pool.byteAt(pool.intern("ascii"), 4) == 'i', "short replacement publishes its own bytes");
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
			const auto innerId = pool.intern("inner string");
			cpu.collectHeap();
			require(pool.toString(outerId) == "outer string" && pool.toString(innerId) == "inner string", "nested scopes retain their own returned IDs");
		}
		cpu.collectHeap();
		require(!pool.find("inner string") && pool.find("outer string") == outerId, "inner roots retire without releasing the outer phase");
		auto table = cpu.createTable();
		const auto key = pool.intern("nested key");
		table.setStringKey(key, valueInteger(7));
		cpu.collectHeap();
		require(table.getStringKey(key) == valueInteger(7), "the same CPU materialization phase owns tables and strings");
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
	for (const auto text : {"hole one", "hole two", "hole three"}) pool.intern(text);
	pool.endLocalRoots();
	pool.intern("right anchor");
	cpu.collectHeap();
	pool.intern("partially reused");
	pool.endLocalRoots();
	const auto ram = machine.memory.captureSaveState();
	const std::array future{pool.intern("future one"), pool.intern("future two"), pool.intern("future three")};
	const auto expected = machine.memory.captureSaveState();
	machine.memory.restoreSaveState(ram);
	require(std::array{pool.intern("future one"), pool.intern("future two"), pool.intern("future three")} == future, "restore reproduces the next physical addresses");
	require(machine.memory.captureSaveState().ram == expected.ram, "restore reproduces the same String data and allocator state");
}

void reuseDeletedStringKeyId() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	const auto root = pool.intern("table root");
	auto table = cpu.createTable(0, 8);
	cpu.setGlobalByKey(root, valueTable(table.address()));
	const auto removed = pool.intern("removed key");
	table.setStringKey(removed, valueInteger(19));
	table.setStringKey(removed, valueNil());
	const auto retained = pool.intern("retained key");
	table.setStringKey(retained, valueInteger(23));
	cpu.collectHeap();
	require(!pool.find("removed key"), "dead hash nodes do not own their former string text");
	const auto replacement = pool.intern("replacement key");
	require(isNil(table.getStringKey(replacement)), "recycled IDs do not resurrect removed mappings");
	table.setStringKey(replacement, valueInteger(29));
	require(table.getStringKey(replacement) == valueInteger(29) && table.getStringKey(retained) == valueInteger(23), "a new mapping coexists with retained keys");
	Value key = valueNil(), value = valueNil();
	std::vector<std::string> keys;
	for (table.nextEntry(key, key, value); !isNil(key); table.nextEntry(key, key, value)) {
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
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3}, {.firstWord = 3, .wordCount = 1, .numParams = 1, .maxStack = 512, .staticClosure = false}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	return image;
}

void admitExternalArgumentsAcrossStackGrowth() {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, externalCallImage());
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		cpu.reset();
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "the real image returns a dynamic callee");
		const auto completion = cpu.readCompletionValues();
		require(valueIsClosure(completion.get(0)), "call admission receives an actual guest closure");
		auto closure = asClosure(completion.get(0), cpu.gcHeap());
		const std::string text(4096, 'a');
		const auto id = cpu.stringPool().intern(text);
		const std::array args{valueString(id)};
		cpu.luaHeap().setCollectionTarget(0);
		cpu.beginCompletionCall(closure, BuiltinArgsView(args.data(), args.size()));
		require(cpu.stringPool().find(text) == id, "stack growth cannot collect incoming host arguments");
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "the admitted callee returns normally");
		const auto result = cpu.readCompletionValues();
		require(result.size() == 1 && valueIsString(result.get(0)) && asStringId(result.get(0)) == id, "the real call preserves the original string ID");
		require(cpu.stringPool().toString(id) == text, "the result owns its original payload");
		const BuiltinArgsView forwarded(result);
		cpu.beginCompletionCall(closure, forwarded);
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "completion-latch arguments can be admitted as the next call's input");
		const auto forwardedResult = cpu.readCompletionValues();
		require(forwardedResult.size() == 1 && asStringId(forwardedResult.get(0)) == id, "admission consumes its retained argument copy before clearing the old latch");
}
} // namespace

int main() {
	try {
		indexBytesAcrossRestore();
		reclaimUnreachableRecords();
		collectEmptyString();
		reclaimLongByteStrings();
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
