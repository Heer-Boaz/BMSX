#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <array>
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
	table->setInteger(1, bmsx::valueFloatBits(0x80000000u));
	table->setInteger(8, bmsx::valueBool(false));
	table->set(bmsx::valueTable(cpu.gcHeap().reference(child)), bmsx::valueTable(cpu.gcHeap().reference(child)));
	table->setStringKey(cpu.stringPool().intern("number"), bmsx::valueFloatBits(0xffc01234u));
	table->set(bmsx::valueBool(false), bmsx::valueFloatBits(0x7f800000u));
	table->set(removed, bmsx::valueInteger(17));
	table->set(removed, bmsx::valueNil());
	const auto before = table->trackedHeapBytes();
	std::vector<std::pair<bmsx::Value, bmsx::Value>> physical;
	for (size_t slot = 0; slot < table->storedSlotCount(); ++slot) {
		bmsx::Value key = bmsx::valueNil(), value = bmsx::valueNil();
		if (table->loadStoredEntry(slot, key, value)) physical.emplace_back(key, value);
	}
	std::vector<std::pair<bmsx::Value, bmsx::Value>> logical;
	bmsx::Value key = bmsx::valueNil(), value = bmsx::valueNil();
	for (table->nextEntry(key, key, value); !bmsx::isNil(key); table->nextEntry(key, key, value)) logical.emplace_back(key, value);
	require(physical == logical, "inspection preserves iteration order and raw value bits");
	require(physical.size() == 5, "empty array slots and dead hash nodes are not entries");
	require(table->trackedHeapBytes() == before, "inspection does not allocate guest storage");
	const auto last = std::pair{key, value};
	require(!table->loadStoredEntry(1, key, value), "a vacant slot returns false");
	require(std::pair{key, value} == last, "a vacant slot leaves the borrowed output untouched");

	auto* sparse = cpu.createTable(65536, 0);
	sparse->setInteger(65536, bmsx::valueInteger(42));
	for (size_t slot = 0; slot < 1024; ++slot) {
		require(!sparse->loadStoredEntry(slot, key, value), "single-slot inspection does not scan ahead");
	}
	require(sparse->loadStoredEntry(sparse->storedSlotCount() - 1, key, value), "the last occupied slot can be read directly");
	require(key == bmsx::valueInteger(65536) && value == bmsx::valueInteger(42), "physical inspection preserves the Lua array key");
}

void refillArrayHashPrefix(bmsx::CPU& cpu) {
	for (int route = 0; route < 4; ++route) {
		auto* table = cpu.createTable(4, 8);
		for (int key = 1; key <= 7; ++key) {
			table->set(bmsx::valueInteger(key), bmsx::valueInteger(key * 10));
		}
		const auto heapBytes = table->trackedHeapBytes();
		require(bmsx::Table::length(table) == 7, "the numeric prefix includes values beyond array capacity");

		for (const int key : {2, 4}) {
			switch (route) {
				case 0: table->set(bmsx::valueInteger(key), bmsx::valueNil()); break;
				case 1: table->set(bmsx::valueFloat(static_cast<float>(key)), bmsx::valueNil()); break;
				case 2: table->setInteger(key, bmsx::valueNil()); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueNil()), "integer fast deletion reaches an array slot"); break;
			}
			const auto boundary = bmsx::Table::length(table);
			require((boundary == 0 || !bmsx::isNil(table->get(bmsx::valueInteger(boundary))))
				&& bmsx::isNil(table->get(bmsx::valueInteger(boundary + 1))), "a hole permits any valid boundary");
			require(table->getInteger(7) == bmsx::valueInteger(70), "deletion preserves the mapped hash tail");

			switch (route) {
				case 0: table->set(bmsx::valueInteger(key), bmsx::valueBool(false)); break;
				case 1: table->set(bmsx::valueFloat(static_cast<float>(key)), bmsx::valueBool(false)); break;
				case 2: table->setInteger(key, bmsx::valueBool(false)); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueBool(false)), "integer fast refill reaches an array slot"); break;
			}
			require(bmsx::Table::length(table) == 7, "all setters refill through the array/hash boundary");
			require(table->getInteger(key) == bmsx::valueBool(false), "false is present in the prefix");
			require(table->trackedHeapBytes() == heapBytes, "refilling an existing array slot does not allocate storage");
		}

		table->setInteger(9, bmsx::valueInteger(90));
		require(bmsx::Table::length(table) == 7, "a later key does not bridge a missing numeric key");
		table->setInteger(8, bmsx::valueInteger(80));
		require(bmsx::Table::length(table) == 9, "filling a hash hole extends the same prefix");
	}
}

void boundarySearchAndHashMix(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto* table = cpu.createTable(4096, 8);
	for (int key = 4096; key >= 1; --key) table->setInteger(key, valueBool(false));
	require(table->lengthHint() == 1, "descending writes do not scan the retained suffix");
	require(Table::length(table) == 4096, "pure search finds the unique sequence boundary");
	for (int repeat = 0; repeat < 8; ++repeat) {
		table->setInteger(2048, valueNil()); table->setInteger(2048, valueBool(false));
	}
	require(table->lengthHint() == 1, "reads and distant hole refills retain the raw hint");
	table->clearWeakEntries(false, true, [](Value) { return false; });
	require(Table::length(table) == 0, "a stale nonzero hint is only a search seed");
	require(table->lengthHint() == 1, "weak clearing need not rebuild the hint");

	auto* sparse = cpu.createTable(0, 128);
	for (int bit = 30; bit >= 0; --bit) sparse->setInteger(1 << bit, valueBool(false));
	require(Table::length(sparse) == (1 << 30), "sparse Integer keys extend the hash boundary");
	sparse->setInteger(INT32_MAX, valueBool(false));
	sparse->set(valueFloat(2147483648.0f), valueBool(true));
	require(Table::length(sparse) == INT32_MAX, "a larger Float key cannot extend the terminal Integer boundary");
	sparse->setInteger(INT32_MAX, valueNil());
	require(Table::length(sparse) == (1 << 30), "terminal deletion finds another valid boundary");

	std::array<unsigned, 1024> occupancy{};
	for (int key = -1; key >= -1024; --key) ++occupancy[scalarValueHash(valueInteger(key)) & 1023];
	require(*std::max_element(occupancy.begin(), occupancy.end()) <= 8, "negative Integer keys do not pile up in one hash bucket");

	// These physical buckets are also exercised by the TypeScript table fixture.
	for (const auto& [key, bucket] : std::array<std::pair<Value, size_t>, 10>{{
		{valueInteger(-1), 0}, {valueInteger(-2), 607}, {valueInteger(-3), 190}, {valueInteger(-1024), 140},
		{valueInteger(0), 0}, {valueFloat(0.5f), 224}, {valueFloat(1.5f), 0}, {valueFloat(4294967296.0f), 24},
		{valueFloatBits(0xffa01234u), 981}, {valueFloatBits(0x7f800000u), 0}}}) {
		require((scalarValueHash(key) & 1023) == bucket, "numeric hash matches compact TS golden buckets");
	}
	require(scalarValueHash(valueFloatBits(0x80000000u)) == scalarValueHash(valueInteger(0)), "signed zeros share a hash");
	require(scalarValueHash(valueFloatBits(0xffc00001u)) == scalarValueHash(valueFloatBits(0x7fc0002au)), "all raw NaNs share a hash");
}

void continueAfterDeletedZeroIdentityKey(bmsx::CPU& cpu) {
	auto* object = cpu.createTable();
	object->hashId = 0;
	const auto objectKey = bmsx::valueTable(cpu.gcHeap().reference(object));
	auto* table = cpu.createTable(0, 64);
	table->set(objectKey, bmsx::valueInteger(9));
	table->set(bmsx::valueBool(true), bmsx::valueInteger(13));
	bmsx::Value key = bmsx::valueNil(), value = bmsx::valueNil();
	table->nextEntry(objectKey, key, value);
	require(!bmsx::isNil(key), "the zero-identity key has a live successor");
	const auto successor = std::pair{key, value};
	table->set(objectKey, bmsx::valueNil());
	table->nextEntry(objectKey, key, value);
	require(!bmsx::isNil(key), "a deleted zero-identity key remains a continuation");
	require(std::pair{key, value} == successor, "deletion preserves the zero-identity key's successor");
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
		boundarySearchAndHashMix(cpu);
		continueAfterDeletedZeroIdentityKey(cpu);
		std::cout << "Table inspection tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
