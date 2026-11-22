#pragma once

#include "machine/cpu/thread_record.h"

namespace bmsx {

struct Thread {
	Thread(GcHeap& heap, u32 address = 0u);
	void select(u32 address);
	Thread(const Thread&) = delete;
	Thread& operator=(const Thread&) = delete;
	~Thread();

	CallFrame* acquireFrame();
	void enterFrame(CallFrame* frame) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		// Ordinary/interpreter and exception entries have no compiled callsite.
		if (currentFrame) currentFrame->nativeContinuationCells = {};
#endif
		currentFrame = frame;
		publishDepth(static_cast<u32>(frameDepth()) + 1u);
	}
	void leaveFrame();
	void detachFrameViews();
	void bindFrameViews();
	size_t frameDepth() const { return read(ThreadField::FrameDepth) & THREAD_CONTROL_COUNT_MASK; }
	i32 stackTop() const { return static_cast<i32>(read(ThreadField::StackTop) & FRAME_WINDOW_MASK); }
	void setStackTop(i32 top) { write(ThreadField::StackTop, static_cast<u32>(top)); }
	CallFrame* frameAtDepth(size_t depth) const;
	void resizeStack(size_t capacity, Value root = valueNil());
	void reserveFrame(size_t values, Value root = valueNil(), bool exception = false);
	void bindStack();
	u32 stackOffset() const;
	u32 stackByteLength() const { return static_cast<u32>(stack.size()) * THREAD_STACK_SLOT_BYTES; }
	bool stackRequiresScalar() const;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	CallFrame* retainedFrameForEntry(const CallFrame& caller, u32 nextDepth) const {
		return nextDepth < boundFrameCapacity ? caller.next : nullptr;
	}
	void publishAdmittedFrame(CallFrame& frame, u32 depth, i32 top) {
		currentFrame = &frame;
		writeLE32(nativeRecord + static_cast<u32>(ThreadField::StackTop), static_cast<u32>(top));
		writeLE32(nativeRecord + static_cast<u32>(ThreadField::FrameDepth), depth);
	}
	void retireAdmittedFrame(CallFrame& leaving, CallFrame& caller, u32 depth) {
		const auto base = caller.readAdmittedWindow(FrameField::StackBase);
		publishAdmittedFrame(caller, depth, base + caller.readAdmittedWindow(FrameField::StackCapacity));
		releaseFrameView(leaving);
	}
	void discardPendingFrame(CallFrame& leaving) {
		leaving.pendingNativeCall = nullptr;
		releaseFrameView(leaving);
	}
	void recordNativeWrites(MappedPageWriteWatches& watches) {
		const u32 epoch = watches.historyEpoch();
		if (recordedWriteEpoch == epoch) return;
		recordedWriteEpoch = epoch;
		if ((epoch & 1u) == 0u) return;
		// Native transitions write only Values, frame controls and this
		// Thread's depth/top words. Protected handling uses the record owner.
		watches.consumeHistoryWrites(stackOffset(), stackByteLength());
		watches.consumeHistoryWrites(boundFrameOffset, boundFrameCapacity * FRAME_CONTROL_BYTES);
		watches.consumeHistoryWrites(address & RAM_RECORD_WORD_MASK, THREAD_HEAP_BYTES);
	}
#endif
	u32 protectedDepth() const;
	void setProtectedDepth(u32 depth);
	u32 protectedWord(u32 index, ProtectedField field) const;
	void setProtectedKind(u32 index, ProtectedCallKind kind);
	CallFrame* protectedCaller(u32 index) const;
	CallResultPlacement protectedResult(u32 index) const;
	Value protectedHandler(u32 index) const;
	u32 pushProtectedCall(ProtectedCallKind kind, bool parent, CallResultPlacement result, Value handler);

	u32 address;
	ThreadStatus status() const;
	void setStatus(ThreadStatus status);
	u32 resumer() const;
	void setResumer(u32 thread);
	u32 entry() const { return read(ThreadField::Entry); }
	void setEntry(u32 closure) { write(ThreadField::Entry, closure); }
	CallResultPlacement transferResult() const;
	void setTransferResult(CallResultPlacement);
	Value error() const;
	void setError(Value value);
	// Retained nodes are this CPU view bank's translation cache. Physical RAM
	// depth and windows, not these nodes, determine active roots.
	CallFrame* firstFrame = nullptr;
	CallFrame* currentFrame = nullptr;
	// The bank exposes the selected record's physical bounds to generated
	// calls. stackTop is the current physical activation extent; caller
	// windows overlap it above their call sites.
	ValueSpan stack;
	size_t stackCapacity = 0;
	u8* nativeRecord;
private:
	// Only the attached prefix is visible to the CPU and its observers.
	CallFrame* m_lastBoundFrame = nullptr;
	CallFrame* m_parkedFrameViews = nullptr;
	static void releaseFrameView(CallFrame& frame) {
		frame.registers = {};
		frame.decodedPage = nullptr;
		frame.compilationEntry = true;
	}
	friend struct CallFrame;
	u32 frameCapacity() const;
	u32 protectedCapacity() const;
	u32 frameControlAddress(u32 index) const;
	CallFrame* frameNode(CallFrame* previous);
	void bindFrameControl(CallFrame& frame, u32 address, u32 index);
	void bindFrameControls();
	void rebindRegisters();
	void publishDepth(u32 depth);
	u32 protectedAddress(u32 index) const;
	u32 read(ThreadField field) const { return readLE32(nativeRecord + static_cast<u32>(field)); }
	void write(ThreadField field, u32 word);
	u32 boundFrameOffset = 0;
	u32 boundProtectedOffset = 0;
	u32 boundFrameCapacity = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	u32 recordedWriteEpoch = 0;
#endif
	GcHeap& heap;
};

} // namespace bmsx
