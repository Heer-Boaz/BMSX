#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
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

i32 LuaHeap::allocationDebt(size_t byteCount) const noexcept {
	const size_t nextBytes = usedBytes() + byteCount;
	if (nextBytes > capacity()) return -1;
	const u32 target = collectionTarget();
	if (nextBytes <= target
		|| GcHeap::decodePhase(m_cpu.memory().readRamRecordByte(m_gcControlAddress)) >= GcPhase::Atomic)
		return 0;
	return static_cast<i32>(nextBytes - target);
}

bool LuaHeap::logicalAssistPressure(size_t byteCount) const {
	const size_t limit = capacity();
	return usedBytes() + byteCount > limit - (limit >> COLLECTION_RESERVE_SHIFT);
}

size_t LuaHeap::logicalAssistAllowance(size_t debt, bool pressure) {
	return pressure ? GC_STEP_WORDS : std::min(GC_STEP_WORDS, std::max(GC_ASSIST_MIN_WORDS, (debt + 1u) >> 1u));
}

void LuaHeap::creditLogicalAssist(size_t byteCount, size_t debt, bool pressure, size_t work) {
	if (!work || !m_cpu.collecting()) return;
	if (pressure) {
		setCollectionTarget(usedBytes() + GC_ASSIST_BYTES * std::min(work, GC_STEP_WORDS) / GC_STEP_WORDS);
	} else {
		// Two work bytes per allocation byte, four work bytes per word.
		const size_t limit = capacity(), reserveEdge = limit - (limit >> COLLECTION_RESERVE_SHIFT);
		const size_t credited = usedBytes() + byteCount + 2u * work;
		setCollectionTarget(static_cast<u32>(std::min(reserveEdge, credited > debt ? credited - debt : 0u)));
	}
}

bool LuaHeap::canAdmitWithoutAssist(size_t byteCount) const noexcept {
#if defined(BMSX_GC_STRESS)
	(void)byteCount;
	return false;
#else
	return allocationDebt(byteCount) == 0;
#endif
}

bool LuaHeap::prepareAllocation(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread, const int* sourceBudget) {
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	const i32 debt = allocationDebt(byteCount);
	if (debt < 0) return false;
	if (debt > 0) {
		const bool pressure = logicalAssistPressure(byteCount);
		const size_t words = logicalAssistAllowance(debt, pressure);
		const size_t work = m_cpu.assistAllocation(root0, root1, root2, growingThread, words, sourceBudget);
		creditLogicalAssist(byteCount, debt, pressure, work);
	}
	return true;
}

bool LuaHeap::prepareFixedAllocation(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread) {
	if (prepareAllocation(byteCount, root0, root1, root2, growingThread)) return true;
	if (byteCount > capacity()) throw LuaOutOfMemorySignal{};
	return false;
}

LuaAllocationRecovery LuaHeap::admit(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread) {
	auto recovery = LuaAllocationRecovery::CurrentOrFresh;
	if (!prepareFixedAllocation(byteCount, root0, root1, root2, growingThread)) {
		do {
			recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2, growingThread);
		} while (usedBytes() + byteCount > capacity());
	}
	return recovery;
}

void LuaHeap::assistBeforeReservation(size_t requested, Value root0, Value root1, Value root2, u32 growingThread) {
	// BIOS string keys are created before the collector view is bound.
	// The RAM phase latch already belongs to the initialized heap arena.
	if (GcHeap::pacedPhase(GcHeap::decodePhase(m_cpu.memory().readRamRecordByte(m_gcControlAddress))))
		m_cpu.gcHeap().assistBeforeReservation(requested, root0, root1, root2, growingThread);
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
	const u32 physical = bytes + (object ? GC_OBJECT_PREFIX : 0u) + backingBytes + secondBytes;
	const auto admission = admitRecordAllocation(charged, physical, mode, root0, root1, root2);
	if (!admission) return 0u;
	if (mode != LuaAllocationMode::Direct)
		return reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField);
	auto recovery = *admission;
	for (;;) {
		if (const u32 address = reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField)) return address;
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2);
	}
}

std::optional<LuaAllocationRecovery> LuaHeap::admitRecordAllocation(u32 charged, u32 physical, LuaAllocationMode mode,
	Value root0, Value root1, Value root2) {
	if (mode != LuaAllocationMode::Direct) {
		const bool admitted = mode == LuaAllocationMode::Scheduled
			? prepareFixedAllocation(charged, root0, root1, root2)
			: usedBytes() + charged <= capacity();
		if (!admitted) return std::nullopt;
		if (mode == LuaAllocationMode::Scheduled)
			assistBeforeReservation(physical, root0, root1, root2);
		return LuaAllocationRecovery::CurrentOrFresh;
	}
	const auto recovery = admit(charged, root0, root1, root2);
	assistBeforeReservation(physical, root0, root1, root2);
	return recovery;
}

u32 LuaHeap::reserveBacking(u32 bytes, u32 logicalBytes, Value root0, Value root1, Value root2, u32 growingThread) {
	auto recovery = logicalBytes != 0u ? admit(logicalBytes, root0, root1, root2, growingThread) : LuaAllocationRecovery::CurrentOrFresh;
	assistBeforeReservation(bytes, root0, root1, root2, growingThread);
	for (;;) {
		if (const u32 block = m_cpu.heapAllocator().allocate(bytes, true)) return block;
		recovery = m_cpu.gcHeap().recoverAllocation(recovery, root0, root1, root2, growingThread);
	}
}

u32 LuaHeap::reserveThreadControls(u32 address, ThreadField field, u32 capacity, u32 previous, Value root) {
	const u32 stride = field == ThreadField::FrameBlock ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
	auto recovery = admit((capacity - previous) * stride, root, valueNil(), valueNil(), address);
	assistBeforeReservation(capacity * stride, root, valueNil(), valueNil(), address);
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
	assistBeforeReservation(requested, root, valueNil(), valueNil(), address);
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
	assistBeforeReservation(charged + GC_OBJECT_PREFIX * (1u + cells.size()));
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
	m_cpu.chargeCollectionWork(m_cpu.collectHeap(root0, root1, root2, growingThread));
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
