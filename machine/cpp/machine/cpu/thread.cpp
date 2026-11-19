#include "machine/cpu/thread.h"
#include "machine/cpu/gc_heap.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {
namespace {
constexpr u32 controlOffset(u32 values) { return (values * THREAD_STACK_SLOT_BYTES + 3u) & ~3u; }
constexpr u32 backingBytes(u32 values, u32 frames, u32 continuations) {
	return controlOffset(values) + frames * FRAME_CONTROL_BYTES + continuations * PROTECTED_CALL_BYTES;
}

void copyStackControl(Memory& memory, u8* destination, u32 source, u32 bytes) {
	if (bytes == 0) return;
	source &= RAM_RECORD_WORD_MASK;
	const u32 first = std::min(bytes, MAIN_RAM_SIZE - source);
	std::memmove(destination, memory.ramData() + source, first);
	if (first != bytes) std::memmove(destination + first, memory.ramData(), bytes - first);
}
}

Thread::Thread(GcHeap& heap, u32 address) : address(address),
	nativeRecord(heap.memory.ramData() + (address & RAM_RECORD_WORD_MASK)), heap(heap) {}

void Thread::initializeRecord(u32 entry) {
	const u32 offset = address & (MAIN_RAM_SIZE - 1u);
	auto* record = heap.memory.ramData() + offset;
	const u32 block = read(ThreadField::StackBlock);
	std::fill_n(record, THREAD_HEAP_BYTES, u8{0});
	writeLE32(record, THREAD_RECORD_KIND | (static_cast<u32>(heap.white()) << 8u));
	writeLE32(record + static_cast<u32>(ThreadField::Entry), entry);
	writeLE32(record + static_cast<u32>(ThreadField::StackBlock), block);
	writeLE32(record + static_cast<u32>(ThreadField::StackCapacity), THREAD_INITIAL_VALUES);
	writeLE32(record + static_cast<u32>(ThreadField::FrameCapacity), THREAD_INITIAL_FRAMES);
	const u32 control = (block & RAM_RECORD_WORD_MASK) + controlOffset(THREAD_INITIAL_VALUES);
	std::fill_n(heap.memory.ramData() + control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES, u8{0});
	heap.memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	bindStack();
	heap.memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	stack.clear(0, stackCapacity);
	armStackWatch();
}

void Thread::write(ThreadField field, u32 word) { heap.memory.writeRamRecordWord(address + static_cast<u32>(field), word); }

ThreadStatus Thread::status() const { return static_cast<ThreadStatus>(read(ThreadField::Status)); }
void Thread::setStatus(ThreadStatus status) { write(ThreadField::Status, static_cast<u32>(status)); }
Thread* Thread::resumer() const {
	const u32 owner = read(ThreadField::Resumer);
	return owner == 0u ? nullptr : heap.threadAt(owner);
}
void Thread::setResumer(Thread* thread) { write(ThreadField::Resumer, thread ? thread->address : 0u); }
i32 Thread::callBase() const { return static_cast<i32>(read(ThreadField::CallBase)); }
i32 Thread::returnCount() const { return static_cast<i32>(read(ThreadField::ReturnCount)); }
void Thread::setReturnWindow(i32 base, i32 count) {
	heap.memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::CallBase), static_cast<u32>(base), static_cast<u32>(count));
}
Value Thread::error() const { return valueFromTag(static_cast<ValueTag>(heap.memory.readRamRecordByte(address + static_cast<u32>(ThreadField::ErrorKind))), read(ThreadField::ErrorWord)); }
void Thread::setError(Value value) {
	heap.memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::ErrorWord), valuePayload(value), static_cast<u32>(valueTag(value)));
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
Thread::NativeOffsets Thread::nativeOffsets() {
	constexpr size_t stack = offsetof(Thread, stack);
	return {offsetof(Thread, currentFrame), offsetof(Thread, nativeRecord),
		stack + ValueSpan::wordsOffset(), stack + ValueSpan::tagsOffset(), offsetof(Thread, stackCapacity), offsetof(Thread, boundFrameCapacity)};
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

u32 Thread::stackOffset() const { return stack.wordAddress(); }
u32 Thread::frameCapacity() const { return read(ThreadField::FrameCapacity) & THREAD_CONTROL_COUNT_MASK; }
u32 Thread::protectedCapacity() const { return read(ThreadField::ProtectedCapacity) & THREAD_CONTROL_COUNT_MASK; }
u32 Thread::protectedDepth() const { return read(ThreadField::ProtectedDepth) & THREAD_CONTROL_COUNT_MASK; }
void Thread::setProtectedDepth(u32 depth) { write(ThreadField::ProtectedDepth, depth); }
u32 Thread::frameControlAddress(u32 index) const {
	return stackOffset() + boundFrameOffset + index * FRAME_CONTROL_BYTES;
}
u32 Thread::protectedAddress(u32 index) const {
	return frameControlAddress(boundFrameCapacity) + index * PROTECTED_CALL_BYTES;
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
	// A bus-written index outside the active window has no activation.
	if (depth >= frameDepth()) return nullptr;
	CallFrame* frame = currentFrame;
	for (size_t at = frameDepth() - 1; at > depth; --at) frame = frame->previous;
	return frame;
}
u32 Thread::pushProtectedCall(ProtectedCallKind kind, bool parent, int base, int wanted, int handler) {
	const u32 index = protectedDepth();
	const u32 reserved = protectedCapacity();
	if (index == reserved) {
		const u32 capacity = reserved == 0 ? 1 : reserved * 2;
		const u32 frames = boundFrameCapacity;
		const u32 bytes = backingBytes(static_cast<u32>(stack.size()), frames, capacity);
		replaceStack(heap.budget.allocateStack(bytes, this, valueNil()), stack.size(), frames, capacity);
	}
	const u32 addr = protectedAddress(index) & RAM_RECORD_WORD_MASK;
	auto& memory = heap.memory;
	auto* ram = memory.ramData();
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Flags)) & RAM_RECORD_WORD_MASK),
		static_cast<u32>(kind) | (parent ? PROTECTED_CALL_PARENT : 0));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Caller)) & RAM_RECORD_WORD_MASK), static_cast<u32>(frameDepth() - 1));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Base)) & RAM_RECORD_WORD_MASK), static_cast<u32>(base));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Wanted)) & RAM_RECORD_WORD_MASK), static_cast<u32>(wanted));
	writeLE32(ram + ((addr + static_cast<u32>(ProtectedField::Handler)) & RAM_RECORD_WORD_MASK), static_cast<u32>(handler));
	const u32 first = std::min(PROTECTED_CALL_BYTES, MAIN_RAM_SIZE - addr);
	memory.invalidateRamWrite(addr, first);
	if (first != PROTECTED_CALL_BYTES) memory.invalidateRamWrite(0, PROTECTED_CALL_BYTES - first);
	setProtectedDepth(index + 1);
	return index;
}

bool Thread::stackRequiresScalar() const {
	const auto& watches = heap.memory.ramWriteWatches();
	const u32 bytes = backingByteLength();
	const u32 offset = stackOffset(), controls = boundFrameOffset;
	return stack.mirrored() || static_cast<size_t>(stackTop()) > stack.size() || frameDepth() > boundFrameCapacity
		|| bytes > MAIN_RAM_SIZE - offset
		|| (watches.anyWatched() && (watches.anyWatched((address & RAM_RECORD_WORD_MASK) + static_cast<u32>(ThreadField::StackTop), 4)
			|| watches.anyWatched((address & RAM_RECORD_WORD_MASK) + static_cast<u32>(ThreadField::FrameDepth), 4, false)
			|| watches.anyWatched(offset, controls)
			|| watches.anyWatched(offset + controls, bytes - controls, false)));
}

void Thread::bindStack() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	recordedWriteEpoch = 0;
#endif
	stackCapacity = read(ThreadField::StackCapacity);
	boundFrameCapacity = frameCapacity();
	boundProtectedCapacity = protectedCapacity();
	const u32 block = read(ThreadField::StackBlock) & RAM_RECORD_WORD_MASK;
	boundFrameOffset = controlOffset(static_cast<u32>(stackCapacity));
	boundBackingBytes = backingBytes(static_cast<u32>(stackCapacity), boundFrameCapacity, boundProtectedCapacity);
	const u32 controls = block + boundFrameOffset;
	u32 index = 0;
	for (auto* frame = firstFrame; frame; frame = frame->next, ++index) {
		bindFrameControl(*frame, controls + index * FRAME_CONTROL_BYTES, index);
	}
	size_t extent = 0;
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		extent = std::max(extent, static_cast<size_t>(frame->stackBase() + frame->stackCapacity()));
	stack = {heap.memory, block, block + static_cast<u32>(stackCapacity) * 4u, stackCapacity,
		stackCapacity > (MAIN_RAM_SIZE - block) / THREAD_STACK_SLOT_BYTES || extent > stackCapacity};
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		frame->registers = stack.subspan(frame->stackBase(), frame->stackCapacity());
}

void Thread::bindFrameControl(CallFrame& frame, u32 address, u32 index) {
	frame.bindControl(heap.memory, address);
	if (index >= boundFrameCapacity || FRAME_CONTROL_BYTES > MAIN_RAM_SIZE - frame.controlOffset)
		frame.nativeControl = nullptr;
	armFrameWindowWatch(frame);
}

void Thread::armFrameWindowWatch(const CallFrame& frame) {
	for (auto field : {FrameField::StackBase, FrameField::StackCapacity})
		heap.memory.armRamViewWord((frame.controlOffset + static_cast<u32>(field)) & RAM_RECORD_WORD_MASK);
}

void Thread::armFrameWindowWatches() {
	for (auto* frame = firstFrame; frame; frame = frame->next) armFrameWindowWatch(*frame);
}

bool Thread::observeFrameWindowWrites(u32 first, u32 end) {
	bool active = false;
	u32 index = 0;
	for (auto* frame = firstFrame; frame; frame = frame->next, ++index) {
		const u32 base = RAM_BASE + ((frame->controlOffset + static_cast<u32>(FrameField::StackBase)) & RAM_RECORD_WORD_MASK);
		const u32 size = RAM_BASE + ((frame->controlOffset + static_cast<u32>(FrameField::StackCapacity)) & RAM_RECORD_WORD_MASK);
		if ((first <= base && base < end) || (first <= size && size < end)) {
			armFrameWindowWatch(*frame);
			active |= index < frameDepth();
		}
	}
	if (active) {
		bindStack();
		setStackTop(currentFrame->stackBase() + currentFrame->stackCapacity());
	}
	return active;
}

void Thread::armStackWatch() {
	const u32 first = (address + static_cast<u32>(ThreadField::StackBlock)) & RAM_RECORD_WORD_MASK;
	for (u32 offset = 0; offset < 16; offset += sizeof(u32))
		heap.memory.armRamViewWord(first + offset);
	heap.memory.armRamViewWord((address + static_cast<u32>(ThreadField::FrameDepth)) & RAM_RECORD_WORD_MASK);
}

bool Thread::observeStackWrite() {
	armStackWatch();
	if ((read(ThreadField::StackBlock) & RAM_RECORD_WORD_MASK) == stackOffset()
		&& read(ThreadField::StackCapacity) == stackCapacity
		&& frameCapacity() == boundFrameCapacity && protectedCapacity() == boundProtectedCapacity)
		return false;
	bindStack();
	return true;
}

void Thread::resizeStack(size_t capacity, Value root) {
	if (capacity == stackCapacity) return;
	const auto bytes = backingBytes(static_cast<u32>(capacity), boundFrameCapacity, boundProtectedCapacity);
	replaceStack(heap.budget.allocateStack(bytes, this, root), capacity, boundFrameCapacity, boundProtectedCapacity);
}

void Thread::reserveFrame(size_t values, Value root, bool exception) {
	const size_t wanted = frameDepth() + (exception ? 1 : 2);
	u32 frames = std::max(THREAD_INITIAL_FRAMES, boundFrameCapacity);
	while (frames < wanted) frames *= 2;
	if (values == stackCapacity && frames == boundFrameCapacity) return;
	const u32 bytes = backingBytes(static_cast<u32>(values), frames, boundProtectedCapacity);
	replaceStack(heap.budget.allocateStack(bytes, this, root), values, frames, boundProtectedCapacity);
}

void Thread::freeStack() { heap.arena.free(read(ThreadField::StackBlock)); }

void Thread::replaceStack(u32 block, size_t capacity, u32 frames, u32 continuations) {
	const size_t previousSize = stack.size();
	const u32 oldBlock = read(ThreadField::StackBlock);
	auto* words = heap.memory.ramData() + (block & RAM_RECORD_WORD_MASK);
	auto* tags = words + capacity * sizeof(u32);
	const auto retained = std::min(previousSize, capacity);
	if (stack.mirrored()) {
		auto next = ValueSpan(heap.memory, block, block + static_cast<u32>(capacity) * sizeof(u32), capacity);
		next.copyFrom(stack, 0, 0, retained);
	} else {
		std::memmove(words, stack.words(), retained * sizeof(u32));
		std::memmove(tags, stack.tags(), retained);
	}
	std::memset(words + retained * sizeof(u32), 0, (capacity - retained) * sizeof(u32));
	std::memset(tags + retained, 0, capacity - retained);
	auto* frameRecords = words + controlOffset(static_cast<u32>(capacity));
	const u32 frameBytes = std::min({static_cast<u32>(frameDepth()), boundFrameCapacity, frames}) * FRAME_CONTROL_BYTES;
	auto* protectedRecords = frameRecords + frames * FRAME_CONTROL_BYTES;
	const u32 occupied = std::min({protectedDepth(), boundProtectedCapacity, continuations}) * PROTECTED_CALL_BYTES;
	copyStackControl(heap.memory, frameRecords, frameControlAddress(0), frameBytes);
	copyStackControl(heap.memory, protectedRecords, protectedAddress(0), occupied);
	const u32 bytes = backingBytes(static_cast<u32>(capacity), frames, continuations);
	std::fill(words + capacity * THREAD_STACK_SLOT_BYTES, frameRecords, u8{0});
	std::fill(frameRecords + frameBytes, protectedRecords, u8{0});
	std::fill(protectedRecords + occupied, words + bytes, u8{0});
	heap.memory.invalidateRamWrite(block & RAM_RECORD_WORD_MASK, bytes);
	// Publish the four geometry words together so observers only bind once.
	const u32 descriptor = (address + static_cast<u32>(ThreadField::StackBlock)) & RAM_RECORD_WORD_MASK;
	auto* geometry = heap.memory.ramData() + descriptor;
	writeLE32(geometry, block);
	writeLE32(geometry + 4, static_cast<u32>(capacity));
	writeLE32(geometry + 8, frames);
	writeLE32(geometry + 12, continuations);
	heap.memory.invalidateRamWrite(descriptor, 16);
	heap.arena.free(oldBlock);

}

size_t Thread::shrinkStack() {
	size_t used = static_cast<size_t>(stackTop());
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		used = std::max(used, static_cast<size_t>(frame->stackBase() + frame->stackCapacity()));
	const u32 priorProtected = protectedCapacity();
	const u32 nextProtected = priorProtected > 4 && 3ull * protectedDepth() < priorProtected ? priorProtected / 2 : priorProtected;
	const size_t nextValues = stackCapacity > 16 && used * 3 < stackCapacity ? stackCapacity / 2 : stackCapacity;
	const u32 nextFrames = boundFrameCapacity > 4 && frameDepth() * 3 < boundFrameCapacity ? boundFrameCapacity / 2 : boundFrameCapacity;
	if (nextValues == stackCapacity && nextProtected == priorProtected && nextFrames == boundFrameCapacity) return 0;
	const auto bytes = backingBytes(static_cast<u32>(nextValues), nextFrames, nextProtected);
	const u32 block = heap.arena.allocate(bytes, true);
	if (block == 0u) return 0; // Collection cannot recursively collect for a shrink.

	replaceStack(block, nextValues, nextFrames, nextProtected);
	return bytes;
}

CallFrame* Thread::frameNode(CallFrame* previous) {
	CallFrame*& frame = previous ? previous->next : firstFrame;
	if (!frame) {
		frame = new CallFrame;
		frame->thread = this;
		frame->previous = previous;
	}
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
	// currentFrame already describes this publication. Preserve its view watch.
	heap.memory.invalidateRamWrite(offset, sizeof(u32), false);
}

void Thread::leaveFrame() {
	auto* frame = currentFrame;
	currentFrame = frame->previous;
	setStackTop(currentFrame ? currentFrame->stackBase() + currentFrame->stackCapacity() : 0);
	publishDepth(static_cast<u32>(frameDepth()) - 1u);
	// Inactive pointers are not roots; active paths establish them before use.
	frame->registers = {};
	frame->decodedPage = nullptr;
	frame->compilationEntry = true;
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
	u32 index = static_cast<u32>(frameDepth());
	while (frame && frame->next) {
		auto* retired = frame->next;
		frame->next = retired->next;
		if (frame->next) {
			frame->next->previous = frame;
			frame->next->bindControl(heap.memory, frameControlAddress(index + 1));
			if (index + 1 >= boundFrameCapacity) frame->next->nativeControl = nullptr;
		}
		delete retired;
		frame = frame->next;
		++index;
	}
}

} // namespace bmsx
