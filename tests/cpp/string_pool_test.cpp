#include "support/string_pool_reference.h"
#include "support/lua_heap_reference.h"
#include "support/heap_allocator_reference.h"
#include "machine/cpu/cpu.h"
#include "common/hash_fnv.h"
#include "spec/blua32/image_format.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/managed_fixture.h"
#include "support/string_slice_reference.h"
#include "support/table_allocation_reference.h"

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
	PoolMachine() { test::seedManagedHeapFixture(cpu); }
};

void indexBytesAcrossRestore() {
	PoolMachine machine;
	bmsx::test::StringPoolReference pool(machine.cpu);
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

void internComparesAllCandidateBytes() {
	PoolMachine machine;
	bmsx::test::StringPoolReference pool(machine.cpu);
	std::array<char, 1170> buffer;
	for (size_t i = 0; i < buffer.size(); ++i) buffer[i] = static_cast<char>(i * 197u);
	for (size_t length : {63, 64, 65, 255, 256, 257, 1153}) {
		for (size_t offset = 0; offset < 16; ++offset) {
			const std::string_view input(buffer.data() + offset, length);
			const auto id = pool.intern(input);
			require(pool.find(input) == id, "unaligned matching bytes reuse the same String");
			// Bus writes change the payload without changing its recorded hash.
			for (size_t i = 0; i < length; ++i) {
				const u32 at = id + BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(i);
				const u8 original = static_cast<u8>(input[i]);
				machine.memory.writeRamRecordByte(at, original ^ 0x80u);
				require(!pool.find(input), "same hash and length do not hide a differing byte");
				machine.memory.writeRamRecordByte(at, original);
			}
		}
	}
}

void borrowedSliceSurvivesEmergencyAllocation() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::LuaHeap heap(cpu);
	bmsx::test::StringPoolReference pool(cpu);
	heap.setCollectionTarget(static_cast<u32>(heap.capacity()));
	std::string input(128u * 1024u, 'x');
	input.replace(4, 3, std::string("\xf7\0A", 3));
	const auto source = pool.intern(input);
	const std::string garbage(96u * 1024u, 'q');
	const u32 disposable = pool.intern(garbage);
	require(bmsx::HeapAllocator(cpu.memory()).setFloor(disposable & ~(HEAP_PAGE_SIZE - 1u)),
		"the large disposable String sits at the lowest occupied allocation");
	constexpr size_t start = 4, count = 92u * 1024u;
	require(heap.usedBytes() + BLUA32_STRING_RECORD_HEADER_SIZE + count > heap.capacity(),
		"the actual occupied quota requires an emergency collection for this slice");
	const auto result = bmsx::test::StringSliceReference::intern(pool, source, start, count);
	const std::string_view expected(input.data() + start, count);
	require(!pool.find(garbage) && pool.find(input) == source
		&& pool.toString(result) == expected && pool.find(expected) == result,
		"collection removes the disposable String but retains the source and its exact borrowed bytes");
}

void reclaimUnreachableRecords() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	const std::string suffix(512, 'x');
	size_t steadyBytes = 0;
	for (int round = 0; round < 8; ++round) {
		for (int index = 0; index < 128; ++index) pool.intern("garbage-" + std::to_string(round) + "-" + std::to_string(index) + "-" + suffix);
		bmsx::test::GcHeap(cpu).collect();
		if (round == 0) steadyBytes = bmsx::LuaHeap(cpu).usedBytes();
		require(bmsx::LuaHeap(cpu).usedBytes() == steadyBytes, "the heap returns to its steady bucket capacity");
		for (int index = 0; index < 128; ++index) require(!pool.find("garbage-" + std::to_string(round) + "-" + std::to_string(index) + "-" + suffix), "unreachable String leaves its bucket");
	}
}

void collectEmptyString() {
	PoolMachine machine;
	bmsx::test::StringPoolReference pool(machine.cpu);
	const auto empty = pool.intern("");
	require(pool.intern("") == empty && pool.byteLength(empty) == 0u, "empty bytes have a canonical live String record");
	bmsx::test::GcHeap(machine.cpu).collect();
	require(!pool.find(""), "a RAM record with no suffix is still collectible");
}

void resumeMajorStringBucket() {
	PoolMachine machine;
	bmsx::test::StringPoolReference pool(machine.cpu);
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
	bmsx::test::StringPoolReference pool(cpu);
	auto& memory = machine.memory;
	constexpr u32 capacity = 8192;
	auto roots = bmsx::test::allocateTableReference(cpu, capacity, 0);
	cpu.setGlobalByKey(pool.intern("String growth root"), valueTable(roots.address()));
	const u32 metadata = bmsx::HeapAllocator(cpu.memory()).managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(metadata + field); };
	const u32 count = capacity - read(8u);
	const auto name = [](u32 index) { return "fill:" + std::to_string(index); };
	for (u32 i = 0; i < count; ++i) roots.setInteger(i + 1u, valueString(pool.intern(name(i))));
	require(read(4u) == capacity && read(8u) == capacity, "the next distinct String needs a bucket growth");
	const auto advance = [&] { return bmsx::test::GcHeap(cpu).step(valueNil(), valueNil(), valueNil()); };
	for (int step = 0; bmsx::test::GcHeap(cpu).phase() != bmsx::test::GcPhase::Sweep && step < 40; ++step) advance();
	require(bmsx::test::GcHeap(cpu).phase() == bmsx::test::GcPhase::Sweep, "objects must be swept before String reclamation");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		bmsx::LuaHeap(cpu).setCollectionTarget(0);
		const auto added = pool.intern("growth crosses into Strings");
		require((read(4u) & 0x7fffffffu) == capacity && bmsx::test::GcHeap(cpu).phase() == bmsx::test::GcPhase::Strings
			&& read(0x38u) != 0u && read(0x3cu) > 0u,
			"unbilled rehash work advances before admitting the String and then yields to its sweep");
		for (int step = 0; bmsx::test::GcHeap(cpu).active() && step < 20; ++step) advance();
		require(!bmsx::test::GcHeap(cpu).active() && read(4u) == 2u * capacity && pool.find("growth crosses into Strings") == added,
			"later work completes the growth and retains the new String");
		for (u32 i = 0; i < count; ++i) require(pool.find(name(i)) == asStringId(roots.getInteger(i + 1u)), "each split retains its original interned addresses");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "rewind replays growth during String sweep");
}

void shrinkStringDirectoryInPlaceAcrossRewind() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	auto& memory = machine.memory;
	constexpr u32 capacity = 2u * HEAP_PAGE_SIZE / sizeof(u32), half = capacity / 2u;
	const u32 metadata = bmsx::HeapAllocator(cpu.memory()).managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(metadata + field); };
	for (u32 i = 0; read(4u) != capacity && i < capacity; ++i) pool.intern("shrink filler " + std::to_string(i));
	require(read(4u) == capacity, "a full-size String directory has already been published");
	const u32 base = read(0u);
	u32 candidate = 0;
	const auto collision = [&](u32 wanted) {
		for (;;) {
			auto text = "shrink collision " + std::to_string(candidate++);
			if ((fnv1a32(text) & (capacity - 1u)) == wanted) return text;
		}
	};
	const std::array names{collision(0u), collision(half), collision(half), collision(half), collision(0u), collision(half + 1u)};
	const std::array kept{pool.intern(names[0]), pool.intern(names[1]), pool.intern(names[2])};
	const auto mode = pool.intern("__mode");
	const u32 used = read(8u);
	pool.beginReachabilityEpoch();
	for (const auto id : kept) pool.markReachable(id);
	pool.markReachable(mode);
	pool.takeMarkWork();
	pool.beginSweep();
	require(pool.sweepStep(capacity + used) == capacity + used && read(8u) == kept.size() + 1u
		&& pool.sweeping() && read(0u) == base && read(4u) != capacity && read(0x38u) == 0u && read(0x3cu) == 0u,
		"sparse sweep schedules in-place shrink without a new directory or an unbudgeted move");
	require(pool.sweepStep(1) == 1u && read(0x3cu) == 0u
		&& memory.readRamRecordWord(base) == kept[2] && memory.readRamRecordWord(base + half * sizeof(u32)) == kept[1],
		"one quantum moves only one link and leaves both chains searchable");
	RamHistory archive;
	RamHistory::PageMap checkpoint, collected;
	archive.capture(memory, nullptr, checkpoint);
	const auto finish = [&] {
		for (u32 i = 0; i < kept.size(); ++i) require(pool.find(names[i]) == kept[i], "old and new buckets preserve identity");
		const std::array fresh{pool.intern(names[3]), pool.intern(names[4]), pool.intern(names[5])};
		require(memory.readRamRecordWord(base) == fresh[1]
			&& memory.readRamRecordWord(base + half * sizeof(u32)) == kept[1]
			&& memory.readRamRecordWord(base + (half + 1u) * sizeof(u32)) == fresh[2],
			"current-chain inserts go to the destination; untouched upper buckets still own their inserts");
		bmsx::HeapAllocator arena(cpu.memory());
		const auto occupied = arena.occupiedBytes();
		const auto oldChunk = arena.allocationBytes(base);
		const auto charged = bmsx::LuaHeap(cpu).usedBytes();
		for (u32 step = 0; pool.sweeping() && step < capacity; ++step)
			require(pool.sweepStep(1) == 1u, "drain and trim consume one unit at a time");
		const auto newChunk = arena.allocationBytes(base);
		require(!pool.sweeping() && read(4u) == half && read(0u) == base && newChunk < oldChunk
			&& occupied - arena.occupiedBytes() == oldChunk - newChunk && bmsx::LuaHeap(cpu).usedBytes() == charged,
			"the retained prefix keeps its address and only the uncharged suffix returns to the allocator");
		for (u32 i = 0; i < kept.size(); ++i)
			require(pool.find(names[i]) == kept[i] && pool.find(names[i + kept.size()]) == fresh[i],
				"all Strings share their original IDs after halving");
		pool.beginSweep();
		require(pool.sweepStep(capacity) == half + kept.size() + fresh.size() + 1u && !pool.sweeping(),
			"the next sweep touches half as many bucket heads");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	archive.capture(memory, &checkpoint, collected);
	archive.restore(memory, collected, checkpoint);
	require(finish() == expected, "rewind restores a partial merge, its links and allocator metadata byte-for-byte");
}

void stringDirectoryGrowthDoesNotForceCollection() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	bmsx::HeapAllocator arena(cpu.memory());
	constexpr u32 capacity = 2048u;
	const u32 metadata = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const auto read = [&](u32 field) { return machine.memory.readRamRecordWord(metadata + field); };
	std::string text(60, 'a');
	const auto original = pool.intern(text);
	const u32 remaining = capacity - read(8u);
	for (u32 i = 0; i < remaining; ++i) pool.intern("grow filler " + std::to_string(i));
	require(read(4u) == capacity && read(8u) == capacity, "another String crosses the directory growth threshold");
	const u32 base = read(0u);
	const u32 spare = arena.allocate(BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(text.size()), true);
	require(spare != 0u, "reserve space for the String record independently of its directory");
	while (arena.allocate(4088u, true) != 0u) {}
	arena.free(spare);
	require(arena.allocate(8u * capacity, true) == 0u, "the replacement directory cannot fit");

	// The String still fits its own chunk, not a replacement directory.
	text.back() = 'b';
	const auto inserted = pool.intern(text);
	require(read(0u) == base && read(4u) == capacity && read(8u) == capacity + 1u
		&& read(0x38u) == 0u && !bmsx::test::GcHeap(cpu).active(),
		"the optional index growth cannot force an emergency collection");
	require(pool.find(text) == inserted && pool.find(std::string(60, 'a')) == original
		&& pool.find("grow filler 0"), "the new String uses the pre-existing buckets without retiring their occupants");
}

void rehashCollisionAcrossSweepAndRewind() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	auto& memory = machine.memory;
	constexpr u32 capacity = 4096u;
	auto roots = bmsx::test::allocateTableReference(cpu, 4, 0);
	cpu.setGlobalByKey(pool.intern("collision rehash root"), valueTable(roots.address()));
	const u32 metadata = bmsx::HeapAllocator(cpu.memory()).managementOffset() + HEAP_STRING_METADATA_OFFSET;
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
	bmsx::LuaHeap budget(cpu);
	const auto logicalBefore = budget.usedBytes();
	const auto physicalBefore = bmsx::HeapAllocator(cpu.memory()).occupiedBytes();
	const auto inserted = pool.intern(trigger);
	const u32 insertedBytes = BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(trigger.size());
	const u32 nextBase = read(0x38u);
	require(nextBase != 0u && read(0x3cu) == 1u, "the intern yields inside the first long bucket, not after it");
	require(budget.usedBytes() == logicalBefore + insertedBytes
		&& bmsx::HeapAllocator(cpu.memory()).occupiedBytes() == physicalBefore + bmsx::HeapAllocator(cpu.memory()).allocationBytes(nextBase)
			+ bmsx::HeapAllocator(cpu.memory()).allocationBytes(inserted),
		"the new directory is physically reserved without adding to the String's nominal charge");
	const std::array survivors{memory.readRamRecordWord(oldBase), memory.readRamRecordWord(nextBase),
		memory.readRamRecordWord(nextBase + 4u * capacity), inserted};
	for (u32 index = 0; index < survivors.size(); ++index) {
		require(survivors[index] != 0u, "the old chain and both destination chains are populated");
		roots.setInteger(index + 1u, valueString(survivors[index]));
	}
	const auto retained = [&](StringId id) { return std::find(survivors.begin(), survivors.end(), id) != survivors.end(); };
	u32 logicalRelease = 0u, physicalRelease = bmsx::HeapAllocator(cpu.memory()).allocationBytes(oldBase);
	for (const auto& [text, id] : entries) {
		require(pool.find(text) == id, "lookups preserve IDs in each directory");
		if (!retained(id)) {
			const u32 bytes = BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(text.size());
			logicalRelease += bytes;
			physicalRelease += bmsx::HeapAllocator(cpu.memory()).allocationBytes(id);
		}
	}
	const auto usage = budget.usedBytes();
	const auto occupied = bmsx::HeapAllocator(cpu.memory()).occupiedBytes();
	RamHistory archive;
	RamHistory::PageMap checkpoint, collected;
	archive.capture(memory, nullptr, checkpoint);
	const auto state = cpu.captureRuntimeState();
	const auto advance = [&] { bmsx::test::GcHeap(cpu).step(valueNil(), valueNil(), valueNil()); };
	const auto finish = [&] {
		for (int step = 0; bmsx::test::GcHeap(cpu).phase() != bmsx::test::GcPhase::Strings && step < 40; ++step) advance();
		require(bmsx::test::GcHeap(cpu).phase() == bmsx::test::GcPhase::Strings && read(0x3cu) == 1u,
			"sweep visits both planes before moving any more links");
		for (int step = 0; bmsx::test::GcHeap(cpu).active() && step < 40; ++step) advance();
		require(!bmsx::test::GcHeap(cpu).active() && read(0u) == nextBase && read(4u) == 2u * capacity && read(0x38u) == 0u,
			"the old directory is no longer published when collection completes");
		require(pool.find(trigger) == inserted, "the inserted String survives its new chain's sweep");
		for (const auto& [text, id] : entries) {
			const auto found = pool.find(text);
			require(retained(id) ? found == id : !found, "both directories sweep exactly their unmarked Strings");
		}
		require(bmsx::LuaHeap(cpu).usedBytes() == usage - logicalRelease && bmsx::HeapAllocator(cpu.memory()).occupiedBytes() == occupied - physicalRelease,
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
	auto& cpu = machine.cpu; bmsx::test::StringPoolReference pool(cpu);
	bmsx::test::GcHeap(cpu).collect();
	const auto baseline = bmsx::LuaHeap(cpu).usedBytes();
	const u32 physical = bmsx::HeapAllocator(cpu.memory()).occupiedBytes();
	std::string text;
	for (int i = 0; i < 23; ++i) text += std::string("β😀A🚀\0é", 14);
	const auto old = pool.intern(text);
	const size_t bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.size();
	require(bmsx::LuaHeap(cpu).usedBytes() == baseline + bytes, "logical charge includes the record header and payload, not chunk overhead");
	require(bmsx::HeapAllocator(cpu.memory()).occupiedBytes() == physical + bmsx::HeapAllocator(cpu.memory()).allocationBytes(old), "physical diagnostics include the actual chunk");
	require(pool.byteAt(old, 128) == static_cast<u8>(text[128]), "long indexes address the exact byte");
	bmsx::test::GcHeap(cpu).collect();
	require(bmsx::LuaHeap(cpu).usedBytes() == baseline && bmsx::HeapAllocator(cpu.memory()).occupiedBytes() == physical,
		"GC releases both the logical charge and the physical record");
	text.clear(); for (int i = 0; i < 65; ++i) text += "😀";
	const auto id = pool.intern(text);
	require(pool.byteAt(id, 64) == 0xf0, "subsequent allocation publishes replacement bytes");
	bmsx::test::GcHeap(cpu).collect();
	require(pool.byteAt(pool.intern("ascii"), 4) == 'i', "short replacement publishes its own bytes");
}

void retainNestedMaterializationRoots() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	bmsx::test::GcHeap collector(cpu, &pool.localRoots());
	StringId outerId = 0;
	{
		pool.beginLocalRoots();
		outerId = pool.intern("outer string");
		{
			pool.beginLocalRoots();
			const auto innerId = pool.intern("inner string");
			collector.collect();
			require(pool.toString(outerId) == "outer string" && pool.toString(innerId) == "inner string", "nested scopes retain their own returned IDs");
			pool.endLocalRoots();
		}
		collector.collect();
		require(!pool.find("inner string") && pool.find("outer string") == outerId, "inner roots retire without releasing the outer phase");
		auto table = bmsx::test::allocateTableReference(cpu, 0, 0, &pool.localRoots());
		const auto key = pool.intern("nested key");
		table.setStringKey(key, valueInteger(7));
		collector.collect(valueTable(table.address()));
		require(table.getStringKey(key) == valueInteger(7), "the collector keeps explicit Values and scoped Strings");
		pool.endLocalRoots();
	}
	collector.collect();
	require(!pool.find("outer string") && !pool.find("nested key"), "CPU scope retirement releases string roots");
}

void replaySparseAllocationOrder() {
	PoolMachine machine;
	auto& cpu = machine.cpu;
	bmsx::test::StringPoolReference pool(cpu);
	bmsx::test::GcHeap collector(cpu, &pool.localRoots());
	pool.beginLocalRoots();
	pool.intern("left anchor");
	pool.beginLocalRoots();
	for (const auto text : {"hole one", "hole two", "hole three"}) pool.intern(text);
	pool.endLocalRoots();
	pool.intern("right anchor");
	collector.collect();
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
	bmsx::test::StringPoolReference pool(cpu);
	const auto root = pool.intern("table root");
	auto table = bmsx::test::allocateTableReference(cpu, 0, 8);
	cpu.setGlobalByKey(root, valueTable(table.address()));
	const auto removed = pool.intern("removed key");
	table.setStringKey(removed, valueInteger(19));
	table.setStringKey(removed, valueNil());
	const auto retained = pool.intern("retained key");
	table.setStringKey(retained, valueInteger(23));
	bmsx::test::GcHeap(cpu).collect();
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

void activatedImageRetainsItsRamConstantAcrossRestore() {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1}};
	image.constants = {std::string("system only")};
	const auto bios = test::encodeBlua32TestRom(RomImageDomain::System, image);
	constexpr std::string_view text = "RAM spelling of a cart constant";
	image.constants = {std::string(text), std::string("cart only"), i32{42}};
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions[0].wordCount = 2;
	const auto cart = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Memory memory(MemoryInit{bios.bytes, test::cartridgeSlots(cart.bytes)}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace space(memory);
	CPU cpu(memory, irq, space);
	test::seedManagedFixture(cpu, space);

	bmsx::test::StringPoolReference pool(cpu);
	const auto beforeCartCpu = cpu.captureRuntimeState();
	const auto beforeCartMemory = memory.captureSaveState();
	const StringId original = pool.intern(text);
	cpu.writeFrameExecution(0, 0, cart.functionAddresses[0], cart.textAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, bios.functionAddresses[0], bios.textAddress);
	bmsx::test::GcHeap(cpu).step(valueNil(), valueNil(), valueNil());
	const auto savedCpu = cpu.captureRuntimeState();
	const auto savedMemory = memory.captureSaveState();
	bmsx::test::GcHeap(cpu).collect();
	require(pool.find(text) == original, "an inactive resident image retains its original RAM String");

	// Activate the same mounted ROM with a different canonical RAM identity.
	// A restore must not reuse that String payload just because the literal
	// cache belongs to the same physical bytes.
	memory.restoreSaveState(beforeCartMemory);
	cpu.restoreRuntimeState(beforeCartCpu);
	pool.intern("allocate another String before the branch binds the cart literal");
	const StringId different = pool.intern(text);
	require(different != original, "the two branches bind different RAM records");
	cpu.writeFrameExecution(0, 0, cart.functionAddresses[0], cart.textAddress);
	require(cpu.activeThread()->currentFrame->executionImage->constPool.get(0) == valueString(different), "second activation binds its live String");

	memory.restoreSaveState(savedMemory);
	cpu.restoreRuntimeState(savedCpu);
	require(memory.captureSaveState().ram == savedMemory.ram, "restoring the image does not mark or intern its RAM String");
	cpu.writeFrameExecution(0, 0, cart.functionAddresses[0], cart.textAddress);
	cpu.runUntilDepth(0, 1);
	require(cpu.readFrameRegister(0, 0) == valueString(original), "LOADK uses the restored String binding and not the later activation");
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, bios.functionAddresses[0], bios.textAddress);
	cpu.rootThread()->currentFrame->registers.set(0, valueNil());
	bmsx::test::GcHeap(cpu).collect();
	require(pool.find(text) == original, "restored image retains the same RAM String through a fresh epoch");
}

test::Blua32TestImage externalCallImage() {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1},
		{.firstWord = 1, .wordCount = 1, .numParams = 1, .maxStack = 512, .staticClosure = false}};
	return image;
}

void admitExternalArgumentsAcrossStackGrowth(bool finalPending) {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, externalCallImage(), BLUA32_FUNCTION_RECORD_SIZE);
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		test::seedManagedFixture(cpu, addresses);
		memory.writeBytes(DYNAMIC_RAM_BASE, rom.bytes.data() + rom.functionAddresses[1] - SYSTEM_ROM_BASE, BLUA32_FUNCTION_RECORD_SIZE);
		const auto binding = test::seedTestMappedClosure(cpu, DYNAMIC_RAM_BASE, false);
		cpu.activeThread()->currentFrame->registers.set(0, valueClosure(binding));
		require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "the image returns its prebound dynamic callee");
		const auto completion = cpu.readCompletionValues();
		require(valueIsClosure(completion.get(0)), "call admission receives an actual guest closure");
		auto closure = bmsx::test::asClosure(completion.get(0), bmsx::test::GcHeap(cpu));
		const std::string text(4096, 'a');
		const auto id = bmsx::test::StringPoolReference(cpu).intern(text);
		const std::array args{valueString(id)};
		if (finalPending) {
			auto heap = bmsx::test::GcHeap(cpu);
			for (int step = 0; !heap.finalMarkPending() && step < 30; ++step) bmsx::test::GcHeap(cpu).step(valueNil(), valueNil(), valueNil());
			require(heap.finalMarkPending(), "a final pass is pending when the host can enter an explicit call");
		}
		bmsx::LuaHeap(cpu).setCollectionTarget(0);
		cpu.beginCompletionCall(closure, BuiltinArgsView(args.data(), args.size()));
		require((!finalPending || !bmsx::test::GcHeap(cpu).finalMarkPending()) && bmsx::test::StringPoolReference(cpu).find(text) == id,
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
		internComparesAllCandidateBytes();
		borrowedSliceSurvivesEmergencyAllocation();
		reclaimUnreachableRecords();
		collectEmptyString();
		resumeMajorStringBucket();
		stringAdmissionStartsSweepDuringUnchargedRehash();
		shrinkStringDirectoryInPlaceAcrossRewind();
		stringDirectoryGrowthDoesNotForceCollection();
		rehashCollisionAcrossSweepAndRewind();
		reclaimLongByteStrings();
		retainNestedMaterializationRoots();
		replaySparseAllocationOrder();
		reuseDeletedStringKeyId();
		activatedImageRetainsItsRamConstantAcrossRestore();
		admitExternalArgumentsAcrossStackGrowth(false);
		admitExternalArgumentsAcrossStackGrowth(true);
		std::cout << "String pool lifetime tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
