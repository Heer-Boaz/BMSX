#pragma once

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
enum class GcRootBank : u32 { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, End };

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
// The major trace owns one suspended record ahead of the gray queue.
inline constexpr u32 GC_TRACE_RECORD = 0x34u;
inline constexpr u32 GC_TRACE_CURSOR = GC_TRACE_RECORD + sizeof(u32);
inline constexpr u32 GC_ROOT_CURSOR = GC_TRACE_CURSOR + sizeof(u32);
inline constexpr u32 GC_THREAD_TRACE_OPEN = GC_ROOT_CURSOR + sizeof(u32);
inline constexpr u32 GC_THREAD_TRACE_TOP = GC_THREAD_TRACE_OPEN + sizeof(u32);
inline constexpr u32 GC_THREAD_TRACE_BILLED = GC_THREAD_TRACE_TOP + sizeof(u32);
// Independent of the weak-list head: remark revisits without consuming it.
inline constexpr u32 GC_REMARK_VISIT_INDEX = GC_THREAD_TRACE_BILLED + sizeof(u32);
inline constexpr u32 GC_REMARK_VISIT_STATE = GC_REMARK_VISIT_INDEX + sizeof(u32);
inline constexpr u32 GC_MODE_META = GC_REMARK_VISIT_STATE + sizeof(u32);
inline constexpr u32 GC_MODE_NODE = GC_MODE_META + sizeof(u32);
inline constexpr u32 GC_MODE_REMAINING = GC_MODE_NODE + sizeof(u32);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_TRACE_RECORD) % (2 * sizeof(u32)) == 0u);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_REMARK_VISIT_INDEX) % (2 * sizeof(u32)) == 0u);
inline constexpr u32 GC_VISIT_HEADER_BYTE = 3u;
inline constexpr u8 GC_VISIT_MEMBER = 0x40u;

class GcHeap {
public:
	GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings, StringId modeKey)
		: budget(budget), memory(memory), arena(arena), m_cpu(cpu), m_modeKey(modeKey), m_stringPool(strings),
		  m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}
	LuaHeap& budget;
	Memory& memory;
	HeapAllocator& arena;
	u32 tableRecordAddress(u32 address) const;
	u32 cellRecordAddress(u32 address) const;
	u32 closureRecordAddress(u32 address) const;
	u32 threadRecordAddress(u32 address) const;
	u32 openCellAddress(u32 address) const;
	GcPhase phase() const {
		// Two unconnected selector inputs do not clock the collector.
		constexpr std::array phases{GcPhase::Pause, GcPhase::Mark, GcPhase::MarkAgain, GcPhase::Atomic,
			GcPhase::Sweep, GcPhase::Strings, GcPhase::Pause, GcPhase::Pause};
		return phases[memory.readRamRecordByte(m_controlOffset) & 7u];
	}
	u8 white() const { return memory.readRamRecordByte(m_controlOffset + 1u) & 1u; }
	bool active() const { return phase() != GcPhase::Pause; }
	bool finalMarkPending() const { return phase() == GcPhase::Atomic; }
	bool sweepGarbage(u32 address) const {
		return phase() == GcPhase::Sweep && markColor(address) == (white() ^ 1u);
	}
	bool isAlive(u32 address) const { return !unmarked(memory.readRamRecordByte(address + GC_COLOR_OFFSET)); }
	size_t allocationBytes(u32 threadAddress) const;
	size_t step(Value root0, Value root1, Value root2, u32 growingThread = 0u, bool compactThreads = false);
	// Only the stopped mutator may advance the final pass.
	size_t stepFinalMark(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	size_t finishFinalMark(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	size_t collect(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	size_t collectYoung(Value root0, Value root1, Value root2);
	void markString(StringId id) { m_stringPool.markReachable(id, m_minor); }
	bool markValue(Value value);
	bool markThread(u32 address);
	void writeValueBarrier(u32 address, u32 link, ValueTag tag) {
		if (valueTagHasGcEdge(tag)) writeBarrier(address, link);
	}
	void writeBarrier(u32 address, u32 link) {
		writeBarrier(address, link, memory.readRamRecordByte(address + GC_COLOR_OFFSET));
	}
	// Native writes may already have latched the collector flags.
	void writeBarrier(u32 address, u32 link, u8 flags) {
		if ((flags & (GC_OLD | GC_REMEMBERED)) == GC_OLD) {
			arena.trackGcPage(HeapGcPages::Remembered, address);
			flags |= GC_REMEMBERED;
			memory.writeRamRecordByte(address + GC_COLOR_OFFSET, flags);
		}
		if ((flags & GC_COLOR_MASK) == 3u) enqueue(address, link, GC_CHANGED_HEAD);
	}
	void tableEntriesMoved(u32 address);
	u32 changedHeadOffset() const { return m_controlOffset + GC_CHANGED_HEAD; }
private:
	enum class RemarkStage : u32 { None, Threads, Weak, Roots, Trace, ClearWeak };
	u8 markColor(u32 address) const { return memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK; }
	bool unmarked(u8 flags) const { return (flags & (GC_COLOR_MASK | (m_minor ? GC_OLD : 0))) == white(); }
	void color(u32 address, u8 mark) {
		const u32 lane = address + GC_COLOR_OFFSET;
		memory.writeRamRecordByte(lane, (memory.readRamRecordByte(lane) & ~GC_COLOR_MASK) | mark);
	}
	bool markClosure(u32 address);
	uint8_t tableWeakMode(const TableRecord& table);
	u8 weakModeBits(Value value);
	int probeTableMode(const TableRecord&, size_t limit);
	bool markTable(u32 address);
	size_t traceTable(u32 address, size_t limit, bool resumingMode = false);
	void traceTableEdges(const TableRecord&, u8 mode, u32 first = 0u, u32 end = UINT32_MAX);
	size_t traceTableEntries(const TableRecord&, u8 mode, u32 next, size_t work, size_t limit);
	bool valueIsAlive(Value value) const;
	u32 indexWord(u32 queue) const { return memory.readRamRecordWord(m_controlOffset + queue) & GC_GRAY_INDEX_MASK; }
	void enqueue(u32 address, u32 link, u32 queue);
	void appendVisit(u32 list, u32 address);
	void setVisitLink(u32 address, u8 meta, u32 index);
	template<u8 Kind, bool Drain, class Visitor>
	size_t visitList(u32 list, Visitor&& visitor, size_t allowance = SIZE_MAX, RemarkStage stage = RemarkStage::None);
	void requeueVisited(u32 address);
	size_t markCell(u32 cell);
	size_t trace(bool atomic, size_t limit = SIZE_MAX);
	size_t traceRootBanks(size_t limit);
	size_t traceCaptures(u32 closure, u32 next, u32 count, size_t work, size_t limit);
	size_t traceThread(u32 thread, bool atomic, size_t limit, u32 cursor, u32 open, u32 captureTop, u32 billed);
	size_t resumeTrace(u32 record, bool atomic, size_t limit);
	size_t traceQuantum(bool atomic, size_t& limit, size_t work);
	size_t remarkVisits(size_t allowance);
	size_t remarkRoots(Value root0, Value root1, Value root2, size_t allowance, bool final);
	RemarkStage remarkStage() const {
		return static_cast<RemarkStage>(memory.readRamRecordWord(m_controlOffset + GC_REMARK_VISIT_STATE) >> GC_GRAY_INDEX_BITS);
	}
	void setRemarkStage(RemarkStage stage) {
		memory.writeRamRecordWord(m_controlOffset + GC_REMARK_VISIT_STATE, static_cast<u32>(stage) << GC_GRAY_INDEX_BITS);
	}
	void clearWeakRange(TableRecord& table, u8 mode, u32 first, u32 end);
	size_t clearWeakQuantum(size_t limit);
	size_t resolveWeak();
	static i32 seedRemembered(void*, u32 address);
	static i32 seedThread(void*, u32 address);
	struct SweepContext { GcHeap& heap; u32 growingThread; u8 white; bool compactThreads = false; };
	static i32 sweepRecord(void* context, u32 address);
	CPU& m_cpu;
	void setPhase(GcPhase phase) { memory.writeRamRecordByte(m_controlOffset, static_cast<u8>(phase)); }
	StringId m_modeKey;
	StringPool& m_stringPool;
	const u32 m_controlOffset;
	bool m_minor = false; // A small collection is synchronous; only RAM state crosses a grant.
	size_t m_modeProbeWork = 0; // Current quantum only; the actual probe frontier lives in RAM.

};

inline u32 asClosure(Value value, const GcHeap& heap) { return heap.closureRecordAddress(valuePayload(value)); }
inline u32 asThread(Value value, const GcHeap& heap) { return heap.threadRecordAddress(valuePayload(value)); }
} // namespace bmsx
