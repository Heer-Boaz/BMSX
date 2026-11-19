#pragma once

#include "machine/cpu/gc_object.h"

#include "machine/cpu/call_state.h"
#include "machine/cpu/value.h"

namespace bmsx {

class GcHeap;

enum class ThreadStatus : u32 { New, Running, Normal, Suspended, Dead, Failed };
constexpr size_t THREAD_HEAP_BYTES = 64;
constexpr size_t THREAD_STACK_SLOT_BYTES = 5;
constexpr u32 THREAD_INITIAL_VALUES = 8;
constexpr u32 THREAD_INITIAL_FRAMES = 2;
constexpr u32 THREAD_INITIAL_BACKING_BYTES = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
constexpr u32 THREAD_RECORD_KIND = 4u;

enum class ThreadField : u32 {
	Header = 0, Status = 8, Resumer = 12, Entry = 16, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	ProtectedDepth = 60
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
	void reserveFrame(size_t values, Value root = valueNil(), bool exception = false);
	void bindStack();
	void armStackWatch();
	bool observeStackWrite();
	bool observeFrameWindowWrites(u32 first, u32 end);
	void armFrameWindowWatches();
	void freeStack();
	u32 stackOffset() const;
	u32 stackByteLength() const { return static_cast<u32>(stack.size()) * THREAD_STACK_SLOT_BYTES; }
	u32 backingByteLength() const;
	bool stackRequiresScalar() const;
	size_t shrinkStack();
	u32 protectedDepth() const;
	void setProtectedDepth(u32 depth);
	u32 protectedWord(u32 index, ProtectedField field) const;
	void setProtectedKind(u32 index, ProtectedCallKind kind);
	CallFrame* protectedCaller(u32 index) const;
	u32 pushProtectedCall(ProtectedCallKind kind, bool parent, int base, int wanted, int handler);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	struct NativeOffsets { size_t currentFrame, frameDepth, stackTop, stackWords, stackTags, stackCapacity, frameCapacity; };
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
private:
	friend struct CallFrame;
	void replaceStack(u32 block, size_t capacity, u32 frames, u32 continuations);
	u32 frameCapacity() const;
	u32 protectedCapacity() const;
	u32 frameControlAddress(u32 index) const;
	void armFrameWindowWatch(const CallFrame& frame);
	u32 protectedAddress(u32 index) const;
	u32 read(ThreadField field) const;
	void write(ThreadField field, u32 word);
	u32 boundFrameCapacity = 0;
	u32 boundProtectedCapacity = 0;
	GcHeap& heap;
};

} // namespace bmsx
