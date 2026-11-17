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
		const auto before = cpu.luaHeap().captureState();
		auto* first = cpu.createTable(3, 4);
		first->setInteger(3, valueInteger(99));
		first->setStringKey(key, valueBool(false));
		first->clear();
		require(cpu.luaHeap().usedBytes() == before.trackedBytes + 32,
			"retained host blocks do not remain occupied in the guest heap");
		// Different exact capacities share one rounded host allocation class.
		auto* second = cpu.createTable(4, 4);
		require(second->trackedHeapBytes() == 108, "host size classes do not round guest capacities");
		for (int index = 1; index <= 4; ++index)
			require(isNil(second->getInteger(index)), "reused array slots are initialized to nil");
		require(isNil(second->getStringKey(key)), "reused hash storage does not retain old keys or values");
		second->setStringKey(key, valueInteger(73));
		for (int index = 1; index <= 300; ++index) second->setInteger(index, valueInteger(index));
		for (int index = 1; index <= 300; ++index)
			require(second->getInteger(index) == valueInteger(index), "growth across the pooling cutoff preserves entries");
		require(second->getStringKey(key) == valueInteger(73), "mixed array/hash growth preserves the hash entry");
		const auto beforeRestore = cpu.luaHeap().usedBytes() - second->trackedHeapBytes();
		second->prepareRestoreStorage(5, 2);
		require(second->trackedHeapBytes() == 85 && cpu.luaHeap().usedBytes() == beforeRestore + 85,
			"restore preparation retains exact non-power-of-two capacities and occupied bytes");
		for (int index = 1; index <= 5; ++index)
			require(isNil(second->getInteger(index)), "replacement storage starts fresh after shrinking");
		require(isNil(second->getStringKey(key)), "replacement hash links and keys start fresh");
		second->clear();
		first->clear();
		require(cpu.luaHeap().usedBytes() == before.trackedBytes + 64,
			"empty tables keep only their canonical headers, independent of host cache residency");
		require(cpu.luaHeap().captureState().nextCollectionBytes == before.nextCollectionBytes,
			"host recycling neither invokes nor reschedules guest collection");
		std::cout << "Table storage pool tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
