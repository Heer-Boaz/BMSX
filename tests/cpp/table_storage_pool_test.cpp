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

void hashBudgetIgnoresPhysicalRebuild(bmsx::CPU& cpu) {
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
		"tombstones can rebuild a physical hash below the unchanged logical reservation");
	require(cpu.luaHeap().usedBytes() == used && tombstones.arrayCapacity() == spare.arrayCapacity(),
		"different bucket counts leave the same membership charge and array range");
	for (auto key : {keys[0], keys[1], collision})
		require(tombstones.getInteger(key) == spare.getInteger(key), "both physical layouts retain the same mappings");
	tombstones.clear(); spare.clear();

	const auto logical = cpu.luaHeap().usedBytes();
	auto table = cpu.createTable(0, 3);
	const u32 backing = table.storageAddress();
	for (size_t i = 0; i < 4; ++i) table.setInteger(keys[i], valueInteger(29));
	require(table.hashSlots() == 4u && table.storageAddress() == backing && cpu.luaHeap().usedBytes() == logical + 32u + 40u,
		"only the fourth mapping exceeds the prepaid three mappings, inside the same physical hash");
	table.setInteger(keys[0], valueNil());
	require(cpu.luaHeap().usedBytes() == logical + 32u + 30u, "removal returns the charge above the floor");
	table.clear();
}

void hashWatermarkSurvivesDeletionAndRestore(bmsx::CPU& cpu) {
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
				&& table.getInteger(1) == valueInteger(29), "refill below the saved watermark reuses its home and keeps the array range");
			table.setInteger(1, valueNil());
			require(cpu.luaHeap().usedBytes() == used, "each refill and removal returns to the same nominal charge");
		}
	}
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
		hashBudgetIgnoresPhysicalRebuild(cpu);
		hashWatermarkSurvivesDeletionAndRestore(cpu);
		const auto key = cpu.stringPool().intern("retired");
		const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
		const u32 physicalBefore = cpu.heapAllocator().occupiedBytes();
		auto first = cpu.createTable(3, 4);

		const u32 bodyAddress = first.storageAddress();
		first.setInteger(3, valueInteger(99));
		require(memory.readRamRecordWord(bodyAddress + 2 * 4u) == 99u, "array payload lives in guest RAM");
		memory.writeRamRecordWord(bodyAddress + 2 * 4u, 11u);
		require(first.getInteger(3) == valueInteger(11), "table reads consume the physical bytes");
		require(cpu.heapAllocator().occupiedBytes() == physicalBefore + 112u, "the header and body are separate physical allocations");
		first.setStringKey(key, valueBool(false));
		first.clear();
		require(cpu.luaHeap().usedBytes() == before.first + 32,
			"cleared tables retain only the table header charge");
		// Different exact capacities can share one guest size class.
		auto second = cpu.createTable(2, 4);
		require(second.trackedHeapBytes() == 112u && second.storageAddress() == bodyAddress, "the freed guest size class is reused");
		for (int index = 1; index <= 2; ++index)
			require(isNil(second.getInteger(index)), "reused array slots are initialized to nil");
		require(isNil(second.getStringKey(key)), "reused hash storage does not retain old keys or values");
		second.setStringKey(key, valueInteger(73));
		for (int index = 1; index <= 300; ++index) second.setInteger(index, valueInteger(index));
		for (int index = 1; index <= 300; ++index)
			require(second.getInteger(index) == valueInteger(index), "growth across the page allocation boundary preserves entries");
		require(second.getStringKey(key) == valueInteger(73), "mixed array/hash growth preserves the hash entry");
		second.clear();
		first.clear();
		require(cpu.luaHeap().usedBytes() == before.first + 64,
			"empty tables keep only their canonical headers, and release both bodies");
		require(cpu.heapAllocator().occupiedBytes() == physicalBefore + 64u, "only the two physical headers remain");
		require(cpu.luaHeap().collectionTarget() == before.second,
			"recycling does not reschedule guest collection");
		std::cout << "Table guest storage tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
