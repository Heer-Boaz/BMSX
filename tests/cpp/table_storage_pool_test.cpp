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
	const auto before = tombstones.storageAddress();
	tombstones.setInteger(collision, valueInteger(23));
	spare.setInteger(collision, valueInteger(23));
	require(tombstones.storageAddress() != before && tombstones.hashSlots() == 4u && spare.hashSlots() == 16u,
		"a tombstone rebuild chooses a smaller hash reservation");
	require(cpu.luaHeap().usedBytes() == used - 12u * 10u && tombstones.arrayCapacity() == spare.arrayCapacity(),
		"rebuild releases the discarded slots but keeps the array range");
	for (auto key : {keys[0], keys[1], collision})
		require(tombstones.getInteger(key) == spare.getInteger(key), "both physical layouts retain the same mappings");
	tombstones.clear(); spare.clear();

	const auto logical = cpu.luaHeap().usedBytes();
	auto table = cpu.createTable(0, 3);
	const u32 backing = table.storageAddress();
	for (size_t i = 0; i < 4; ++i) table.setInteger(keys[i], valueInteger(29));
	require(table.hashSlots() == 4u && table.storageAddress() == backing && cpu.luaHeap().usedBytes() == logical + 32u + 40u,
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
	const u32 backing = table.storageAddress();
	const auto home = hashCanonicalTableKey(valueInteger(1)) & (keys.size() - 1u);
	table.setInteger(keys[home], valueNil());
	table.setInteger(keys[(home + 1u) & (keys.size() - 1u)], valueNil());
	const auto used = cpu.luaHeap().usedBytes();
	const auto saved = cpu.memory().captureSaveState();
	for (bool replay : {false, true}) {
		if (replay) cpu.memory().restoreSaveState(saved);
		for (int step = 0; step < 16; ++step) {
			table.setInteger(1, valueInteger(29));
			require(table.storageAddress() == backing && table.arrayCapacity() == 0 && table.hashSlots() == 4
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
	const u32 smallBody = table.storageAddress();
	table.setInteger(7, tail);
	require(table.arrayCapacity() == 8 && table.storageAddress() != smallBody,
		"the dense tail grows and relocates the array");
	require(table.getInteger(1) == valueBool(false) && isNil(table.getInteger(2))
		&& table.getInteger(3) == prefix && table.getInteger(4) == valueBool(true)
		&& table.getInteger(5) == valueInteger(50) && table.getInteger(6) == valueInteger(60)
		&& table.getInteger(7) == tail && isNil(table.getInteger(8))
		&& table.getInteger(-1) == valueInteger(11) && table.getInteger(-3) == valueInteger(33),
		"growth preserves the sparse raw prefix and reclassifies the former hash tail");
	const u32 largeBody = table.storageAddress();
	table.setInteger(5, valueNil());
	table.setInteger(6, valueNil());
	table.setInteger(16, valueInteger(22));
	require(table.arrayCapacity() == 4 && table.storageAddress() != largeBody,
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
		hashBudgetFollowsReservedSlots(cpu);
		reservedHashSurvivesDeletionAndRestore(cpu);
		mixedArrayMigrationPreservesRawValues(cpu);
		const auto key = cpu.stringPool().intern("retired");
		const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
		const auto& arena = cpu.heapAllocator();
		const u32 physicalBefore = arena.occupiedBytes();
		auto first = cpu.createTable(3, 4);

		const u32 bodyAddress = first.storageAddress();
		const u32 firstHeader = arena.allocationBytes(first.address() - GC_OBJECT_PREFIX);
		first.setInteger(3, valueInteger(99));
		require(memory.readRamRecordWord(bodyAddress + 2 * 4u) == 99u, "array payload lives in guest RAM");
		memory.writeRamRecordWord(bodyAddress + 2 * 4u, 11u);
		require(first.getInteger(3) == valueInteger(11), "table reads consume the physical bytes");
		require(arena.occupiedBytes() == physicalBefore + firstHeader + arena.allocationBytes(bodyAddress),
			"the header and body are separate physical allocations");
		first.setStringKey(key, valueBool(false));
		first.clear();
		require(cpu.luaHeap().usedBytes() == before.first + 32,
			"cleared tables retain only the table header charge");
		require(arena.occupiedBytes() == physicalBefore + firstHeader, "clearing retires the first body");
		auto second = cpu.createTable(2, 4);
		const u32 secondHeader = arena.allocationBytes(second.address() - GC_OBJECT_PREFIX);
		require(second.trackedHeapBytes() == secondHeader + arena.allocationBytes(second.storageAddress()),
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
