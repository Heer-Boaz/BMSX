#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void denseArrayRetainsBacking(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto table = cpu.createTable(1, 0);
	const u32 storage = table.arrayAddress();
	table.setInteger(1, valueBool(false));
	table.setInteger(2, valueInteger(0x12345678));
	require(table.arrayAddress() == storage, "two array slots fit the original backing");
	table.setInteger(3, valueBool(true));
	require(table.getInteger(1) == valueBool(false) && table.getInteger(2) == valueInteger(0x12345678)
		&& table.getInteger(3) == valueBool(true) && isNil(table.getInteger(4)), "grow preserves and initializes typed slots");
	table.clear();
}

void mixedGrowthKeepsUnchangedStorage(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto table = cpu.createTable(1, 1);
	table.setInteger(1, valueBool(false));
	table.setInteger(-1, valueInteger(41));
	const u32 hash = table.hashAddress();
	table.setInteger(2, valueInteger(42));
	require(table.arrayCapacity() == 2 && table.hashAddress() == hash && table.getInteger(-1) == valueInteger(41),
		"growing the array leaves the unchanged bucket layout in place");
	const u32 array = table.arrayAddress();
	table.setInteger(-2, valueBool(true));
	require(table.hashSlots() == 2 && table.hashAddress() != hash && table.arrayAddress() == array
		&& table.getInteger(1) == valueBool(false) && table.getInteger(2) == valueInteger(42),
		"rebuilding the hash leaves typed array storage in place");
	table.clear();
}

void firstIntegerPlacement(bmsx::CPU& cpu) {
	using namespace bmsx;
	for (int key : {1, 2, 2147483647}) {
		auto table = cpu.createTable();
		table.setInteger(key, valueBool(false));
		require(table.arrayCapacity() == (key == 1 ? 1u : 0u) && table.hashSlots() == (key == 1 ? 0u : 1u)
			&& table.getInteger(key) == valueBool(false), "only index one starts an array by itself");
	}
}

void partialArrayDensity(bmsx::CPU& cpu) {
	using namespace bmsx;
	for (int added : {16, 17}) {
		auto table = cpu.createTable(13, 0);
		for (int key : {1, 2, 3, 4, 5, 9, 10, 13}) table.setInteger(key, valueBool(false));
		table.setInteger(added, valueInteger(41));
		require(table.arrayCapacity() == (added == 16 ? 16u : 8u) && table.hashSlots() == (added == 16 ? 0u : 4u),
			"nine of sixteen select the array; exactly eight do not");
		for (int key : {1, 2, 3, 4, 5, 9, 10, 13}) require(table.getInteger(key) == valueBool(false),
			"repartitioning preserves each false entry of the partial band");
		require(table.getInteger(added) == valueInteger(41), "the triggering key remains reachable");
	}
}

void fullByteChainsWidenOnRehash(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto source = cpu.createTable(0, 128);
	for (i32 key = 1; key <= 128; ++key) source.setInteger(-key, valueInteger(key));
	auto copy = source.copyOwn();
	copy.setInteger(-129, valueBool(true));
	require(source.hashSlots() == 128 && copy.hashSlots() == 256, "growth crosses the signed byte index boundary");
	for (i32 key = 1; key <= 128; ++key)
		require(source.getInteger(-key) == valueInteger(key) && copy.getInteger(-key) == valueInteger(key),
			"widened collision chains retain every mapping");
	require(isNil(source.getInteger(-129)) && copy.getInteger(-129) == valueBool(true), "growth leaves the source alone");
	source.clear();
	copy.clear();
}

void tableSlotWritesMarkBothHistoryPages(bmsx::CPU& cpu) {
	using namespace bmsx;
	constexpr u32 capacity = MAPPED_PAGE_BYTE_SIZE / sizeof(u32);
	auto table = cpu.createTable(capacity, 0);
	table.setInteger(1, valueInteger(7));
	const u32 word = table.arrayAddress() & RAM_RECORD_WORD_MASK;
	const u32 wordPage = word >> MAPPED_PAGE_BYTE_SHIFT;
	const u32 tagPage = (word + capacity * sizeof(u32)) >> MAPPED_PAGE_BYTE_SHIFT;
	auto& watches = cpu.memory().ramWriteWatches();
	watches.armHistoryWrites();
	table.setInteger(1, valueBool(false));
	require(watches.historyPageDirty(wordPage, wordPage + 1) && watches.historyPageDirty(tagPage, tagPage + 1),
		"changing a table value dirties the separate payload and tag pages for rewind");
	watches.disarmHistoryWrites();
	table.clear();
}

void rebuildingHashMarksAllDestinationPages(bmsx::CPU& cpu) {
	using namespace bmsx;
	constexpr i32 capacity = 1024;
	auto table = cpu.createTable(capacity * 4, capacity);
	const u32 array = table.arrayAddress();
	const u32 middlePage = ((array & RAM_RECORD_WORD_MASK) + 2 * MAPPED_PAGE_BYTE_SIZE) >> MAPPED_PAGE_BYTE_SHIFT;
	for (i32 i = 1; i <= capacity; ++i) table.setInteger(-i, valueInteger(i));
	const u32 oldStorage = table.hashAddress();
	auto& watches = cpu.memory().ramWriteWatches();
	watches.armHistoryWrites();
	table.setInteger(-capacity - 1, valueBool(false));
	require(table.hashAddress() != oldStorage && table.hashSlots() > capacity, "the insertion replaces the full hash");
	require(table.arrayAddress() == array && !watches.historyPageDirty(middlePage, middlePage + 1),
		"rehashing does not write the retained array payload");
	const u32 begin = table.hashAddress() & RAM_RECORD_WORD_MASK;
	const u32 end = begin + TableRecord::storageBytes(0, table.hashSlots());
	for (u32 page = begin >> MAPPED_PAGE_BYTE_SHIFT; page <= (end - 1u) >> MAPPED_PAGE_BYTE_SHIFT; ++page)
		require(watches.historyPageDirty(page, page + 1), "rebuilding marks the full destination for rewind");
	watches.disarmHistoryWrites();
	for (i32 i = 1; i <= capacity; ++i)
		require(table.getInteger(-i) == valueInteger(i), "reinserted hash entries remain reachable through collisions");
	require(table.getInteger(-capacity - 1) == valueBool(false), "the triggering assignment remains present");
	table.clear();
}

void hashBudgetFollowsReservedSlots(bmsx::CPU& cpu) {
	using namespace bmsx;
	std::array<i32, 16> keys{};
	u32 assigned = 0u;
	i32 collision = 0;
	for (i32 id = -1; assigned != keys.size() || collision == 0; --id) {
		const auto home = hashCanonicalTableKey(valueInteger(id)) & (keys.size() - 1u);
		if (keys[home] == 0u) { keys[home] = id; ++assigned; }
		else if (home == 0u) collision = id;
	}
	auto spare = cpu.createTable(0, 16), tombstones = cpu.createTable(0, 16);
	for (auto key : keys) tombstones.setInteger(key, valueInteger(17));
	for (size_t i = 2; i < keys.size(); ++i) tombstones.setInteger(keys[i], valueNil());
	for (size_t i = 0; i < 2; ++i) spare.setInteger(keys[i], valueInteger(17));
	const auto used = cpu.luaHeap().usedBytes();
	const auto before = tombstones.hashAddress();
	tombstones.setInteger(collision, valueInteger(23));
	spare.setInteger(collision, valueInteger(23));
	require(tombstones.hashAddress() != before && tombstones.hashSlots() == 4u && spare.hashSlots() == 16u,
		"a tombstone rebuild chooses a smaller hash reservation");
	require(cpu.luaHeap().usedBytes() == used - 12u * 10u && tombstones.arrayCapacity() == spare.arrayCapacity(),
		"rebuild releases the discarded slots but keeps the array range");
	for (auto key : {keys[0], keys[1], collision})
		require(tombstones.getInteger(key) == spare.getInteger(key), "both physical layouts retain the same mappings");
	tombstones.clear(); spare.clear();

	const auto logical = cpu.luaHeap().usedBytes();
	auto table = cpu.createTable(0, 3);
	const u32 backing = table.hashAddress();
	for (size_t i = 0; i < 4; ++i) table.setInteger(keys[i], valueInteger(29));
	require(table.hashSlots() == 4u && table.hashAddress() == backing && cpu.luaHeap().usedBytes() == logical + 32u + 40u,
		"a three-slot request reserves and pays for all four slots");
	table.setInteger(keys[0], valueNil());
	require(cpu.luaHeap().usedBytes() == logical + 32u + 40u, "removal does not release reserved storage");
	table.clear();
}

void reservedHashSurvivesDeletionAndRestore(bmsx::CPU& cpu) {
	using namespace bmsx;
	std::array<i32, 4> keys{};
	u32 assigned = 0u;
	for (i32 id = -1; assigned != keys.size(); --id) {
		const auto home = hashCanonicalTableKey(valueInteger(id)) & (keys.size() - 1u);
		if (keys[home] == 0) { keys[home] = id; ++assigned; }
	}
	auto table = cpu.createTable();
	for (auto key : keys) table.setInteger(key, valueInteger(13));
	const u32 backing = table.hashAddress();
	const auto home = hashCanonicalTableKey(valueInteger(1)) & (keys.size() - 1u);
	table.setInteger(keys[home], valueNil());
	table.setInteger(keys[(home + 1u) & (keys.size() - 1u)], valueNil());
	const auto used = cpu.luaHeap().usedBytes();
	const auto saved = cpu.memory().captureSaveState();
	for (bool replay : {false, true}) {
		if (replay) cpu.memory().restoreSaveState(saved);
		for (int step = 0; step < 16; ++step) {
			table.setInteger(1, valueInteger(29));
			require(table.hashAddress() == backing && table.arrayCapacity() == 0 && table.hashSlots() == 4
				&& table.getInteger(1) == valueInteger(29), "refill reuses its home and keeps the array range");
			table.setInteger(1, valueNil());
			require(cpu.luaHeap().usedBytes() == used, "inserts and deletes in existing slots leave the charge unchanged");
		}
	}
	table.clear();
}

void mixedArrayMigrationPreservesRawValues(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto table = cpu.createTable(4, 0);
	const Value prefix = valueFloatBits(0x7fc12345u), tail = valueFloatBits(0xffc23456u);
	table.setInteger(1, valueBool(false));
	table.setInteger(3, prefix);
	table.setInteger(4, valueBool(true));
	// These negative keys share their home in both the two- and four-node hash.
	table.setInteger(-1, valueInteger(11));
	table.setInteger(-3, valueInteger(33));
	table.setInteger(5, valueInteger(50));
	table.setInteger(6, valueInteger(60));
	require(table.arrayCapacity() == 4, "entries 5 and 6 start in the hash");
	const u32 smallBody = table.hashAddress();
	table.setInteger(7, tail);
	require(table.arrayCapacity() == 8 && table.hashAddress() != smallBody,
		"the dense tail grows and relocates the array");
	require(table.getInteger(1) == valueBool(false) && isNil(table.getInteger(2))
		&& table.getInteger(3) == prefix && table.getInteger(4) == valueBool(true)
		&& table.getInteger(5) == valueInteger(50) && table.getInteger(6) == valueInteger(60)
		&& table.getInteger(7) == tail && isNil(table.getInteger(8))
		&& table.getInteger(-1) == valueInteger(11) && table.getInteger(-3) == valueInteger(33),
		"growth preserves the sparse raw prefix and reclassifies the former hash tail");
	const u32 largeBody = table.hashAddress();
	table.setInteger(5, valueNil());
	table.setInteger(6, valueNil());
	table.setInteger(16, valueInteger(22));
	require(table.arrayCapacity() == 4 && table.hashAddress() != largeBody,
		"repartition shrinks and relocates the sparse array");
	require(table.getInteger(1) == valueBool(false) && isNil(table.getInteger(2))
		&& table.getInteger(3) == prefix && table.getInteger(4) == valueBool(true)
		&& isNil(table.getInteger(5)) && isNil(table.getInteger(6)) && table.getInteger(7) == tail
		&& table.getInteger(-1) == valueInteger(11) && table.getInteger(-3) == valueInteger(33)
		&& table.getInteger(16) == valueInteger(22),
		"shrink preserves the sparse raw prefix and reinserts overflow without losing colliding keys");
	table.clear();
}
}

int main() {
	using namespace bmsx;
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		denseArrayRetainsBacking(cpu);
		fullByteChainsWidenOnRehash(cpu);
		mixedGrowthKeepsUnchangedStorage(cpu);
		firstIntegerPlacement(cpu);
		partialArrayDensity(cpu);
		tableSlotWritesMarkBothHistoryPages(cpu);
		rebuildingHashMarksAllDestinationPages(cpu);
		hashBudgetFollowsReservedSlots(cpu);
		reservedHashSurvivesDeletionAndRestore(cpu);
		mixedArrayMigrationPreservesRawValues(cpu);
		const auto key = cpu.stringPool().intern("retired");
		const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
		const auto& arena = cpu.heapAllocator();
		const u32 physicalBefore = arena.occupiedBytes();
		auto first = cpu.createTable(3, 4);

		const u32 bodyAddress = first.arrayAddress();
		const u32 firstHeader = arena.allocationBytes(first.address() - GC_OBJECT_PREFIX);
		first.setInteger(3, valueInteger(99));
		require(memory.readRamRecordWord(bodyAddress + 2 * 4u) == 99u, "array payload lives in guest RAM");
		memory.writeRamRecordWord(bodyAddress + 2 * 4u, 11u);
		require(first.getInteger(3) == valueInteger(11), "table reads consume the physical bytes");
		require(arena.occupiedBytes() == physicalBefore + firstHeader + arena.allocationBytes(bodyAddress) + arena.allocationBytes(first.hashAddress()),
			"the header and body are separate physical allocations");
		first.setStringKey(key, valueBool(false));
		first.clear();
		require(cpu.luaHeap().usedBytes() == before.first + 32,
			"cleared tables retain only the table header charge");
		require(arena.occupiedBytes() == physicalBefore + firstHeader, "clearing retires the first body");
		auto second = cpu.createTable(2, 4);
		const u32 secondHeader = arena.allocationBytes(second.address() - GC_OBJECT_PREFIX);
		require(second.trackedHeapBytes() == secondHeader + arena.allocationBytes(second.hashAddress()) + arena.allocationBytes(second.arrayAddress()),
			"physical accounting uses the newly owned chunks");
		for (int index = 1; index <= 2; ++index)
			require(isNil(second.getInteger(index)), "new array slots are initialized to nil");
		require(isNil(second.getStringKey(key)), "new hash storage does not expose retired keys or values");
		second.setStringKey(key, valueInteger(73));
		for (int index = 1; index <= 300; ++index) second.setInteger(index, valueInteger(index));
		for (int index = 1; index <= 300; ++index)
			require(second.getInteger(index) == valueInteger(index), "repeated backing growth preserves entries");
		require(second.getStringKey(key) == valueInteger(73), "mixed array/hash growth preserves the hash entry");
		second.clear();
		first.clear();
		require(cpu.luaHeap().usedBytes() == before.first + 64,
			"empty tables keep only their canonical headers, and release both bodies");
		require(arena.occupiedBytes() == physicalBefore + firstHeader + secondHeader, "only the two physical headers remain");
		require(cpu.luaHeap().collectionTarget() == before.second,
			"recycling does not reschedule guest collection");
		std::cout << "Table guest storage tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
