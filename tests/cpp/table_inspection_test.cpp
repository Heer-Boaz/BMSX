#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <iostream>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void inspectStoredSlots(bmsx::CPU& cpu) {
	auto* table = cpu.createTable(8, 16);
	auto* child = cpu.createTable();
	const auto removed = bmsx::valueString(cpu.stringPool().intern("removed"));
	table->setInteger(1, bmsx::valueNumber(-0.0));
	table->setInteger(8, bmsx::valueBool(false));
	table->set(bmsx::valueTable(child), bmsx::valueTable(child));
	table->setStringKey(cpu.stringPool().intern("number"), bmsx::valueNumber(std::numeric_limits<double>::quiet_NaN()));
	table->set(bmsx::valueBool(false), bmsx::valueNumber(std::numeric_limits<double>::infinity()));
	table->set(removed, bmsx::valueNumber(17));
	table->set(removed, bmsx::valueNil());
	const auto before = table->trackedHeapBytes();
	std::vector<std::pair<bmsx::Value, bmsx::Value>> physical;
	for (size_t slot = 0; slot < table->storedSlotCount(); ++slot) {
		bmsx::Value key = bmsx::valueNil(), value = bmsx::valueNil();
		if (table->loadStoredEntry(slot, key, value)) physical.emplace_back(key, value);
	}
	std::vector<std::pair<bmsx::Value, bmsx::Value>> logical;
	bmsx::Value key = bmsx::valueNil(), value = bmsx::valueNil();
	while (table->nextEntry(key, key, value)) logical.emplace_back(key, value);
	require(physical == logical, "inspection preserves iteration order and raw value bits");
	require(physical.size() == 5, "empty array slots and dead hash nodes are not entries");
	require(table->trackedHeapBytes() == before, "inspection does not allocate guest storage");
	const auto last = std::pair{key, value};
	require(!table->loadStoredEntry(1, key, value), "a vacant slot returns false");
	require(std::pair{key, value} == last, "a vacant slot leaves the borrowed output untouched");

	auto* sparse = cpu.createTable(65536, 0);
	sparse->setInteger(65536, bmsx::valueNumber(42));
	for (size_t slot = 0; slot < 1024; ++slot) {
		require(!sparse->loadStoredEntry(slot, key, value), "single-slot inspection does not scan ahead");
	}
	require(sparse->loadStoredEntry(sparse->storedSlotCount() - 1, key, value), "the last occupied slot can be read directly");
	require(bmsx::asNumber(key) == 65536 && bmsx::asNumber(value) == 42, "physical inspection preserves the Lua array key");
}

} // namespace

int main() {
	try {
		bmsx::Memory memory(bmsx::MemoryInit{}, bmsx::PSX_MACHINE_SPEC.ramBytes);
		bmsx::IrqController irq(memory);
		bmsx::ExecutionAddressSpace addresses(memory);
		bmsx::CPU cpu(memory, irq, addresses);
		inspectStoredSlots(cpu);
		std::cout << "Table inspection tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
