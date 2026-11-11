#pragma once

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct CallFrame;

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
	size_t upvalueCount = 0;
	Upvalue** upvalues = nullptr;
	size_t trackedHeapBytes = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeUpvaluesOffset();
	static size_t nativeFunctionAddressOffset();
#endif
};
} // namespace bmsx
