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
};

struct Closure : GCObject {
	u32 functionAddress = 0;
	size_t upvalueCount = 0;
	Upvalue** upvalues = nullptr;
	size_t trackedHeapBytes = 0;
};

struct OpenUpvalueSlot {
	CallFrame* frame = nullptr;
	int index = 0;
	Upvalue* upvalue = nullptr;
};

} // namespace bmsx
