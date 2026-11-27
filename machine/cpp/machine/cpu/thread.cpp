#include "machine/cpu/thread.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {
Thread::Thread(Memory& memory, u32 address) : address(address),
	nativeRecord(address != 0u ? memory.ramData() + (address & RAM_RECORD_WORD_MASK) : nullptr), memory(memory) {}

void Thread::select(u32 selected) {
	if (m_lastBoundFrame) {
		m_lastBoundFrame->next = m_parkedFrameViews;
		m_parkedFrameViews = firstFrame;
		firstFrame = m_lastBoundFrame = nullptr;
	}
	address = selected;
	nativeRecord = selected != 0u ? memory.ramData() + (selected & RAM_RECORD_WORD_MASK) : nullptr;
	currentFrame = nullptr;
	stack = {};
	stackCapacity = 0;
	boundFrameOffset = 0;
	boundFrameCapacity = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
}

void Thread::write(ThreadField field, u32 word) { memory.writeRamRecordWord(address + static_cast<u32>(field), word); }

ThreadStatus Thread::status() const { return static_cast<ThreadStatus>(read(ThreadField::Status)); }
void Thread::setStatus(ThreadStatus status) { write(ThreadField::Status, static_cast<u32>(status)); }
u32 Thread::resumer() const { return read(ThreadField::Resumer); }
void Thread::setResumer(u32 thread) { write(ThreadField::Resumer, thread); }

Value Thread::error() const { return ThreadRecord::error(memory, address); }
void Thread::setError(Value value) {
	memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::ErrorWord), valuePayload(value), static_cast<u32>(valueTag(value)));
}


Thread::~Thread() {
	for (auto* frame : {firstFrame, m_parkedFrameViews}) {
		while (frame) {
			auto* next = frame->next;
			delete frame;
			frame = next;
		}
	}
}

u32 Thread::stackOffset() const { return stack.wordAddress(); }
u32 Thread::frameCapacity() const { return read(ThreadField::FrameCapacity) & THREAD_CONTROL_COUNT_MASK; }
u32 Thread::frameControlAddress(u32 index) const {
	return boundFrameOffset + index * FRAME_CONTROL_BYTES;
}
bool Thread::stackRequiresScalar() const {
	return stack.mirrored() || static_cast<size_t>(stackTop()) > stack.size() || frameDepth() > boundFrameCapacity
		|| stackByteLength() > MAIN_RAM_SIZE - stackOffset();
}

void Thread::bindStack(bool ifRelocated) {
	const auto layout = ThreadRecord::storageLayout(memory, address);
	if (ifRelocated && layout.valueCapacity == stackCapacity && layout.offset() == stackOffset()
		&& layout.frameCapacity == boundFrameCapacity && layout.frameAddress(0) == boundFrameOffset) return;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
	stackCapacity = layout.valueCapacity;
	boundFrameCapacity = layout.frameCapacity;
	boundFrameOffset = layout.frameAddress(0);
	bindFrameControls();
	size_t extent = 0;
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		extent = std::max(extent, static_cast<size_t>(frame->stackBase() + frame->stackCapacity()));
	stack = layout.slots(memory, extent > stackCapacity);
	rebindRegisters();
}

bool Thread::currentFrameViewMatches() const {
	const auto* frame = currentFrame;
	const auto depth = static_cast<u32>(frameDepth());
	if (!frame) return depth == 0u;
	if (depth == 0u || (read(ThreadField::FrameBlock) & RAM_RECORD_WORD_MASK) != boundFrameOffset
		|| frame->controlOffset != (frameControlAddress(depth - 1u) & RAM_RECORD_WORD_MASK)) return false;
	const u32 wordStart = stackOffset() + static_cast<u32>(frame->stackBase()) * sizeof(u32);
	return frame->registers.size() == static_cast<size_t>(frame->stackCapacity())
		&& frame->registers.wordAddress() == (wordStart & RAM_RECORD_WORD_MASK);
}

void Thread::rebindRegisters() {
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		frame->registers = stack.subspan(frame->stackBase(), frame->stackCapacity());
}

void Thread::bindFrameControls() {
	u32 index = 0;
	for (auto* frame = firstFrame; frame; frame = frame->next, ++index)
		bindFrameControl(*frame, frameControlAddress(index), index);
	// Native entries borrow prebound spare nodes, but need none beyond the
	// incoming Thread's actual frame reservation.
	for (; index < boundFrameCapacity && m_parkedFrameViews; ++index)
		bindFrameControl(*frameNode(m_lastBoundFrame), frameControlAddress(index), index);
}

void Thread::bindFrameControl(CallFrame& frame, u32 address, u32 index) {
	frame.bindControl(memory, address);
	if (index >= boundFrameCapacity || FRAME_CONTROL_BYTES > MAIN_RAM_SIZE - frame.controlOffset)
		frame.nativeControl = nullptr;
}

CallFrame* Thread::frameNode(CallFrame* previous) {
	CallFrame*& frame = previous ? previous->next : firstFrame;
	if (frame) return frame;
	if (m_parkedFrameViews) {
		frame = m_parkedFrameViews;
		m_parkedFrameViews = frame->next;
		frame->next = nullptr;
		releaseFrameView(*frame);
		frame->executionImage = nullptr;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		frame->nativeContinuationCells = {};
		frame->nativeContinuationPc = 0;
#endif
	} else {
		frame = new CallFrame;
		frame->thread = this;
	}
	frame->previous = previous;
	m_lastBoundFrame = frame;
	return frame;
}

CallFrame* Thread::acquireFrame() {
	if (auto* frame = currentFrame ? currentFrame->next : firstFrame) return frame;
	auto* frame = frameNode(currentFrame);
	const auto index = static_cast<u32>(frameDepth());
	bindFrameControl(*frame, frameControlAddress(index), index);
	return frame;
}

void Thread::detachFrameViews() {
	while (currentFrame) {
		auto* frame = currentFrame;
		currentFrame = frame->previous;
		frame->registers = {};
		frame->decodedPage = nullptr;
		frame->compilationEntry = true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		frame->nativeContinuationCells = {};
#endif
	}
}

void Thread::bindFrameViews() {
	detachFrameViews();
	const size_t depth = frameDepth();
	for (size_t index = 0; index < depth; ++index) {
		currentFrame = frameNode(currentFrame);
		currentFrame->decodedPage = nullptr;
		currentFrame->compilationEntry = true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		currentFrame->nativeContinuationCells = {};
#endif
	}
	bindStack();
}

void Thread::reserveFixedFrameViews() {
	CallFrame* previous = nullptr;
	for (u32 index = 0; index < boundFrameCapacity; ++index) {
		previous = frameNode(previous);
		bindFrameControl(*previous, frameControlAddress(index), index);
	}
}

void Thread::publishDepth(u32 depth) {
	const u32 offset = (address + static_cast<u32>(ThreadField::FrameDepth)) & RAM_RECORD_WORD_MASK;
	writeLE32(nativeRecord + static_cast<u32>(ThreadField::FrameDepth), depth);
	memory.invalidateRamWrite(offset, sizeof(u32));
}

void Thread::leaveFrame() {
	auto* frame = currentFrame;
	currentFrame = frame->previous;
	setStackTop(currentFrame ? currentFrame->stackBase() + currentFrame->stackCapacity() : 0);
	publishDepth(static_cast<u32>(frameDepth()) - 1u);
	// Inactive pointers are not roots; active paths establish them before use.
	releaseFrameView(*frame);
}

void Thread::discardFrames() {
	detachFrameViews();
	setStackTop(0);
	publishDepth(0u);
}

CallFrame* Thread::frameAtDepth(size_t depth) const {
	auto* frame = firstFrame;
	for (size_t index = 0; index < depth; ++index) frame = frame->next;
	return frame;
}

} // namespace bmsx
