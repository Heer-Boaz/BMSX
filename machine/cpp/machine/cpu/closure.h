#pragma once

#include <algorithm>
#include <cstddef>

#include "common/endian.h"
#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

class Memory;
struct Blua32RomFunctionDirectory;
// The entry portion of a function record. Activation does not consume the
// upvalue descriptors used to construct and identify the closure.
struct FunctionEntry {
	u32 codeAddress, numParams, maxStack, flags;

	constexpr u32 registerCapacity() const { return std::max({1u, numParams, maxStack}); }

	static FunctionEntry fromRom(const u8* bytes) {
		return {
			readLE32(bytes + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET),
			readLE32(bytes + BLUA32_FUNCTION_NUM_PARAMS_OFFSET),
			readLE32(bytes + BLUA32_FUNCTION_MAX_STACK_OFFSET),
			readLE32(bytes + BLUA32_FUNCTION_FLAGS_OFFSET),
		};
	}
	bool operator==(const FunctionEntry&) const = default;
};

struct FunctionCallEntry {
	u32 functionAddress;
	FunctionEntry entry;
};

// A complete function-record sample at the closure's binding.
struct FunctionPrototype {
	u32 functionAddress = 0;
	FunctionEntry entry{};
	u32 upvalueTableAddress = 0;
	u32 recordUpvalueCount = 0;
	i32 executionDomainId = 0;
	bool operator==(const FunctionPrototype&) const = default;
};

inline constexpr u32 CLOSURE_BINDING_FLAGS = 2;
inline constexpr u32 CLOSURE_BINDING_DOMAIN_MASK = 3;
inline constexpr u32 CLOSURE_LATCHED_PROTOTYPE = 8;
inline constexpr u32 CLOSURE_COUNT_HIGH_BYTE = 3;
inline constexpr u32 CLOSURE_COUNT_WORD = 4;
inline constexpr u32 CLOSURE_COUNT_SHIFT = 19;
inline constexpr u32 CLOSURE_COUNT_LOW_BITS = 32 - CLOSURE_COUNT_SHIFT;
inline constexpr u32 CLOSURE_PROTOTYPE_ADDRESS = 8;
inline constexpr u32 CLOSURE_CAPTURE_WORDS = 12;
inline constexpr u32 CLOSURE_LATCHED_PROTOTYPE_BYTES = 6 * sizeof(u32);
inline constexpr u32 closureRecordBytes(u32 captures, bool latched = false) {
	return CLOSURE_CAPTURE_WORDS + sizeof(u32) * captures + (latched ? CLOSURE_LATCHED_PROTOTYPE_BYTES : 0u);
}

namespace ClosureRecord {
constexpr u32 domainBits(ExecutionDomainId domain) {
	return static_cast<u32>(domain + 1);
}

constexpr u32 fixedCallHeaderMask = 0xffu
	| ((CLOSURE_BINDING_DOMAIN_MASK | CLOSURE_LATCHED_PROTOTYPE) << (8u * CLOSURE_BINDING_FLAGS));
constexpr u32 fixedCallHeader(ExecutionDomainId domain) {
	return static_cast<u32>(ValueTag::Closure) | (domainBits(domain) << (8u * CLOSURE_BINDING_FLAGS));
}

struct BindingFlags {
	u8 bits;
	constexpr ExecutionDomainId domain() const {
		const u32 bank = bits & CLOSURE_BINDING_DOMAIN_MASK;
		return bank >= 2u ? 1 : static_cast<ExecutionDomainId>(bank) - 1;
	}
	constexpr bool latched() const { return (bits & CLOSURE_LATCHED_PROTOTYPE) != 0u; }
};
u32 recordAddress(const Memory&, u32 payload);
FunctionPrototype readBinding(const Memory&, u32 address, BindingFlags, const Blua32RomFunctionDirectory&);
FunctionEntry readLatchedEntry(const Memory&, u32 address);
u32 captureCount(const Memory&, u32 address);
constexpr u32 captureWordAddress(u32 address, u32 index) {
	return address + CLOSURE_CAPTURE_WORDS + index * sizeof(u32);
}
u32 captureAddress(const Memory&, u32 address, u32 index);
}
} // namespace bmsx
