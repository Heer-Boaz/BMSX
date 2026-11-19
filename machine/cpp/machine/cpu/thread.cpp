#include "machine/cpu/thread.h"
#include "machine/cpu/gc_heap.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {

Thread::Thread(GcHeap& heap, u32 address) : address(address), heap(heap) {}

void Thread::initializeRecord(Closure* entry) {
	const u32 offset = address & (MAIN_RAM_SIZE - 1u);
	auto* record = heap.memory.ramData() + offset;
	const u32 block = read(ThreadField::StackBlock);
	std::fill_n(record, THREAD_HEAP_BYTES, u8{0});
	writeLE32(record, THREAD_RECORD_KIND);
	writeLE32(record + static_cast<u32>(ThreadField::Entry), entry ? entry->address : 0u);
		writeLE32(record + static_cast<u32>(ThreadField::StackBlock), block);
	writeLE32(record + static_cast<u32>(ThreadField::StackCapacity), 8u);
	bindStack();
	heap.memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	stack.clear(0, stackCapacity);
	armStackWatch();
}

u32 Thread::read(ThreadField field) const { return heap.memory.readRamRecordWord(address + static_cast<u32>(field)); }
void Thread::write(ThreadField field, u32 word) { heap.memory.writeRamRecordWord(address + static_cast<u32>(field), word); }

ThreadStatus Thread::status() const { return static_cast<ThreadStatus>(read(ThreadField::Status)); }
void Thread::setStatus(ThreadStatus status) { write(ThreadField::Status, static_cast<u32>(status)); }
Thread* Thread::resumer() const {
	const u32 owner = read(ThreadField::Resumer);
	return owner == 0u ? nullptr : heap.threadAt(owner);
}
void Thread::setResumer(Thread* thread) { write(ThreadField::Resumer, thread ? thread->address : 0u); }
Closure* Thread::entry() const {
	const u32 closure = read(ThreadField::Entry);
	return closure == 0u ? nullptr : heap.closureAt(closure);
}
void Thread::setEntry(Closure* closure) { write(ThreadField::Entry, closure ? closure->address : 0u); }
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
	return {offsetof(Thread, currentFrame), offsetof(Thread, frameDepth), offsetof(Thread, stackTop),
		stack + ValueSpan::wordsOffset(), stack + ValueSpan::tagsOffset(), offsetof(Thread, stackCapacity)};
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

bool Thread::stackRequiresScalar() const {
	const auto& watches = heap.memory.ramWriteWatches();
	return stack.mirrored() || static_cast<size_t>(stackTop) > stack.size() || (watches.anyWatched() && watches.anyWatched(stackOffset(), stackByteLength()));
}

void Thread::bindStack() {
	stackCapacity = read(ThreadField::StackCapacity);
	const u32 block = read(ThreadField::StackBlock) & RAM_RECORD_WORD_MASK;
	size_t extent = 0;
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		extent = std::max(extent, static_cast<size_t>(frame->stackBase + frame->stackCapacity));
	stack = {heap.memory, block, block + static_cast<u32>(stackCapacity) * 4u, stackCapacity,
		stackCapacity > (MAIN_RAM_SIZE - block) / THREAD_STACK_SLOT_BYTES || extent > stackCapacity};
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		frame->registers = stack.subspan(frame->stackBase, frame->stackCapacity);
}

void Thread::armStackWatch() {
	const u32 page = address & ~MAPPED_PAGE_BYTE_MASK;
	MappedPageBinding binding{};
	heap.memory.bindMappedPage(page, MAPPED_BUS_MASTER_CPU, binding);
	const u32 word = ((address & MAPPED_PAGE_BYTE_MASK) + static_cast<u32>(ThreadField::StackBlock)) >> 2u;
	binding.writeWatch.armWord(word);
	binding.writeWatch.armWord(word + 1u);
}

bool Thread::observeStackWrite() {
	armStackWatch();
	if ((read(ThreadField::StackBlock) & RAM_RECORD_WORD_MASK) == stackOffset()
		&& read(ThreadField::StackCapacity) == stackCapacity)
		return false;
	bindStack();
	return true;
}

void Thread::resizeStack(size_t capacity, Value root) {
	if (capacity == stackCapacity) return;
	const auto bytes = static_cast<u32>(capacity * THREAD_STACK_SLOT_BYTES);
	replaceStack(heap.budget.allocateStack(bytes, this, root), capacity);
}

void Thread::freeStack() { heap.arena.free(read(ThreadField::StackBlock)); }

void Thread::replaceStack(u32 block, size_t capacity) {
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
	heap.memory.invalidateRamWrite(block & RAM_RECORD_WORD_MASK, capacity * THREAD_STACK_SLOT_BYTES);
	// The mapped watch installs the published window and rebinds its frames.
	heap.memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::StackBlock), block, static_cast<u32>(capacity));
	heap.arena.free(oldBlock);
	heap.budget.release(heapAllocationBytes(static_cast<u32>(previousSize * THREAD_STACK_SLOT_BYTES)));
}

size_t Thread::shrinkStack() {
	size_t used = static_cast<size_t>(stackTop);
	for (auto* frame = currentFrame; frame; frame = frame->previous)
		used = std::max(used, static_cast<size_t>(frame->stackBase + frame->stackCapacity));
	if (stackCapacity <= 16 || used * 3 >= stackCapacity) return 0;
	const size_t released = stackCapacity / 2;
	const auto bytes = static_cast<u32>(released * THREAD_STACK_SLOT_BYTES);
	const u32 block = heap.arena.allocate(bytes, true);
	if (block == 0u) return 0; // Collection cannot recursively collect for a shrink.
	heap.budget.restoreAllocate(heapAllocationBytes(bytes));
	replaceStack(block, released);
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
