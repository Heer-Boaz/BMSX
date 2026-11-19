#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct CallFrame;
class Memory;
inline constexpr u32 UPVALUE_HEAP_BYTES = 16;
inline constexpr u8 UPVALUE_RECORD_KIND = 11;
inline constexpr u32 UPVALUE_VALUE_TAG = 3;
inline constexpr u32 UPVALUE_VALUE_WORD = 4;

struct Upvalue : GCObject {
	Upvalue(Memory& memory, u32 address) : memory(memory), address(address) {}
	Memory& memory;
	const u32 address;
	bool open = false;
	int index = 0;
	CallFrame* frame = nullptr;
	Value value() const { return load(memory, address); }
	void setValue(Value value) { store(memory, address, value); }
	static Value load(const Memory& memory, u32 address);
	static void store(Memory& memory, u32 address, Value value);
	Upvalue* nextOpen = nullptr;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t open, index, frame; };
	static NativeOffsets nativeOffsets();
#endif
};

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

inline constexpr u32 CLOSURE_PROTOTYPE_ADDRESS = 8;
inline constexpr u32 CLOSURE_CAPTURE_WORDS = 12;
inline constexpr u32 closureRecordBytes(u32 captures) { return CLOSURE_CAPTURE_WORDS + 4u * captures; }

struct Closure : GCObject {
	Closure(Memory& memory, u32 address, u32 count, const FunctionPrototype& prototype, bool canonical)
		: memory(memory), address(address), prototype(&prototype), upvalueCount(count), canonical(canonical) {}
	Memory& memory;
	const u32 address;
	const FunctionPrototype* prototype;
	const u32 upvalueCount;
	const bool canonical;
	void initializeRecord();
	u32 captureAddress(u32 index) const;
	void setCaptureAddress(u32 index, u32 reference);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeAddressOffset();
	static size_t nativePrototypeOffset();
#endif
};
} // namespace bmsx
