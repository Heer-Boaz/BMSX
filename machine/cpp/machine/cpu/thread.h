#pragma once

#include "common/scratchbuffer.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/value.h"

namespace bmsx {

enum class ThreadStatus : uint8_t { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 8;

struct Thread : GCObject {
	Thread();
	Thread(const Thread&) = delete;
	Thread& operator=(const Thread&) = delete;
	~Thread();

	CallFrame* acquireFrame();
	void enterFrame(CallFrame* frame) { currentFrame = frame; ++frameDepth; }
	void leaveFrame();
	CallFrame* frameAtDepth(size_t depth) const;
	void trimFrames();
	void resizeStack(size_t capacity);

	ThreadStatus status = ThreadStatus::New;
	// Stable nodes belong to this thread. The cursor, not the retained tail,
	// determines which frames and register ranges are active roots.
	CallFrame* firstFrame = nullptr;
	CallFrame* currentFrame = nullptr;
	size_t frameDepth = 0;
	// The thread owns the allocation and exposes its actual bounds to generated
	// calls. stackTop covers active register windows and their vararg ranges.
	Value* stack = nullptr;
	size_t stackCapacity = 0;
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
