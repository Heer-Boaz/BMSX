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

void refillArrayHashPrefix(bmsx::CPU& cpu) {
	for (int route = 0; route < 4; ++route) {
		auto* table = cpu.createTable(4, 8);
		for (int key = 1; key <= 7; ++key) {
			table->set(bmsx::valueNumber(key), bmsx::valueNumber(key * 10));
		}
		const auto heapBytes = table->trackedHeapBytes();
		require(table->length() == 7, "the numeric prefix includes values beyond array capacity");

		for (const int key : {2, 4}) {
			switch (route) {
				case 0: table->set(bmsx::valueNumber(key), bmsx::valueNil()); break;
				case 1: require(table->setNumberArrayKey(key, bmsx::valueNil()), "numeric fast deletion reaches an array slot"); break;
				case 2: table->setInteger(key, bmsx::valueNil()); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueNil()), "integer fast deletion reaches an array slot"); break;
			}
			require(table->length() == key - 1, "deletion shortens the prefix at the hole");
			require(bmsx::asNumber(table->getInteger(7)) == 70, "deletion preserves the mapped hash tail");

			switch (route) {
				case 0: table->set(bmsx::valueNumber(key), bmsx::valueBool(false)); break;
				case 1: require(table->setNumberArrayKey(key, bmsx::valueBool(false)), "numeric fast refill reaches an array slot"); break;
				case 2: table->setInteger(key, bmsx::valueBool(false)); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueBool(false)), "integer fast refill reaches an array slot"); break;
			}
			require(table->length() == 7, "all setters refill through the array/hash boundary");
			require(table->getInteger(key) == bmsx::valueBool(false), "false is present in the prefix");
			require(table->trackedHeapBytes() == heapBytes, "refilling an existing array slot does not allocate storage");
		}

		table->setInteger(9, bmsx::valueNumber(90));
		require(table->length() == 7, "a later key does not bridge a missing numeric key");
		table->setInteger(8, bmsx::valueNumber(80));
		require(table->length() == 9, "filling a hash hole extends the same prefix");
	}
}

} // namespace

int main() {
	try {
		bmsx::Memory memory(bmsx::MemoryInit{}, bmsx::PSX_MACHINE_SPEC.ramBytes);
		bmsx::IrqController irq(memory);
		bmsx::ExecutionAddressSpace addresses(memory);
		bmsx::CPU cpu(memory, irq, addresses);
		inspectStoredSlots(cpu);
		refillArrayHashPrefix(cpu);
		std::cout << "Table inspection tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
