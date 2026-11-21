#include "machine/cpu/cpu.h"
#include "common/hash_fnv.h"
#include "machine/cpu/heap_allocator.h"
#include "spec/blua32/image_format.h"
#include "machine/cpu/lua_heap.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
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

void resumeMajorStringBucket() {
	PoolMachine machine;
	auto& pool = machine.cpu.stringPool();
	std::array<std::string, 7> names;
	for (u32 candidate = 0, count = 0; count < names.size(); ++candidate) {
		const auto name = "chain:" + std::to_string(candidate);
		if ((fnv1a32(name) & 63u) == 0u) names[count++] = name;
	}
	std::array<StringId, 6> ids;
	for (size_t i = 0; i < ids.size(); ++i) ids[i] = pool.intern(names[i]);
	pool.beginReachabilityEpoch();
	pool.markReachable(ids.back()); pool.takeMarkWork();
	pool.beginSweep();
	require(pool.sweepStep(2) == 2u && pool.find(names[4]) == ids[4],
		"one bucket and its first retained header exhaust two units without visiting the suffix");
	const auto ram = machine.memory.captureSaveState();
	const auto finish = [&] {
		const auto fresh = pool.intern(names.back());
		require(pool.sweepStep(1) == 1u && !pool.find(names[4]) && pool.find(names[3]) == ids[3],
			"resume retires exactly the next header without charging the same index");
		for (int step = 0; pool.sweeping() && step < 100; ++step) pool.sweepStep(2);
		require(!pool.sweeping(), "all String buckets finish");
		for (size_t i = 0; i < 5; ++i) require(!pool.find(names[i]), "unmarked collision removed");
		require(pool.find(names[5]) == ids.back() && pool.find(names[6]) == fresh,
			"both retained predecessor and new head survive the resumed suffix");
		return machine.memory.captureSaveState().ram;
	};
	const auto expected = finish();
	machine.memory.restoreSaveState(ram);
	require(finish() == expected, "String sweep link and extent replay byte-exactly");
}

void stringAdmissionStartsSweepDuringUnchargedRehash() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	auto& memory = machine.memory;
	constexpr u32 capacity = 8192;
	auto roots = cpu.createTable(capacity, 0);
	cpu.setGlobalByKey(pool.intern("String growth root"), valueTable(roots.address()));
	const u32 metadata = cpu.heapAllocator().managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(metadata + field); };
	const u32 count = capacity - read(8u);
	const auto name = [](u32 index) { return "fill:" + std::to_string(index); };
	for (u32 i = 0; i < count; ++i) roots.setInteger(i + 1u, valueString(pool.intern(name(i))));
	require(read(4u) == capacity && read(8u) == capacity, "the next distinct String needs a bucket growth");
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	for (int step = 0; cpu.gcHeap().phase() != GcPhase::Sweep && step < 40; ++step) advance();
	require(cpu.gcHeap().phase() == GcPhase::Sweep, "objects must be swept before String reclamation");
	advance(); advance();
	require(cpu.gcHeap().phase() == GcPhase::Sweep, "String admission will reach the last object page");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		cpu.luaHeap().setCollectionTarget(0);
		const auto added = pool.intern("growth crosses into Strings");
		require((read(4u) & 0x7fffffffu) == capacity && cpu.gcHeap().phase() == GcPhase::Strings
			&& read(0x38u) != 0u && read(0x3cu) > 0u,
			"unbilled rehash work advances before admitting the String and then yields to its sweep");
		for (int step = 0; cpu.collecting() && step < 20; ++step) advance();
		require(!cpu.collecting() && read(4u) == 2u * capacity && pool.find("growth crosses into Strings") == added,
			"later work completes the growth and retains the new String");
		for (u32 i = 0; i < count; ++i) require(pool.find(name(i)) == asStringId(roots.getInteger(i + 1u)), "each split retains its original interned addresses");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "rewind replays growth during String sweep");
}

void rehashCollisionAcrossSweepAndRewind() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	auto& pool = cpu.stringPool();
	auto& memory = machine.memory;
	constexpr u32 capacity = 4096u;
	auto roots = cpu.createTable(4, 0);
	cpu.setGlobalByKey(pool.intern("collision rehash root"), valueTable(roots.address()));
	const u32 metadata = cpu.heapAllocator().managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(metadata + field); };
	u32 candidate = 0;
	const auto collision = [&]() {
		for (;;) {
			auto text = "rehash collision " + std::to_string(candidate++);
			if ((fnv1a32(text) & (capacity - 1u)) == 0u) return text;
		}
	};
	std::vector<std::pair<std::string, StringId>> entries;
	const u32 count = capacity - read(8u);
	entries.reserve(count);
	for (u32 i = 0; i < count; ++i) {
		auto text = i < 128u ? collision() : "rehash filler " + std::to_string(i);
		const auto id = pool.intern(text);
		entries.emplace_back(std::move(text), id);
	}
	require(read(4u) == capacity, "the next distinct String starts the 4096-bucket growth");
	const u32 oldBase = read(0u);
	const auto trigger = collision();
	const auto logicalBefore = cpu.luaHeap().usedBytes();
	const auto physicalBefore = cpu.heapAllocator().occupiedBytes();
	const auto inserted = pool.intern(trigger);
	const u32 insertedBytes = BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(trigger.size());
	require(cpu.luaHeap().usedBytes() == logicalBefore + insertedBytes
		&& cpu.heapAllocator().occupiedBytes() == physicalBefore + heapAllocationBytes(8u * capacity) + heapAllocationBytes(insertedBytes),
		"the new directory is physically reserved without adding to the String's nominal charge");
	const u32 nextBase = read(0x38u);
	require(nextBase != 0u && read(0x3cu) == 1u, "the intern yields inside the first long bucket, not after it");
	const std::array survivors{memory.readRamRecordWord(oldBase), memory.readRamRecordWord(nextBase),
		memory.readRamRecordWord(nextBase + 4u * capacity), inserted};
	for (u32 index = 0; index < survivors.size(); ++index) {
		require(survivors[index] != 0u, "the old chain and both destination chains are populated");
		roots.setInteger(index + 1u, valueString(survivors[index]));
	}
	const auto retained = [&](StringId id) { return std::find(survivors.begin(), survivors.end(), id) != survivors.end(); };
	u32 logicalRelease = 0u, physicalRelease = heapAllocationBytes(4u * capacity);
	for (const auto& [text, id] : entries) {
		require(pool.find(text) == id, "lookups preserve IDs in each directory");
		if (!retained(id)) {
			const u32 bytes = BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(text.size());
			logicalRelease += bytes;
			physicalRelease += heapAllocationBytes(bytes);
		}
	}
	const auto usage = cpu.luaHeap().usedBytes();
	const auto occupied = cpu.heapAllocator().occupiedBytes();
	RamHistory archive;
	RamHistory::PageMap checkpoint, collected;
	archive.capture(memory, nullptr, checkpoint);
	const auto state = cpu.captureRuntimeState();
	const auto advance = [&] { cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const auto finish = [&] {
		for (int step = 0; cpu.gcHeap().phase() != GcPhase::Strings && step < 40; ++step) advance();
		require(cpu.gcHeap().phase() == GcPhase::Strings && read(0x3cu) == 1u,
			"sweep visits both planes before moving any more links");
		for (int step = 0; cpu.collecting() && step < 40; ++step) advance();
		require(!cpu.collecting() && read(0u) == nextBase && read(4u) == 2u * capacity && read(0x38u) == 0u,
			"the old directory is no longer published when collection completes");
		require(pool.find(trigger) == inserted, "the inserted String survives its new chain's sweep");
		for (const auto& [text, id] : entries) {
			const auto found = pool.find(text);
			require(retained(id) ? found == id : !found, "both directories sweep exactly their unmarked Strings");
		}
		require(cpu.luaHeap().usedBytes() == usage - logicalRelease && cpu.heapAllocator().occupiedBytes() == occupied - physicalRelease,
			"retirement returns only the dead String charges and physically frees the old directory");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	archive.capture(memory, &checkpoint, collected);
	archive.restore(memory, collected, checkpoint);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "rewind reproduces the old and new chain frontiers and allocation bytes");
}

void reclaimLongByteStrings() {
	PoolMachine machine;
	auto& cpu = machine.cpu; auto& pool = cpu.stringPool();
	cpu.collectHeap();
	const auto baseline = cpu.luaHeap().usedBytes();
	const u32 physical = cpu.heapAllocator().occupiedBytes();
	std::string text;
	for (int i = 0; i < 23; ++i) text += std::string("β😀A🚀\0é", 14);
	const auto old = pool.intern(text);
	const size_t bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.size();
	require(cpu.luaHeap().usedBytes() == baseline + bytes, "logical charge includes the header and payload but not class padding");
	require(cpu.heapAllocator().occupiedBytes() == physical + heapAllocationBytes(bytes), "physical diagnostics include padding");
	require(pool.byteAt(old, 128) == static_cast<u8>(text[128]), "long indexes address the exact byte");
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == baseline && cpu.heapAllocator().occupiedBytes() == physical,
		"GC releases both the logical charge and the physical record");
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

void admitExternalArgumentsAcrossStackGrowth(bool finalPending) {
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
		if (finalPending) {
			auto& heap = cpu.gcHeap();
			for (int step = 0; !heap.finalMarkPending() && step < 30; ++step) cpu.stepHeap(valueNil(), valueNil(), valueNil());
			require(heap.finalMarkPending(), "a final pass is pending when the host can enter an explicit call");
		}
		cpu.luaHeap().setCollectionTarget(0);
		cpu.beginCompletionCall(closure, BuiltinArgsView(args.data(), args.size()));
		require((!finalPending || !cpu.gcHeap().finalMarkPending()) && cpu.stringPool().find(text) == id,
			"call entry roots its incoming argument before final marking and stack growth");
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
		resumeMajorStringBucket();
		stringAdmissionStartsSweepDuringUnchargedRehash();
		rehashCollisionAcrossSweepAndRewind();
		reclaimLongByteStrings();
		retainNestedMaterializationRoots();
		replaySparseAllocationOrder();
		reuseDeletedStringKeyId();
		admitExternalArgumentsAcrossStackGrowth(false);
		admitExternalArgumentsAcrossStackGrowth(true);
		std::cout << "String pool lifetime tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
