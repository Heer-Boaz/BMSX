#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;

constexpr size_t KeyCount = 16;
constexpr size_t TableCount = 32;
// An odd count does not cancel repeated high-word-only Value contributions.
constexpr size_t Iterations = 250003;
enum class Mode { Hit, Miss, Cached, Polymorphic, Inherited, Update };

struct Fixture {
	Memory memory{MemoryInit{}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
	std::array<StringId, KeyCount> keys{}, missing{};
	std::array<Table*, TableCount> tables{};
	std::array<int, KeyCount> slots{};
	Table* inherited = nullptr;
	StringId indexKey;

	Fixture() {
		size_t count = 0;
		for (size_t n = 0; count < KeyCount * 2; ++n) {
			const auto key = cpu.stringPool().intern("field_" + std::to_string(n));
			if ((cpu.gcHeap().hash(valueString(key)) & 63u) != 0u) continue;
			(count < KeyCount ? keys[count] : missing[count - KeyCount]) = key;
			++count;
		}
		for (size_t t = 0; t < TableCount; ++t) {
			auto* table = cpu.createTable(0, 64);
			tables[t] = table;
			for (size_t i = 0; i < KeyCount; ++i) {
				const size_t k = (i + t) & (KeyCount - 1);
				table->setStringKey(keys[k], valueInteger(k + 1));
			}
		}
		indexKey = cpu.stringPool().intern("__index");
		inherited = tables[0];
		for (int depth = 0; depth < 4; ++depth) {
			auto* metatable = cpu.createTable(0, 1);
			metatable->setStringKey(indexKey, valueTable(cpu.gcHeap().reference(inherited)));
			auto* child = cpu.createTable();
			child->setMetatable(metatable);
			inherited = child;
		}
		for (size_t i = 0; i < KeyCount; ++i) {
			slots[i] = -1;
			const Value expected = valueInteger(i + 1);
			if (tables[0]->getStringKeyCached(keys[i], slots[i]) != expected
				|| !isNil(tables[0]->getStringKey(missing[i]))) {
				throw std::runtime_error("Table benchmark must start with the expected collision chains.");
			}
			TableLookupResult value;
			inherited->resolveStringIndex(indexKey, keys[i], value);
			if (value.status != TableLookupStatus::Resolved || value.value != expected) {
				throw std::runtime_error("Table benchmark must resolve the inherited fields.");
			}
		}
	}
};

template <Mode mode>
void measure(Fixture& fixture, const char* name, int round) {
	fixture.slots.fill(-1);
	for (size_t k = 0; k < KeyCount; ++k) {
		fixture.tables[0]->setStringKey(fixture.keys[k], valueInteger(k + 1));
		fixture.tables[0]->getStringKeyCached(fixture.keys[k], fixture.slots[k]);
	}
	u64 checksum = 0;
	const auto start = std::chrono::steady_clock::now();
	for (size_t i = 0; i < Iterations; ++i) {
		const size_t k = (i >> 5u) & (KeyCount - 1u);
		u64 result;
		if constexpr (mode == Mode::Hit) {
			result = fixture.tables[0]->getStringKey(fixture.keys[k]);
		} else if constexpr (mode == Mode::Miss) {
			result = fixture.tables[0]->getStringKey(fixture.missing[k]);
		} else if constexpr (mode == Mode::Cached) {
			result = fixture.tables[0]->getStringKeyCached(fixture.keys[k], fixture.slots[k]);
		} else if constexpr (mode == Mode::Polymorphic) {
			result = fixture.tables[i & (TableCount - 1u)]->getStringKeyCached(fixture.keys[k], fixture.slots[k]);
		} else if constexpr (mode == Mode::Inherited) {
			TableLookupResult value;
			fixture.inherited->resolveStringIndex(fixture.indexKey, fixture.keys[k], value);
			result = value.value;
		} else {
			result = fixture.tables[0]->setStringKey(fixture.keys[k], valueInteger(i & 127u));
		}
		checksum = (checksum << 5u) + checksum + result + i;
	}
	const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count();
	u64 expected = 0;
	for (size_t i = 0; i < Iterations; ++i) {
		const size_t k = (i >> 5u) & (KeyCount - 1u);
		const u64 result = mode == Mode::Miss ? valueNil()
			: mode == Mode::Update ? static_cast<u64>(fixture.slots[k]) : valueInteger(k + 1u);
		expected = (expected << 5u) + expected + result + i;
	}
	if (checksum != expected) throw std::runtime_error("Every measured table operation must contribute its expected result.");
	std::cout << "[table-lookup] workload=" << name << " round=" << round
		<< " operations=" << Iterations << " wall_ms=" << static_cast<double>(ns) / 1000000.0
		<< " ns_per_op=" << static_cast<double>(ns) / Iterations << " checksum=" << checksum << '\n';
}
}

int main() {
	std::cout << std::fixed << std::setprecision(3);
	Fixture fixture;
	for (int round = 0; round < 3; ++round) {
		measure<Mode::Hit>(fixture, "string-hit", round);
		measure<Mode::Miss>(fixture, "string-miss", round);
		measure<Mode::Cached>(fixture, "cached-hit", round);
		measure<Mode::Polymorphic>(fixture, "polymorphic", round);
		measure<Mode::Inherited>(fixture, "inherited", round);
		measure<Mode::Update>(fixture, "string-update", round);
	}
}
