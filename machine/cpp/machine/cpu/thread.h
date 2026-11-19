#pragma once

#include "machine/cpu/gc_object.h"

#include "common/scratchbuffer.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/value.h"

namespace bmsx {

class GcHeap;

enum class ThreadStatus : u32 { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 5;
constexpr u32 THREAD_RECORD_KIND = 4u;

enum class ThreadField : u32 {
	Header = 0, Status = 8, Resumer = 12, Entry = 16, StackBlock = 24, StackCapacity = 28,
	ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52
};

struct Thread : GCObject {
	Thread(GcHeap& heap, u32 address);
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
	void resizeStack(size_t capacity, Value root = valueNil());
	void bindStack();
	void armStackWatch();
	bool observeStackWrite();
	void freeStack();
	u32 stackOffset() const;
	u32 stackByteLength() const { return static_cast<u32>(stack.size()) * THREAD_STACK_SLOT_BYTES; }
	bool stackRequiresScalar() const;
	size_t shrinkStack();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t currentFrame, frameDepth, stackTop, stackWords, stackTags, stackCapacity; };
	static NativeOffsets nativeOffsets();
#endif

	void initializeRecord(Closure* entry);
	const u32 address;
	ThreadStatus status() const;
	void setStatus(ThreadStatus status);
	Thread* resumer() const;
	void setResumer(Thread* thread);
	Closure* entry() const;
	void setEntry(Closure* closure);
	i32 callBase() const;
	i32 returnCount() const;
	void setReturnWindow(i32 base, i32 count);
	Value error() const;
	void setError(Value value);
	// Stable nodes belong to this thread. The cursor, not the retained tail,
	// determines which frames and register ranges are active roots.
	CallFrame* firstFrame = nullptr;
	CallFrame* currentFrame = nullptr;
	size_t frameDepth = 0;
	// The thread owns the allocation and exposes its actual bounds to generated
	// calls. stackTop is the current physical activation extent; caller
	// windows overlap it above their call sites.
	ValueSpan stack;
	size_t stackCapacity = 0;
	int stackTop = 0;
	ScratchBuffer<ProtectedCallContinuation> protectedCallContinuations{1};
	size_t protectedCallDepth = 0;
private:
	void replaceStack(u32 block, size_t capacity);
	u32 read(ThreadField field) const;
	void write(ThreadField field, u32 word);
	GcHeap& heap;
};

} // namespace bmsx
