#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

class Memory;
class GcHeap;
// Decoded data shared by closures for the same published function record.
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

struct FunctionPrototypeHash {
	size_t operator()(const FunctionPrototype& prototype) const {
		return prototype.functionAddress ^ (static_cast<u32>(prototype.executionDomainId) << 16);
	}
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

struct Closure : GCObject {
	Closure(Memory& memory, u32 address, const FunctionPrototype& prototype, bool canonical)
		: memory(memory), address(address), prototype(&prototype), canonical(canonical) {}
	Memory& memory;
	const u32 address;
	const FunctionPrototype* prototype;
	const bool canonical;
	void initializeRecord(u8 white, u32 count, bool latched = false);
	bool hasLatchedPrototype() const;
	static FunctionPrototype readBinding(const Memory& memory, u32 address, u8 flags);
	static u32 captureCount(const Memory&, u32 address);
	u32 upvalueCount() const { return captureCount(memory, address); }
	static constexpr u32 captureWordAddress(u32 address, u32 index) {
		return address + CLOSURE_CAPTURE_WORDS + index * sizeof(u32);
	}
	u32 captureAddress(u32 index) const;
	void setCaptureAddress(u32 index, u32 reference);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativePrototypeOffset();
#endif
};
} // namespace bmsx
