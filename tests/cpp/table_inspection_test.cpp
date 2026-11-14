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
	for (table->nextEntry(key, key, value); !bmsx::isNil(key); table->nextEntry(key, key, value)) logical.emplace_back(key, value);
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
		require(bmsx::Table::length(table) == 7, "the numeric prefix includes values beyond array capacity");

		for (const int key : {2, 4}) {
			switch (route) {
				case 0: table->set(bmsx::valueNumber(key), bmsx::valueNil()); break;
				case 1: require(table->setNumberArrayKey(key, bmsx::valueNil()), "numeric fast deletion reaches an array slot"); break;
				case 2: table->setInteger(key, bmsx::valueNil()); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueNil()), "integer fast deletion reaches an array slot"); break;
			}
			const double boundary = bmsx::Table::length(table);
			require((boundary == 0 || !bmsx::isNil(table->get(bmsx::valueNumber(boundary))))
				&& bmsx::isNil(table->get(bmsx::valueNumber(boundary + 1))), "a hole permits any valid boundary");
			require(bmsx::asNumber(table->getInteger(7)) == 70, "deletion preserves the mapped hash tail");

			switch (route) {
				case 0: table->set(bmsx::valueNumber(key), bmsx::valueBool(false)); break;
				case 1: require(table->setNumberArrayKey(key, bmsx::valueBool(false)), "numeric fast refill reaches an array slot"); break;
				case 2: table->setInteger(key, bmsx::valueBool(false)); break;
				case 3: require(table->setIntegerArrayKey(key, bmsx::valueBool(false)), "integer fast refill reaches an array slot"); break;
			}
			require(bmsx::Table::length(table) == 7, "all setters refill through the array/hash boundary");
			require(table->getInteger(key) == bmsx::valueBool(false), "false is present in the prefix");
			require(table->trackedHeapBytes() == heapBytes, "refilling an existing array slot does not allocate storage");
		}

		table->setInteger(9, bmsx::valueNumber(90));
		require(bmsx::Table::length(table) == 7, "a later key does not bridge a missing numeric key");
		table->setInteger(8, bmsx::valueNumber(80));
		require(bmsx::Table::length(table) == 9, "filling a hash hole extends the same prefix");
	}
}

void boundarySearchAndHashMix(bmsx::CPU& cpu) {
	using namespace bmsx;
	auto* table = cpu.createTable(4096, 8);
	for (int key = 4096; key >= 1; --key) table->setInteger(key, valueBool(false));
	CpuSnapshot before;
	const u32 offset = table->captureSnapshot(before, [](u32, Value) {});
	require(before.word(offset + SNAP_TABLE_LENGTH_HINT) == 1, "descending writes do not scan the retained suffix");
	require(Table::length(table) == 4096, "pure search finds the unique sequence boundary");
	for (int repeat = 0; repeat < 8; ++repeat) {
		table->setInteger(2048, valueNil()); table->setInteger(2048, valueBool(false));
	}
	CpuSnapshot after;
	table->captureSnapshot(after, [](u32, Value) {});
	require(std::equal(before.words().begin(), before.words().end(), after.words().begin()), "reads and distant hole refills retain the raw hint");
	table->clearWeakEntries(false, true, [](Value) { return false; });
	require(Table::length(table) == 0, "a stale nonzero hint is only a search seed");
	CpuSnapshot cleared;
	table->captureSnapshot(cleared, [](u32, Value) {});
	require(cleared.word(offset + SNAP_TABLE_LENGTH_HINT) == 1, "weak clearing need not rebuild the hint");

	auto* sparse = cpu.createTable(0, 128);
	for (int bit = 52; bit >= 0; --bit) sparse->set(valueNumber(static_cast<double>(uint64_t{1} << bit)), valueBool(false));
	require(Table::length(sparse) == 4503599627370496.0, "hash boundaries can exceed array index range");
	sparse->set(valueNumber(9007199254740991.0), valueBool(false));
	sparse->set(valueNumber(9007199254740992.0), valueBool(true));
	require(Table::length(sparse) == 9007199254740991.0, "terminal exact integer boundary never wraps");
	sparse->set(valueNumber(9007199254740991.0), valueNil());
	require(Table::length(sparse) == 4503599627370496.0, "terminal deletion finds another valid boundary");

	std::array<bool, 1024> buckets{};
	for (int key = -1; key >= -1024; --key) buckets[ValueHash{}(valueNumber(key)) & 1023] = true;
	require(std::count(buckets.begin(), buckets.end(), true) >= 700, "negative integers do not collapse into one hash bucket");
	for (const auto [key, bucket] : std::array<std::pair<double, size_t>, 10>{{
		{-1, 781}, {-2, 1}, {-3, 891}, {-1024, 661}, {0, 0}, {0.5, 537}, {1.5, 903}, {4294967296.0, 909},
		{std::numeric_limits<double>::quiet_NaN(), 903}, {std::numeric_limits<double>::infinity(), 781}}}) {
		require((ValueHash{}(valueNumber(key)) & 1023) == bucket, "numeric hash matches the TS golden buckets");
	}
	require(ValueHash{}(valueNumber(-0.0)) == ValueHash{}(valueNumber(0.0)), "signed zeros share a hash");
	require(ValueHash{}(VALUE_QNAN_MASK | 1) == ValueHash{}(VALUE_QNAN_MASK | 42), "raw numeric NaN payloads share a hash");
}

void continueAfterDeletedZeroIdentityKey(bmsx::CPU& cpu) {
	auto* object = cpu.createTable();
	object->hashId = 0;
	const auto objectKey = bmsx::valueTable(object);
	auto* table = cpu.createTable(0, 64);
	table->set(objectKey, bmsx::valueNumber(9));
	table->set(bmsx::valueBool(true), bmsx::valueNumber(13));
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
