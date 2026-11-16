#pragma once

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct CallFrame;
inline constexpr size_t UPVALUE_HEAP_BYTES = 24;

struct Upvalue : GCObject {
	bool open = false;
	int index = 0;
	CallFrame* frame = nullptr;
	Value value = valueNil();
	Upvalue* nextOpen = nullptr;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t open, index, frame, value; };
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
	Upvalue** upvalues = nullptr;
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
