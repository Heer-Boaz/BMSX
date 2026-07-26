#pragma once

#include <cstdint>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct Blua32RuntimeFunction;
struct Closure;

enum class ProtectedCallKind : uint8_t {
	PCall,
	XPCallBody,
	XPCallHandler,
};

struct CallFrame {
	u32 functionAddress = 0;
	Blua32RuntimeFunction* functionRecord = nullptr;
	u32 pc = 0;
	int varargBase = 0;
	int varargCount = 0;
	Value* registers = nullptr;
	int stackBase = 0;
	int stackCapacity = 0;
	Closure* closure = nullptr;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool returnToCompletionLatch = false;
	u32 callSitePc = 0;
	bool isExceptionFrame = false;
	bool isNonMaskableExceptionFrame = false;
};

struct ProtectedCallContinuation {
	ProtectedCallKind kind = ProtectedCallKind::PCall;
	CallFrame* caller = nullptr;
	CallFrame* target = nullptr;
	bool returnsToProtectedParent = false;
	int callBase = 0;
	int returnCount = 0;
	int handlerRegister = -1;
};

} // namespace bmsx
