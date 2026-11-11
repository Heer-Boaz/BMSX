#include "machine/cpu/thread.h"

namespace bmsx {

Thread::~Thread() {
	while (firstFrame) {
		auto* next = firstFrame->next;
		delete firstFrame;
		firstFrame = next;
	}
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
	--frameDepth;
	frame->executionImage = nullptr;
	frame->closure = nullptr;
	frame->decodedPage = nullptr;
	frame->decodedPageAddress = 0;
	frame->compilationEntry = true;
	frame->registers = nullptr;
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
