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
	Value value() const;
	void setValue(Value value);
	Upvalue* nextOpen = nullptr;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t open, index, frame, address; };
	static NativeOffsets nativeOffsets();
#endif
};

struct Closure : GCObject {
	u32 functionAddress = 0;
	u32 codeAddress = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	u32 flags = 0;
	u32 upvalueTableAddress = 0;
	u32 recordUpvalueCount = 0;
	i32 executionDomainId = 0;
	size_t upvalueCount = 0;
	uint32_t* upvalues = nullptr;
	size_t trackedHeapBytes = 0;
	bool canonical = false;
	bool sameFunction(const Closure& other) const {
		return functionAddress == other.functionAddress && executionDomainId == other.executionDomainId
			&& codeAddress == other.codeAddress && numParams == other.numParams && maxStack == other.maxStack
			&& flags == other.flags && upvalueTableAddress == other.upvalueTableAddress
			&& recordUpvalueCount == other.recordUpvalueCount && upvalueCount == other.upvalueCount;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeUpvaluesOffset();
	struct NativeFunctionOffsets { size_t address, codeAddress, numParams, maxStack, flags, executionDomainId; };
	static NativeFunctionOffsets nativeFunctionOffsets();
#endif
};
} // namespace bmsx
