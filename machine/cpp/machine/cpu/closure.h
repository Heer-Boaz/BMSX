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
};

struct Closure : GCObject {
	u32 functionAddress = 0;
	size_t upvalueCount = 0;
	Upvalue** upvalues = nullptr;
	size_t trackedHeapBytes = 0;
};
} // namespace bmsx
