#pragma once

#include "machine/cpu/value_slots.h"
#include <span>

namespace bmsx::test {
// Populate the real slot planes from scalar fixture values. The reference
// evaluator keeps its independent complete-Value array for differential checks.
inline ValueSlots valueBank(std::span<const Value> seed) {
	ValueSlots slots(seed.size());
	for (size_t i = 0; i < seed.size(); ++i) slots.set(i, seed[i]);
	return slots;
}
inline bool matchesValues(ConstValueSpan slots, std::span<const Value> reference) {
	if (slots.size() != reference.size()) return false;
	for (size_t i = 0; i < reference.size(); ++i) if (slots.get(i) != reference[i]) return false;
	return true;
}
}
