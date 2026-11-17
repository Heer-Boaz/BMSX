#pragma once

#include "machine/cpu/gc_object.h"

#include "common/scratchbuffer.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/value.h"

namespace bmsx {

enum class ThreadStatus : uint8_t { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 5;

struct Thread : GCObject {
	Thread();
	Thread(const Thread&) = delete;
	Thread& operator=(const Thread&) = delete;
	~Thread();

	CallFrame* acquireFrame();
	void enterFrame(CallFrame* frame) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		// Ordinary/interpreter and exception entries have no compiled callsite.
		if (currentFrame) currentFrame->nativeContinuationCells = {};
#endif
		currentFrame = frame; ++frameDepth;
	}
	void leaveFrame();
	CallFrame* frameAtDepth(size_t depth) const;
	void trimFrames();
	void resizeStack(size_t capacity);
	size_t shrinkStack();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t currentFrame, frameDepth, stackTop, stackWords, stackTags, stackCapacity; };
	static NativeOffsets nativeOffsets();
#endif

	ThreadStatus status = ThreadStatus::New;
	// Stable nodes belong to this thread. The cursor, not the retained tail,
	// determines which frames and register ranges are active roots.
	CallFrame* firstFrame = nullptr;
	CallFrame* currentFrame = nullptr;
	size_t frameDepth = 0;
	// The thread owns the allocation and exposes its actual bounds to generated
	// calls. stackTop is the current physical activation extent; caller
	// windows overlap it above their call sites.
	ValueSlots stack;
	uint32_t* stackWords = nullptr;
	uint8_t* stackTags = nullptr;
	size_t stackCapacity = 0;
	int stackTop = 0;
	ScratchBuffer<ProtectedCallContinuation> protectedCallContinuations{1};
	size_t protectedCallDepth = 0;
	Thread* resumer = nullptr;
	Closure* entry = nullptr;
	int callBase = 0;
	int returnCount = 0;
	uint32_t errorWord = 0;
	ValueTag errorKind = ValueTag::Nil;
	Value error() const { return valueFromTag(errorKind, errorWord); }
	void setError(Value value) { errorWord = valuePayload(value); errorKind = valueTag(value); }
};

} // namespace bmsx
