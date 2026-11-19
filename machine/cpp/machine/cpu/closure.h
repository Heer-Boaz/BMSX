#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

class Memory;
// A function-record sample used by CLOSURE and function entry.
struct FunctionPrototype {
	u32 functionAddress = 0;
	u32 codeAddress = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	u32 flags = 0;
	u32 upvalueTableAddress = 0;
	u32 recordUpvalueCount = 0;
	i32 executionDomainId = 0;
	bool operator==(const FunctionPrototype&) const = default;
};

inline constexpr u32 CLOSURE_BINDING_FLAGS = 2;
inline constexpr u32 CLOSURE_BINDING_DOMAIN_MASK = 3;
inline constexpr u32 CLOSURE_CANONICAL = 4;
inline constexpr u32 CLOSURE_LATCHED_PROTOTYPE = 8;
inline constexpr u32 CLOSURE_COUNT_HIGH_BYTE = 3;
inline constexpr u32 CLOSURE_COUNT_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
inline constexpr u32 CLOSURE_PROTOTYPE_ADDRESS = 8;
inline constexpr u32 CLOSURE_CAPTURE_WORDS = 12;
inline constexpr u32 CLOSURE_LATCHED_PROTOTYPE_BYTES = 6 * sizeof(u32);
inline constexpr u32 closureRecordBytes(u32 captures, bool latched = false) {
	return CLOSURE_CAPTURE_WORDS + sizeof(u32) * captures + (latched ? CLOSURE_LATCHED_PROTOTYPE_BYTES : 0u);
}

namespace ClosureRecord {
void initialize(Memory&, u32 address, const FunctionPrototype&, u8 white, u32 count, bool canonical, bool latched);
FunctionPrototype readBinding(const Memory&, u32 address);
u32 captureCount(const Memory&, u32 address);
constexpr u32 captureWordAddress(u32 address, u32 index) {
	return address + CLOSURE_CAPTURE_WORDS + index * sizeof(u32);
}
u32 captureAddress(const Memory&, u32 address, u32 index);
void setCaptureAddress(Memory&, u32 address, u32 index, u32 reference);
}
} // namespace bmsx
