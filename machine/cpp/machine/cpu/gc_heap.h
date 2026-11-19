#pragma once

#include <vector>
#include "common/compiler.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/table.h"
#include "machine/cpu/thread.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/lua_heap.h"

namespace bmsx {
class CPU;
// Collector work is measured in 32-bit pool words, not host time.
inline constexpr size_t GC_STEP_WORDS = 4096;
inline constexpr size_t GC_ASSIST_BYTES = 256;
enum class GcPhase : u32 { Pause, Mark, MarkAgain, Atomic, Sweep, Strings };

// Physical records start on an eight-byte boundary, including size-class slots.
inline constexpr u32 GC_RECORD_ALIGNMENT = 1u << GC_RECORD_SHIFT;
inline constexpr u32 GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
static_assert(GC_GRAY_INDEX_MASK == GC_RECORD_MASK >> GC_RECORD_SHIFT);
inline constexpr u32 GC_TRACE_HEAD = 4u;
inline constexpr u32 GC_CHANGED_HEAD = 8u;
// Each visit list has a head, tail and record count. The first two words
// start on a pair boundary. Offsets are relative to HEAP_GC_CONTROL_OFFSET.
inline constexpr u32 GC_THREAD_VISITS = 12u;
inline constexpr u32 GC_WEAK_VISITS = 28u;
inline constexpr u32 GC_VISIT_TAIL = 4u;
inline constexpr u32 GC_VISIT_COUNT = 8u;
inline constexpr u32 GC_VISIT_HEADER_BYTE = 3u;
inline constexpr u8 GC_VISIT_MEMBER = 0x40u;

class GcHeap {
public:
	GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings, StringId modeKey)
		: budget(budget), memory(memory), arena(arena), m_cpu(cpu), m_modeKey(modeKey), m_stringPool(strings),
		  m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}
	~GcHeap();
	LuaHeap& budget;
	Memory& memory;
	HeapAllocator& arena;
	u32 tableRecordAddress(u32 address) const;
	u32 cellRecordAddress(u32 address) const;
	u32 closureRecordAddress(u32 address) const;
	u32 openCellAddress(u32 address) const;
	Thread* threadAt(u32 address) const {
		const u32 offset = address & GC_RECORD_MASK;
		return (offset & (THREAD_HEAP_BYTES - 1u)) == 0u ? m_threadsBySlot[offset / THREAD_HEAP_BYTES] : nullptr;
	}
	Thread* attachThread(u32 address);
	void discardAttachments(Thread* retainedRoot);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeControlOffset();
#endif
	uint32_t hash(Value value) const {
		switch (valueTag(value)) {
			case ValueTag::Table: case ValueTag::Closure: case ValueTag::Thread:
				return scalarValueHash(valueInteger(static_cast<i32>(valuePayload(value))));
			default: return scalarValueHash(value);
		}
	}
	template<class Visitor> void visitThreads(Visitor&& visit) {
		for (auto* thread = m_attachedThreads; thread; thread = thread->nextAttached) visit(*thread);
	}
	GcPhase phase() const {
		// Two unconnected selector inputs do not clock the collector.
		constexpr std::array phases{GcPhase::Pause, GcPhase::Mark, GcPhase::MarkAgain, GcPhase::Atomic,
			GcPhase::Sweep, GcPhase::Strings, GcPhase::Pause, GcPhase::Pause};
		return phases[memory.readRamRecordByte(m_controlOffset) & 7u];
	}
	u8 white() const { return memory.readRamRecordByte(m_controlOffset + 1u) & 1u; }
	bool active() const { return phase() != GcPhase::Pause; }
	bool sweepGarbage(u32 address) const {
		return phase() == GcPhase::Sweep && memory.readRamRecordByte(address + GC_COLOR_OFFSET) == (white() ^ 1u);
	}
	bool isAlive(u32 address) const { return memory.readRamRecordByte(address + GC_COLOR_OFFSET) != white(); }
	size_t allocationBytes(const Thread* thread) const;
	void armThreadStackWatches();
	bool observeStackWrites(u32 first, u32 end, const Thread* active);
	size_t step(Value root0, Value root1, Value root2, Thread* growingStack = nullptr);
	size_t collect(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), Thread* growingStack = nullptr);
	bool markValue(Value value);
	bool markThread(Thread* thread);
	void writeBarrier(u32 address, u32 link) {
		if (memory.readRamRecordByte(address + GC_COLOR_OFFSET) == 3u) enqueue(address, link, GC_CHANGED_HEAD);
	}
	u32 changedHeadOffset() const { return m_controlOffset + GC_CHANGED_HEAD; }
private:
	Thread*& threadSlot(u32 address) { return m_threadsBySlot[(address & GC_RECORD_MASK) / THREAD_HEAP_BYTES]; }
	void trackThread(Thread* thread);
	bool markClosure(u32 address);
	uint8_t tableWeakMode(const TableRecord& table);
	bool markTable(u32 address);
	size_t traceTable(u32 address);
	bool valueIsAlive(Value value) const;
	u32 indexWord(u32 queue) const { return memory.readRamRecordWord(m_controlOffset + queue) & GC_GRAY_INDEX_MASK; }
	void enqueue(u32 address, u32 link, u32 queue);
	void appendVisit(u32 list, u32 address);
	void setVisitLink(u32 address, u8 meta, u32 index);
	template<u8 Kind, bool Drain, class Visitor>
	size_t visitList(u32 list, Visitor&& visitor);
	size_t markCell(u32 cell);
	size_t trace(bool atomic);
	size_t remark(Value root0, Value root1, Value root2);
	size_t atomic(Value root0, Value root1, Value root2);
	struct SweepContext { GcHeap& heap; const Thread* growingStack; u8 white; };
	static i32 sweepRecord(void* context, u32 address);
	void unlinkThread(Thread* thread);
	CPU& m_cpu;
	Thread* m_attachedThreads = nullptr;
	void setPhase(GcPhase phase) { memory.writeRamRecordByte(m_controlOffset, static_cast<u8>(phase)); }
	StringId m_modeKey;
	StringPool& m_stringPool;
	const u32 m_controlOffset;
	// Only Thread execution views need a host attachment. Other kinds are
	// resolved from RAM; 64-byte Thread slots index this directory directly.
	std::vector<Thread*> m_threadsBySlot = std::vector<Thread*>(MAIN_RAM_SIZE / THREAD_HEAP_BYTES);
};

inline u32 asClosure(Value value, const GcHeap& heap) { return heap.closureRecordAddress(valuePayload(value)); }
inline Thread* asThread(Value value, const GcHeap& heap) { return heap.threadAt(valuePayload(value)); }
} // namespace bmsx
