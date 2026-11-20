#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>

#include "common/endian.h"
#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/image_format.h"
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
	// The memory port has admitted a complete record. Address and domain
	// belong to the caller's binding, not to these six record words.
	void readRecordWords(const u8* bytes) {
		codeAddress = readLE32(bytes + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		numParams = readLE32(bytes + BLUA32_FUNCTION_NUM_PARAMS_OFFSET);
		maxStack = readLE32(bytes + BLUA32_FUNCTION_MAX_STACK_OFFSET);
		flags = readLE32(bytes + BLUA32_FUNCTION_FLAGS_OFFSET);
		upvalueTableAddress = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET);
		recordUpvalueCount = readLE32(bytes + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
	}
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
