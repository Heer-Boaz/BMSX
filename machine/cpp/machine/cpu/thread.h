#pragma once

#include <memory>
#include <vector>
#include "common/scratchbuffer.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/value.h"

namespace bmsx {

enum class ThreadStatus : uint8_t { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 8;

struct Thread : GCObject {
	ThreadStatus status = ThreadStatus::New;
	std::vector<std::unique_ptr<CallFrame>> frames;
	std::vector<Value> stack = std::vector<Value>(8, valueNil());
	int stackTop = 0;
	ScratchBuffer<ProtectedCallContinuation> protectedCallContinuations{1};
	size_t protectedCallDepth = 0;
	Thread* resumer = nullptr;
	Closure* entry = nullptr;
	int callBase = 0;
	int returnCount = 0;
	Value error = valueNil();
};

} // namespace bmsx
