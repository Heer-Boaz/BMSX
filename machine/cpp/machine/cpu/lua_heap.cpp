#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/upvalue.h"

namespace bmsx {

#if defined(BMSX_GC_STRESS)
// Defined by the stress runner. Only its allocator translation unit uses this
// seam; ordinary cores contain neither a callback nor a runtime mode check.
void stressHeapAllocation(LuaHeap& heap);
#endif

LuaHeap::LuaHeap(CPU& cpu)
	: m_cpu(cpu), m_targetAddress(cpu.heapAllocator().managementOffset() + HEAP_COLLECTION_TARGET_OFFSET),
	  m_occupiedAddress(cpu.heapAllocator().managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET) {
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

bool LuaHeap::admit(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread) {
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	const size_t limit = capacity();
	const size_t nextBytes = usedBytes() + byteCount;
	const bool exhausted = nextBytes > limit;
	if (!exhausted && nextBytes <= collectionTarget()) return false;
	if (exhausted) {
		collectRuntime(root0, root1, root2, growingThread);
	} else if (!m_cpu.gcHeap().finalMarkPending()) {
		const size_t work = m_cpu.stepHeap(root0, root1, root2, growingThread);
		m_cpu.instructionBudgetRemaining -= static_cast<int>(work);
		creditStep(work);
	}
	if (usedBytes() + byteCount > limit) throw LuaOutOfMemorySignal{};
	return exhausted;
}

u32 LuaHeap::allocateRecord(u32 bytes, bool owned, u32 backingBytes, u32 backingField,
	Value root0, Value root1, Value root2) {
	const u32 charged = bytes + backingBytes;
	const bool collected = admit(charged, root0, root1, root2, 0u);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		const u32 address = arena.allocate(bytes, owned);
		if (address) {
			const u32 backing = backingBytes ? arena.allocate(backingBytes, true) : 0u;
			if (!backingBytes || backing) {
				if (backingField) m_cpu.memory().writeRamRecordWord(address + backingField, backing);
				accountAllocation(charged);
				return address;
			}
			arena.free(address);
		}
		if (attempt == 0) collectRuntime(root0, root1, root2);
	}
	throw LuaOutOfMemorySignal{};
}

u32 LuaHeap::allocateStack(u32 bytes, u32 threadAddress, Value root) {
	const bool collected = admit(bytes, root, valueNil(), valueNil(), threadAddress);
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		if (const u32 block = m_cpu.heapAllocator().allocate(bytes, true)) {
					return block;
		}
		if (attempt == 0) collectRuntime(root, valueNil(), valueNil(), threadAddress);
	}
	throw LuaOutOfMemorySignal{};
}

u32 LuaHeap::allocateThreadRecord(u32 entry) {
	constexpr u32 valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	constexpr u32 frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const u32 charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const Value root = entry != 0u ? valueClosure(entry) : valueNil();
	const bool collected = admit(charged, root);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		if (const u32 address = arena.allocate(THREAD_HEAP_BYTES, false)) {
			if (const u32 values = arena.allocate(valueBytes, true)) {
				if (const u32 frames = arena.allocate(frameBytes, true)) {
					ThreadRecord::initialize(m_cpu.gcHeap(), address, values, frames, entry);
					accountAllocation(charged);
					return address;
				}
				arena.free(values);
			}
			arena.free(address);
		}
		if (attempt == 0) collectRuntime(root);
	}
	throw LuaOutOfMemorySignal{};
}

void LuaHeap::reserveThreadFrameStorage(u32 address, u32 valueCapacity, u32 frameCapacity, Value root) {
	const u32 valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
	const u32 frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
	const u32 charged = valueBytes + frameBytes;
	const bool collected = admit(charged, root, valueNil(), valueNil(), address);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		const u32 values = valueBytes != 0u ? arena.allocate(valueBytes, true) : 0u;
		if (valueBytes == 0u || values != 0u) {
			const u32 frames = frameBytes != 0u ? arena.allocate(frameBytes, true) : 0u;
			if (frameBytes == 0u || frames != 0u) {
				if (values != 0u) ThreadRecord::replaceStack(m_cpu.gcHeap(), address, values, valueCapacity);
				if (frames != 0u) ThreadRecord::replaceControls(m_cpu.gcHeap(), address, ThreadField::FrameBlock, frames, frameCapacity);
				return;
			}
			if (values != 0u) arena.free(values);
		}
		if (attempt == 0) collectRuntime(root, valueNil(), valueNil(), address);
	}
	throw LuaOutOfMemorySignal{};
}

u32 LuaHeap::allocateClosureRecord(u32 captures, bool latched, std::span<u32> cells) {
	const u32 bytes = closureRecordBytes(captures, latched);
	const u32 charged = bytes + static_cast<u32>(cells.size()) * UPVALUE_HEAP_BYTES;
	const bool collected = admit(charged, valueNil(), valueNil(), valueNil(), 0u);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		if (const u32 closure = arena.allocate(bytes, false)) {
			size_t count = 0;
			for (; count < cells.size(); ++count) {
				const u32 cell = arena.allocate(UPVALUE_HEAP_BYTES, false);
				if (!cell) break;
				cells[count] = cell;
			}
			if (count == cells.size()) {
				auto& memory = m_cpu.memory();
				const u8 white = m_cpu.gcHeap().white();
				for (u32 cell : cells) Upvalue::initialize(memory, cell, white);
				accountAllocation(charged);
				return closure;
			}
			while (count != 0) arena.free(cells[--count]);
			arena.free(closure);
		}
		if (attempt == 0) collectRuntime();
	}
	throw LuaOutOfMemorySignal{};
}

void LuaHeap::collectRuntime(Value root0, Value root1, Value root2, u32 growingThread) {
	m_cpu.instructionBudgetRemaining -= static_cast<int>(m_cpu.collectHeap(root0, root1, root2, growingThread));
}

bool LuaHeap::stepRuntime() {
	const size_t work = m_cpu.stepHeap(valueNil(), valueNil(), valueNil());
	m_cpu.instructionBudgetRemaining -= static_cast<int>(work);
	creditStep(work);
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

void LuaHeap::replaceRecord(u32 oldAddress, u32 oldBytes, u32 newBytes) {
	if (oldAddress != 0u) m_cpu.heapAllocator().free(oldAddress);
	auto& memory = m_cpu.memory();
	memory.writeRamRecordWord(m_occupiedAddress, memory.readRamRecordWord(m_occupiedAddress) - oldBytes + newBytes);
}

void LuaHeap::creditStep(size_t work) {
	if (m_cpu.collecting()) setCollectionTarget(static_cast<u32>(usedBytes() + std::max(GC_ASSIST_BYTES, work / 16)));
}

size_t LuaHeap::capacity() const {
	return m_cpu.heapAllocator().capacityBytes();
}

void LuaHeap::finishCollection() {
	const size_t liveBytes = usedBytes();
	const size_t limit = capacity();
	setCollectionTarget(static_cast<u32>(std::max(liveBytes + GC_ASSIST_BYTES,
		std::min(limit - limit / 8, std::max(MIN_COLLECTION_BYTES, liveBytes * 2)))));
}

} // namespace bmsx
