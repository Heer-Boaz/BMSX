#include "machine/cpu/thread.h"

#include <algorithm>

namespace bmsx {

Thread::Thread() { resizeStack(8); }

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
Thread::NativeOffsets Thread::nativeOffsets() {
	return {offsetof(Thread, currentFrame), offsetof(Thread, frameDepth), offsetof(Thread, stackTop), offsetof(Thread, stackWords), offsetof(Thread, stackTags), offsetof(Thread, stackCapacity)};
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif

Thread::~Thread() {
	while (firstFrame) {
		auto* next = firstFrame->next;
		delete firstFrame;
		firstFrame = next;
	}
}

void Thread::resizeStack(size_t capacity) {
	if (capacity == stackCapacity) return;
	stack.resize(capacity);
	stackWords = stack.words(); stackTags = stack.tags(); stackCapacity = capacity;
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		frame->registers = stack.view().subspan(frame->stackBase, frame->stackCapacity);
}

size_t Thread::shrinkStack() {
	size_t used = static_cast<size_t>(stackTop);
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		used = std::max(used, static_cast<size_t>(frame->stackBase + frame->stackCapacity));
	if (stackCapacity <= 16 || used * 3 >= stackCapacity) return 0;
	const size_t released = stackCapacity / 2;
	resizeStack(released);
	return released;
}

CallFrame* Thread::acquireFrame() {
	CallFrame*& frame = currentFrame ? currentFrame->next : firstFrame;
	if (!frame) {
		frame = new CallFrame;
		frame->thread = this;
		frame->previous = currentFrame;
	}
	return frame;
}

void Thread::leaveFrame() {
	auto* frame = currentFrame;
	currentFrame = frame->previous;
	stackTop = currentFrame ? currentFrame->stackBase + currentFrame->stackCapacity : 0;
	--frameDepth;
	// Inactive pointers are not roots; active paths establish them before use.
	frame->registers = {};
	frame->decodedPage = nullptr;
	frame->compilationEntry = true;
	frame->protectedContinuationIndex = -1;
	frame->isExceptionFrame = false;
	frame->isNonMaskableExceptionFrame = false;
}

CallFrame* Thread::frameAtDepth(size_t depth) const {
	auto* frame = firstFrame;
	for (size_t index = 0; index < depth; ++index) frame = frame->next;
	return frame;
}

void Thread::trimFrames() {
	// Like Lua's CallInfo chain, keep the first spare node and halve the rest
	// at collection. That first node can be awaiting activation while growth
	// of the Value stack collects; it must retain its identity.
	auto* frame = currentFrame ? currentFrame->next : firstFrame;
	while (frame && frame->next) {
		auto* retired = frame->next;
		frame->next = retired->next;
		if (frame->next) frame->next->previous = frame;
		delete retired;
		frame = frame->next;
	}
}

} // namespace bmsx
