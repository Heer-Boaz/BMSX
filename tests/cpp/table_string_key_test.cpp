#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void collisionAndMutationParity(CPU& cpu) {
	std::array<StringId, 16> keys{};
	size_t count = 0;
	for (size_t n = 0; count < keys.size(); ++n) {
		const auto key = cpu.stringPool().intern("collision_" + std::to_string(n));
		if ((ValueHash{}(valueString(key)) & 31u) == 0u) keys[count++] = key;
	}
	auto* generic = cpu.createTable(0, 4);
	auto* strings = cpu.createTable(0, 4);
	auto* object = cpu.createTable();
	object->hashId = 0u;
	const std::array<Value, 8> values {
		valueBool(false), valueNumber(-0.0), valueNumber(5.25),
		valueNumber(std::numeric_limits<double>::quiet_NaN()),
		valueNumber(std::numeric_limits<double>::infinity()),
		valueTable(object), valueString(keys[0]), valueNil()
	};
	int prediction = 0;
	auto compare = [&]() {
		const auto bytes = strings->trackedHeapBytes();
		for (const auto key : keys) {
			const Value expected = generic->get(valueString(key));
			require(strings->getStringKey(key) == expected, "known string search matches general value search");
			require(strings->getStringKeyCached(key, prediction) == expected, "stale slot predictions cannot change lookup");
		}
		require(strings->trackedHeapBytes() == bytes, "lookups allocate no guest storage");
		// Physical iteration order is serialized state, not an incidental layout.
		require(strings->storedSlotCount() == generic->storedSlotCount(), "lookup specialization preserves table storage");
		for (size_t slot = 0; slot < generic->storedSlotCount(); ++slot) {
			Value ak, av, bk, bv;
			const bool a = generic->loadStoredEntry(slot, ak, av);
			const bool b = strings->loadStoredEntry(slot, bk, bv);
			require(a == b && (!a || (ak == bk && av == bv)), "mutations preserve raw values and physical iteration order");
		}
	};
	compare();
	for (const auto key : {valueNumber(0), valueBool(false), valueTable(object)}) {
		generic->set(key, valueNumber(19));
		strings->set(key, valueNumber(19));
	}
	for (size_t n = 0; n < 256; ++n) {
		const auto key = keys[(n * 7u) & 15u];
		const Value value = values[(n >> 4u) & 7u];
		generic->set(valueString(key), value);
		if ((n & 1u) == 0u) {
			const auto before = strings->trackedHeapBytes();
			const int slot = Table::storeStringKeyWithoutGrowth(strings, key, value);
			require(strings->trackedHeapBytes() == before, "bounded mutation reserves no storage");
			if (slot == TABLE_STORE_REQUIRES_GROWTH) strings->setStringKey(key, value);
		} else strings->setStringKeyCached(key, value, prediction);
		if ((n & 15u) == 0u) {
			generic->setInteger(static_cast<int>(n / 16u) + 1, valueNumber(n));
			strings->setInteger(static_cast<int>(n / 16u) + 1, valueNumber(n));
		}
		compare();
	}
	// A dead collectable key shares the string chain's zero hash bucket.
	generic->set(valueTable(object), valueNil());
	strings->set(valueTable(object), valueNil());
	compare();
	generic->clear();
	strings->clear();
	compare();
}

void rejectedGrowthRetainsExhaustedCursor(CPU& cpu) {
	auto* table = cpu.createTable(0, 1);
	const auto present = cpu.stringPool().intern("full"), missing = cpu.stringPool().intern("new");
	table->setStringKey(present, valueNumber(73));
	CpuSnapshot before, after;
	const auto beforeOffset = table->captureSnapshot(before, [](u32, Value) {});
	require(Table::storeStringKeyWithoutGrowth(table, missing, valueNumber(19)) == TABLE_STORE_REQUIRES_GROWTH,
		"a full hash requires allocating completion");
	const auto afterOffset = table->captureSnapshot(after, [](u32, Value) {});
	require(before.word(beforeOffset + SNAP_TABLE_HASH_FREE) == 0u,
		"a direct main-bucket insertion has not searched the only free-slot candidate");
	require(after.word(afterOffset + SNAP_TABLE_HASH_FREE) == 0xffffffffu,
		"rejected growth retains an exhausted cursor for the allocating completion");
	require(table->getStringKey(present) == valueNumber(73) && isNil(table->getStringKey(missing)),
		"rejected growth leaves the original mappings intact");
	require(Table::storeStringKeyWithoutGrowth(table, missing, valueNumber(19)) == TABLE_STORE_REQUIRES_GROWTH,
		"repeated capacity failure remains a request for allocating completion");
	table->setStringKey(present, valueNil());
	require(Table::storeStringKeyWithoutGrowth(table, missing, valueNumber(19)) == 0,
		"an exhausted free cursor still permits reuse of a deleted main bucket");
	require(table->storedSlotCount() == 1u && table->getStringKey(missing) == valueNumber(19),
		"deleted main-bucket reuse does not rebuild storage");
}

void inheritedAndMaskedPayloads(CPU& cpu) {
	const auto key = cpu.stringPool().intern("field");
	const auto indexKey = cpu.stringPool().intern("__index");
	auto* parent = cpu.createTable(0, 2);
	parent->setStringKey(key, valueBool(false));
	auto* metatable = cpu.createTable(0, 1);
	metatable->setStringKey(indexKey, valueTable(parent));
	auto* child = cpu.createTable();
	child->metatable = metatable;
	TableLookupResult result;
	child->resolveStringIndex(indexKey, key, result);
	require(result.status == TableLookupStatus::Resolved && result.value == valueBool(false), "inherited false is present");
	child->resolveStringIndexCached(indexKey, key, -1, result);
	require(result.slot >= 0 && result.value == valueBool(false) && result.extraVisits == 1, "inherited cached search returns the same value and semantic work");
	parent->setStringKey(key, valueNil());
	child->resolveStringIndexCached(indexKey, key, result.slot, result);
	require(result.slot == -1 && isNil(result.value), "deletion invalidates inherited predictions");
	parent->setStringKey(key, valueNumber(-0.0));
	child->resolveStringIndex(indexKey, key, result);
	require(result.status == TableLookupStatus::Resolved && result.value == valueNumber(-0.0), "reinsertion preserves negative zero");

	auto* raw = cpu.createTable(0, 8);
	const Value noncanonical = valueFromTag(ValueTag::String, static_cast<u64>(key) | (1ULL << 40u));
	raw->set(noncanonical, valueNumber(21));
	require(isNil(raw->getStringKey(key)), "a known StringId does not match extra payload bits during chain search");
	raw->setStringKey(key, valueNumber(42));
	require(raw->get(noncanonical) == valueNumber(21) && raw->getStringKey(key) == valueNumber(42), "known string updates preserve distinct raw payloads");
}
}

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		collisionAndMutationParity(cpu);
		inheritedAndMaskedPayloads(cpu);
	rejectedGrowthRetainsExhaustedCursor(cpu);
		std::cout << "String-key table tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
