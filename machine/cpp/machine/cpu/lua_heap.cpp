#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"

namespace bmsx {

namespace {
constexpr size_t COLLECTION_RESERVE_SHIFT = 3;
constexpr size_t GC_ASSIST_MIN_WORDS = 512;
}

#if defined(BMSX_GC_STRESS)
// Defined by the stress runner. Only its allocator translation unit uses this
// seam; ordinary cores contain neither a callback nor a runtime mode check.
void stressHeapAllocation(LuaHeap& heap);
#endif

LuaHeap::LuaHeap(CPU& cpu)
	: m_cpu(cpu), m_targetAddress(cpu.heapAllocator().managementOffset() + HEAP_COLLECTION_TARGET_OFFSET),
	  m_occupiedAddress(cpu.heapAllocator().managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET),
	  m_gcControlAddress(cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET) {
	setCollectionTarget(MIN_COLLECTION_BYTES);
}

u32 LuaHeap::collectionTarget() const {
	return m_cpu.memory().readRamRecordWord(m_targetAddress);
}

void LuaHeap::setCollectionTarget(u32 bytes) {
	m_cpu.memory().writeRamRecordWord(m_targetAddress, bytes);
}

size_t LuaHeap::usedBytes() const {
	return m_cpu.memory().readRamRecordWord(m_occupiedAddress);
}

LuaHeap::LuaAllocationAssist LuaHeap::allocationAssist(size_t nextBytes) const noexcept {
	if (nextBytes > capacity()) return LuaAllocationAssist::Limit;
	if (nextBytes > collectionTarget()
		&& GcHeap::decodePhase(m_cpu.memory().readRamRecordByte(m_gcControlAddress)) < GcPhase::Atomic)
		return LuaAllocationAssist::Step;
	return LuaAllocationAssist::None;
}

bool LuaHeap::canAdmitWithoutAssist(size_t byteCount) const noexcept {
#if defined(BMSX_GC_STRESS)
	(void)byteCount;
	return false;
#else
	return allocationAssist(usedBytes() + byteCount) == LuaAllocationAssist::None;
#endif
}

bool LuaHeap::prepareAllocation(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread) {
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	const size_t nextBytes = usedBytes() + byteCount;
	const auto assist = allocationAssist(nextBytes);
	if (assist == LuaAllocationAssist::Limit) return false;
	if (assist == LuaAllocationAssist::Step) {
		const size_t limit = capacity();
		const size_t reserveEdge = limit - (limit >> COLLECTION_RESERVE_SHIFT);
		if (nextBytes > reserveEdge) {
			m_cpu.stepHeap(root0, root1, root2, growingThread);
			creditStep();
		} else {
			// Lua's allocation debt, credited in actual collector work.
			// Two work bytes per allocation byte, four work bytes per word.
			const size_t debt = nextBytes - collectionTarget();
			const size_t words = std::min(GC_STEP_WORDS, std::max(GC_ASSIST_MIN_WORDS, (debt + 1u) >> 1u));
			const size_t work = m_cpu.gcHeap().step(root0, root1, root2, growingThread, false, words);
			if (m_cpu.collecting()) {
				const size_t credited = usedBytes() + byteCount + 2u * work;
				setCollectionTarget(static_cast<u32>(std::min(reserveEdge, credited > debt ? credited - debt : 0u)));
			}
		}
	}
	return true;
}

LuaAllocationRecovery LuaHeap::admit(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread) {
	auto recovery = LuaAllocationRecovery::CurrentOrFresh;
	if (!prepareAllocation(byteCount, root0, root1, root2, growingThread)) {
		do {
			recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2, growingThread);
		} while (usedBytes() + byteCount > capacity());
	}
	return recovery;
}

void LuaHeap::assistSweepBeforeReservation(size_t requested) {
	// BIOS string keys are created before the collector view is bound.
	// The RAM phase latch already belongs to the initialized heap arena.
	if (GcHeap::decodePhase(m_cpu.memory().readRamRecordByte(m_gcControlAddress)) >= GcPhase::Sweep)
		m_cpu.gcHeap().assistSweepBeforeReservation(requested);
}

u32 LuaHeap::reserveRecord(u32 bytes, bool object, u32 backingBytes, u32 backingField, u32 charged, u32 secondBytes, u32 secondField) {
	const u32 prefix = object ? GC_OBJECT_PREFIX : 0u;
	auto& arena = m_cpu.heapAllocator();
	const u32 block = arena.allocate(bytes + prefix, !object);
	if (!block) return 0u;
	const u32 backing = backingBytes ? arena.allocate(backingBytes, true) : 0u;
	if (backingBytes && !backing) {
		arena.free(block);
		return 0u;
	}
	const u32 second = secondBytes ? arena.allocate(secondBytes, true) : 0u;
	if (secondBytes && !second) {
		if (backing) arena.free(backing);
		arena.free(block);
		return 0u;
	}
	const u32 address = block + prefix;
	if (backingField) m_cpu.memory().writeRamRecordWord(address + backingField, backing);
	if (secondField) m_cpu.memory().writeRamRecordWord(address + secondField, second);
	accountAllocation(charged);
	return address;
}

u32 LuaHeap::allocateRecord(u32 bytes, bool object, u32 backingBytes, u32 backingField,
	Value root0, Value root1, Value root2, std::optional<u32> recordCharge, LuaAllocationMode mode, u32 secondBytes, u32 secondField) {
	const u32 charged = recordCharge.value_or(bytes + backingBytes + secondBytes);
	if (mode != LuaAllocationMode::Direct) {
		const bool admitted = mode == LuaAllocationMode::Scheduled
			? prepareAllocation(charged, root0, root1, root2)
			: usedBytes() + charged <= capacity();
		if (!admitted) return 0u;
		if (mode == LuaAllocationMode::Scheduled)
			assistSweepBeforeReservation(bytes + (object ? GC_OBJECT_PREFIX : 0u) + backingBytes + secondBytes);
		return reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField);
	}
	auto recovery = admit(charged, root0, root1, root2, 0u);
	assistSweepBeforeReservation(bytes + (object ? GC_OBJECT_PREFIX : 0u) + backingBytes + secondBytes);
	for (;;) {
		if (const u32 address = reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField)) return address;
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2);
	}
}

u32 LuaHeap::reserveBacking(u32 bytes, u32 logicalBytes, Value root0, Value root1, Value root2, u32 growingThread) {
	auto recovery = logicalBytes != 0u ? admit(logicalBytes, root0, root1, root2, growingThread) : LuaAllocationRecovery::CurrentOrFresh;
	assistSweepBeforeReservation(bytes);
	for (;;) {
		if (const u32 block = m_cpu.heapAllocator().allocate(bytes, true)) return block;
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2, growingThread);
	}
}

u32 LuaHeap::allocateThreadRecord(u32 entry) {
	constexpr u32 valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	constexpr u32 frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const u32 charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const Value root = entry != 0u ? valueClosure(entry) : valueNil();
	auto recovery = admit(charged, root);
	assistSweepBeforeReservation(charged + GC_OBJECT_PREFIX);
	auto& arena = m_cpu.heapAllocator();
	for (;;) {
		if (const u32 block = arena.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false)) {
			if (const u32 values = arena.allocate(valueBytes, true)) {
				if (const u32 frames = arena.allocate(frameBytes, true)) {
					const u32 address = block + GC_OBJECT_PREFIX;
					auto& gc = m_cpu.gcHeap();
					ThreadRecord::initialize(gc, address, values, frames, entry);
					gc.publishObject(address);
					accountAllocation(charged);
					return address;
				}
				arena.free(values);
			}
			arena.free(block);
		}
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root);
	}
}

u32 LuaHeap::reserveThreadControls(u32 address, ThreadField field, u32 capacity, u32 previous, Value root) {
	const u32 stride = field == ThreadField::FrameBlock ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
	auto recovery = admit((capacity - previous) * stride, root, valueNil(), valueNil(), address);
	assistSweepBeforeReservation(capacity * stride);
	for (;;) {
		if (const u32 block = ThreadRecord::growControls(m_cpu.gcHeap(), address, field, capacity)) return block;
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root, valueNil(), valueNil(), address);
	}
}

void LuaHeap::reserveThreadFrameStorage(u32 address, u32 valueCapacity, u32 frameCapacity, Value root) {
	const u32 valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
	const u32 frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
	const auto& memory = m_cpu.memory();
	const u32 previousValues = valueCapacity != 0u ? ThreadRecord::read(memory, address, ThreadField::StackCapacity) * THREAD_STACK_SLOT_BYTES : 0u;
	const u32 previousFrames = frameCapacity != 0u ? ThreadRecord::count(memory, address, ThreadField::FrameCapacity) * FRAME_CONTROL_BYTES : 0u;
	if (!valueBytes && frameBytes) {
		reserveThreadControls(address, ThreadField::FrameBlock, frameCapacity, previousFrames / FRAME_CONTROL_BYTES, root);
		return;
	}
	const u32 requested = valueBytes + frameBytes, previous = previousValues + previousFrames;
	auto recovery = requested > previous
		? admit(requested - previous, root, valueNil(), valueNil(), address)
		: LuaAllocationRecovery::CurrentOrFresh;
	assistSweepBeforeReservation(requested);
	auto& arena = m_cpu.heapAllocator();
	for (;;) {
		// Stage control storage first: a successful realloc can consume the
		// old stack. There must be no fallible reservation after that point.
		const u32 frames = frameBytes ? arena.allocate(frameBytes, true) : 0u;
		if (!frameBytes || frames) {
			if (!valueBytes || ThreadRecord::resizeStackBacking(m_cpu.gcHeap(), address, valueCapacity)) {
				if (frames) ThreadRecord::growControls(m_cpu.gcHeap(), address, ThreadField::FrameBlock, frameCapacity, frames);
				return;
			}
			if (frames) arena.free(frames);
		}
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root, valueNil(), valueNil(), address);
	}
}

u32 LuaHeap::allocateClosureRecord(u32 captures, bool latched, std::span<u32> cells) {
	const u32 bytes = closureRecordBytes(captures, latched);
	const u32 charged = bytes + static_cast<u32>(cells.size()) * UPVALUE_HEAP_BYTES;
	auto recovery = admit(charged, valueNil(), valueNil(), valueNil(), 0u);
	assistSweepBeforeReservation(charged + GC_OBJECT_PREFIX * (1u + cells.size()));
	auto& arena = m_cpu.heapAllocator();
	for (;;) {
		if (const u32 closure = arena.allocate(bytes + GC_OBJECT_PREFIX, false)) {
			size_t count = 0;
			for (; count < cells.size(); ++count) {
				const u32 cell = arena.allocate(UPVALUE_HEAP_BYTES + GC_OBJECT_PREFIX, false);
				if (!cell) break;
				cells[count] = cell + GC_OBJECT_PREFIX;
			}
			if (count == cells.size()) {
				auto& memory = m_cpu.memory();
				auto& gc = m_cpu.gcHeap();
				const u8 white = gc.white();
				for (u32 cell : cells) {
					Upvalue::initialize(memory, cell, white);
					gc.publishObject(cell);
				}
				accountAllocation(charged);
				return closure + GC_OBJECT_PREFIX;
			}
			while (count != 0) arena.free(cells[--count] - GC_OBJECT_PREFIX);
			arena.free(closure);
		}
		recovery = m_cpu.gcHeap().recoverAllocation(recovery);
	}
}

void LuaHeap::collectRuntime(Value root0, Value root1, Value root2, u32 growingThread) {
	m_cpu.collectHeap(root0, root1, root2, growingThread);
}

bool LuaHeap::stepRuntime() {
	m_cpu.stepHeap(valueNil(), valueNil(), valueNil());
	creditStep();
	return !m_cpu.collecting();
}

void LuaHeap::accountAllocation(u32 bytes) {
	auto& memory = m_cpu.memory();
	memory.writeRamRecordWord(m_occupiedAddress, memory.readRamRecordWord(m_occupiedAddress) + bytes);
}

void LuaHeap::releaseRecord(u32 address, u32 bytes) {
	m_cpu.heapAllocator().free(address);
	auto& memory = m_cpu.memory();
	memory.writeRamRecordWord(m_occupiedAddress, memory.readRamRecordWord(m_occupiedAddress) - bytes);
}

void LuaHeap::releaseObject(u32 address, u32 bytes) {
	m_cpu.memory().writeRamRecordByte(address, 0u);
	releaseRecord(address - GC_OBJECT_PREFIX, bytes);
}

void LuaHeap::replaceRecord(u32 oldAddress, u32 oldBytes, u32 newBytes) {
	if (oldAddress != 0u) m_cpu.heapAllocator().free(oldAddress);
	resizeRecordCharge(oldBytes, newBytes);
}

void LuaHeap::resizeRecordCharge(u32 oldBytes, u32 newBytes) {
	if (oldBytes != newBytes) {
		auto& memory = m_cpu.memory();
		memory.writeRamRecordWord(m_occupiedAddress, memory.readRamRecordWord(m_occupiedAddress) - oldBytes + newBytes);
	}
}

void LuaHeap::creditStep() {
	if (m_cpu.collecting()) setCollectionTarget(static_cast<u32>(usedBytes() + GC_ASSIST_BYTES));
}

size_t LuaHeap::capacity() const {
	return m_cpu.heapAllocator().capacityBytes();
}

void LuaHeap::finishCollection() {
	const size_t liveBytes = usedBytes();
	const size_t limit = capacity();
	setCollectionTarget(static_cast<u32>(std::max(liveBytes + GC_ASSIST_BYTES,
		std::min(limit - (limit >> COLLECTION_RESERVE_SHIFT), std::max(MIN_COLLECTION_BYTES, liveBytes * 2)))));
}

} // namespace bmsx
