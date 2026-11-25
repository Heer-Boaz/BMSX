#include "machine/cpu/thread.h"
#include "machine/common/numeric.h"
#include "machine/cpu/gc_heap.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {
Thread::Thread(GcHeap& heap, u32 address) : address(address),
	nativeRecord(address != 0u ? heap.memory.ramData() + (address & RAM_RECORD_WORD_MASK) : nullptr), heap(heap) {}

void Thread::select(u32 selected) {
	if (m_lastBoundFrame) {
		m_lastBoundFrame->next = m_parkedFrameViews;
		m_parkedFrameViews = firstFrame;
		firstFrame = m_lastBoundFrame = nullptr;
	}
	address = selected;
	nativeRecord = selected != 0u ? heap.memory.ramData() + (selected & RAM_RECORD_WORD_MASK) : nullptr;
	currentFrame = nullptr;
	stack = {};
	stackCapacity = 0;
	boundFrameOffset = 0;
	boundProtectedOffset = 0;
	boundFrameCapacity = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
}

void Thread::write(ThreadField field, u32 word) { heap.memory.writeRamRecordWord(address + static_cast<u32>(field), word); }

ThreadStatus Thread::status() const { return static_cast<ThreadStatus>(read(ThreadField::Status)); }
void Thread::setStatus(ThreadStatus status) { write(ThreadField::Status, static_cast<u32>(status)); }
u32 Thread::resumer() const {
	const u32 owner = read(ThreadField::Resumer);
	return owner == 0u ? 0u : heap.threadRecordAddress(owner);
}
void Thread::setResumer(u32 thread) { write(ThreadField::Resumer, thread); }

CallResultPlacement Thread::transferResult() const {
	return {static_cast<i32>(read(ThreadField::CallBase)), read(ThreadField::ReturnCount)};
}
void Thread::setTransferResult(CallResultPlacement result) {
	heap.memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::CallBase), static_cast<u32>(result.base), result.word);
}
Value Thread::error() const { return ThreadRecord::error(heap.memory, address); }
void Thread::setError(Value value) {
	heap.memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::ErrorWord), valuePayload(value), static_cast<u32>(valueTag(value)));
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
u32 Thread::protectedCapacity() const { return read(ThreadField::ProtectedCapacity) & THREAD_CONTROL_COUNT_MASK; }
u32 Thread::protectedDepth() const { return read(ThreadField::ProtectedDepth) & THREAD_CONTROL_COUNT_MASK; }
void Thread::setProtectedDepth(u32 depth) { write(ThreadField::ProtectedDepth, depth); }
u32 Thread::frameControlAddress(u32 index) const {
	return boundFrameOffset + index * FRAME_CONTROL_BYTES;
}
u32 Thread::protectedAddress(u32 index) const {
	return boundProtectedOffset + index * PROTECTED_CALL_BYTES;
}
u32 Thread::protectedWord(u32 index, ProtectedField field) const {
	return heap.memory.readRamRecordWord(protectedAddress(index) + static_cast<u32>(field));
}
void Thread::setProtectedKind(u32 index, ProtectedCallKind kind) {
	const u32 flags = protectedWord(index, ProtectedField::Flags);
	heap.memory.writeRamRecordWord(protectedAddress(index) + static_cast<u32>(ProtectedField::Flags),
		(flags & ~PROTECTED_CALL_KIND_MASK) | static_cast<u32>(kind));
}
CallFrame* Thread::protectedCaller(u32 index) const {
	const u32 depth = protectedWord(index, ProtectedField::Caller);
	// An index outside the active window has no activation.
	if (depth >= frameDepth()) return nullptr;
	CallFrame* frame = currentFrame;
	for (size_t at = frameDepth() - 1; at > depth; --at) frame = frame->previous;
	return frame;
}
CallResultPlacement Thread::protectedResult(u32 index) const {
	return {static_cast<i32>(protectedWord(index, ProtectedField::Base)), protectedWord(index, ProtectedField::Wanted)};
}
Value Thread::protectedHandler(u32 index) const {
	const u32 payload = protectedWord(index, ProtectedField::Handler);
	return (protectedWord(index, ProtectedField::Flags) & PROTECTED_CALL_HANDLER_BUILTIN) != 0u
		? valueBuiltinFunction(static_cast<BuiltinFunctionId>(payload)) : valueClosure(payload);
}
u32 Thread::pushProtectedCall(ProtectedCallKind kind, bool parent, CallResultPlacement result, Value handler) {
	const u32 index = protectedDepth();
	const u32 reserved = protectedCapacity();
	if (index == reserved) {
		const u32 capacity = reserved == 0 ? 1 : reserved * 2;
		const u32 bytes = capacity * PROTECTED_CALL_BYTES;
		const u32 increase = (capacity - reserved) * PROTECTED_CALL_BYTES;
		const u32 block = heap.budget.reserveBacking(bytes, increase, handler, valueNil(), valueNil(), address);
		ThreadRecord::replaceControls(heap, address, ThreadField::ProtectedBlock, block, capacity);
		boundProtectedOffset = block & RAM_RECORD_WORD_MASK;
	}
	const u32 addr = protectedAddress(index) & RAM_RECORD_WORD_MASK;
	auto& memory = heap.memory;
	auto* ram = memory.ramData();
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Flags)) & RAM_RECORD_WORD_MASK),
		static_cast<u32>(kind) | (parent ? PROTECTED_CALL_PARENT : 0u)
		| (valueIsBuiltinFunction(handler) ? PROTECTED_CALL_HANDLER_BUILTIN : 0u));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Caller)) & RAM_RECORD_WORD_MASK), static_cast<u32>(frameDepth() - 1));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Base)) & RAM_RECORD_WORD_MASK), static_cast<u32>(result.base));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Wanted)) & RAM_RECORD_WORD_MASK), result.word);
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Handler)) & RAM_RECORD_WORD_MASK), valuePayload(handler));
	const u32 first = std::min(PROTECTED_CALL_BYTES, MAIN_RAM_SIZE - addr);
	memory.invalidateRamWrite(addr, first);
	if (first != PROTECTED_CALL_BYTES) memory.invalidateRamWrite(0, PROTECTED_CALL_BYTES - first);
	setProtectedDepth(index + 1);
	return index;
}

bool Thread::stackRequiresScalar() const {
	// The heap owns all thread storage; the instruction bus cannot watch it.
	// A native grant only needs to admit the physical Value/control layout.
	return stack.mirrored() || static_cast<size_t>(stackTop()) > stack.size() || frameDepth() > boundFrameCapacity
		|| stackByteLength() > MAIN_RAM_SIZE - stackOffset();
}

void Thread::bindStack() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
	const auto layout = ThreadRecord::storageLayout(heap.memory, address);
	stackCapacity = layout.valueCapacity;
	boundFrameCapacity = layout.frameCapacity;
	boundFrameOffset = layout.frameAddress(0);
	boundProtectedOffset = layout.protectedAddress(0);
	bindFrameControls();
	size_t extent = 0;
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		extent = std::max(extent, static_cast<size_t>(frame->stackBase() + frame->stackCapacity()));
	stack = layout.slots(heap.memory, extent > stackCapacity);
	rebindRegisters();
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
	frame.bindControl(heap.memory, address);
	if (index >= boundFrameCapacity || FRAME_CONTROL_BYTES > MAIN_RAM_SIZE - frame.controlOffset)
		frame.nativeControl = nullptr;
}

void Thread::resizeStack(size_t capacity, Value root) {
	if (capacity == stackCapacity) return;
	const u32 bytes = static_cast<u32>(capacity) * THREAD_STACK_SLOT_BYTES;
	const u32 increase = static_cast<u32>(capacity - std::min(capacity, stackCapacity)) * THREAD_STACK_SLOT_BYTES;
	const u32 block = heap.budget.reserveBacking(bytes, increase, root, valueNil(), valueNil(), address);
	ThreadRecord::replaceStack(heap, address, block, static_cast<u32>(capacity));
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	stackCapacity = capacity;
	stack = ValueSpan(heap.memory, offset, offset + static_cast<u32>(capacity) * sizeof(u32), capacity);
	rebindRegisters();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
}

void Thread::reserveFrame(size_t valueEnd, Value root, bool exception) {
	// The last control slot is reserved for an exception activation.
	const size_t wanted = std::max<size_t>(THREAD_INITIAL_FRAMES, frameDepth() + (exception ? 1u : 2u));
	if (valueEnd <= stackCapacity && wanted <= boundFrameCapacity) return;
	u32 frames = std::max(THREAD_INITIAL_FRAMES, boundFrameCapacity);
	while (frames < wanted) frames *= 2;
	const u32 valueChange = valueEnd <= stackCapacity ? 0u : static_cast<u32>(std::max<size_t>(8, nextPowerOfTwo(valueEnd)));
	const u32 frameChange = frames == boundFrameCapacity ? 0u : frames;
	heap.budget.reserveThreadFrameStorage(address, valueChange, frameChange, root);
	if (frameChange != 0u) {
		boundFrameCapacity = frameChange;
		boundFrameOffset = read(ThreadField::FrameBlock) & RAM_RECORD_WORD_MASK;
		bindFrameControls();
	}
	if (valueChange != 0u) {
		stackCapacity = valueChange;
		const u32 offset = read(ThreadField::StackBlock) & RAM_RECORD_WORD_MASK;
		stack = ValueSpan(heap.memory, offset, offset + valueChange * sizeof(u32), valueChange);
		rebindRegisters();
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
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
		frame->decodedPageAddress = 0;
		frame->decodedPageBusSignals = MAPPED_BUS_MASTER_CPU;
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

void Thread::publishDepth(u32 depth) {
	const u32 offset = (address + static_cast<u32>(ThreadField::FrameDepth)) & RAM_RECORD_WORD_MASK;
	writeLE32(nativeRecord + static_cast<u32>(ThreadField::FrameDepth), depth);
	heap.memory.invalidateRamWrite(offset, sizeof(u32));
}

void Thread::leaveFrame() {
	auto* frame = currentFrame;
	currentFrame = frame->previous;
	setStackTop(currentFrame ? currentFrame->stackBase() + currentFrame->stackCapacity() : 0);
	publishDepth(static_cast<u32>(frameDepth()) - 1u);
	// Inactive pointers are not roots; active paths establish them before use.
	releaseFrameView(*frame);
}

CallFrame* Thread::frameAtDepth(size_t depth) const {
	auto* frame = firstFrame;
	for (size_t index = 0; index < depth; ++index) frame = frame->next;
	return frame;
}

} // namespace bmsx
