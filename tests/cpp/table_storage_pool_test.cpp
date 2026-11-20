#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <iostream>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

int main() {
	using namespace bmsx;
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
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
		auto second = cpu.createTable(4, 4);
		require(second.trackedHeapBytes() == 112u && second.storageAddress() == bodyAddress, "the freed guest size class is reused");
		for (int index = 1; index <= 4; ++index)
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
