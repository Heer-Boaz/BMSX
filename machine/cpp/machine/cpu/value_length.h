#pragma once

#include <optional>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/table.h"
#include "machine/cpu/value.h"

namespace bmsx {

// Dispatch owns metamethods and the fault for a non-String/non-Table.
inline std::optional<i32> measureValueLength(Value operand, const StringPool& strings, GcHeap* heap) noexcept {
	switch (valueTag(operand)) {
	case ValueTag::String:
		return strings.byteLength(asStringId(operand));
	case ValueTag::Table: {
		TableRecord table(*heap, valuePayload(operand));
		return TableRecord::length(&table);
	}
	default:
		return std::nullopt;
	}
}

} // namespace bmsx
