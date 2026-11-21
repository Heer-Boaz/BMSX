#pragma once

#include <optional>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/table.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

struct ValueLength {
	i32 count;
	int extraCycles;
};

// Measure LEN without changing a slot or the execution grant. An invalid
// operand has no result; dispatch owns the language fault and its guest PC.
inline std::optional<ValueLength> measureValueLength(Value operand, const StringPool& strings, GcHeap* heap) noexcept {
	switch (valueTag(operand)) {
	case ValueTag::String:
		return ValueLength{strings.byteLength(asStringId(operand)), 0};
	case ValueTag::Table: {
		u32 probes;
		const TableRecord table(*heap, valuePayload(operand));
		const i32 count = TableRecord::length(&table, &probes);
		return ValueLength{count, static_cast<int>(probes) * TABLE_LENGTH_PROBE_CYCLES};
	}
	default:
		return std::nullopt;
	}
}

} // namespace bmsx
