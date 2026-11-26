#pragma once

#include <utility>

#include "common/compiler.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/thread.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/lua_heap.h"

namespace bmsx {
class CPU;
class TableRecord;
// Collector work is measured in 32-bit pool words, not host time.
inline constexpr int GC_WORK_WORD_CYCLES = 3;
inline constexpr size_t GC_STEP_WORDS = 4096;
inline constexpr size_t GC_ASSIST_BYTES = 256;
enum class GcPhase : u32 { Pause, Mark, MarkAgain, Atomic, Sweep, Strings };
enum class GcRootBank : u32 { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, Completion, ConcatOperands, End };

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
inline constexpr u32 GC_THREAD_TRACE_OPEN = GC_TRACE_CURSOR + sizeof(u32);
inline constexpr u32 GC_THREAD_TRACE_TOP = GC_THREAD_TRACE_OPEN + sizeof(u32);
// Independent of the weak-list head: remark revisits without consuming it.
inline constexpr u32 GC_REMARK_VISIT_INDEX = GC_THREAD_TRACE_TOP + sizeof(u32);
inline constexpr u32 GC_REMARK_VISIT_STATE = GC_REMARK_VISIT_INDEX + sizeof(u32);
inline constexpr u32 GC_MODE_META = GC_REMARK_VISIT_STATE + sizeof(u32);
inline constexpr u32 GC_MODE_NODE = GC_MODE_META + sizeof(u32);
inline constexpr u32 GC_MODE_REMAINING = GC_MODE_NODE + sizeof(u32);
inline constexpr u32 GC_ROOT_CURSOR = GC_MODE_REMAINING + sizeof(u32);
inline constexpr u32 GC_EPOCH_WORK = GC_ROOT_CURSOR + sizeof(u32);
inline constexpr u32 GC_LAST_EPOCH_WORK = GC_EPOCH_WORK + sizeof(u32);
inline constexpr u32 GC_PHYSICAL_OCCUPIED_AT_TICK = GC_LAST_EPOCH_WORK + sizeof(u32);
inline constexpr u32 GC_PHYSICAL_ASSIST = GC_PHYSICAL_OCCUPIED_AT_TICK + sizeof(u32);
inline constexpr u32 GC_OBJECTS = GC_PHYSICAL_ASSIST + sizeof(u32);
inline constexpr u32 GC_OBJECT_COUNT = GC_OBJECTS + sizeof(u32);
inline constexpr u32 GC_SWEEP_LINK = GC_OBJECT_COUNT + sizeof(u32);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_OBJECTS) % (2 * sizeof(u32)) == 0u);
inline constexpr u32 GC_PACE_BASIS = GC_SWEEP_LINK + sizeof(u32);
inline constexpr u32 GC_PACE_ESTIMATE = GC_PACE_BASIS + sizeof(u32);
inline constexpr u32 GC_PACE_RUNWAY = GC_PACE_ESTIMATE + sizeof(u32);
inline constexpr u32 GC_PACE_PAID = GC_PACE_RUNWAY + sizeof(u32);
inline constexpr u32 GC_PACE_PAY_AT = GC_PACE_PAID + sizeof(u32);
inline constexpr u32 GC_FULL_EPOCHS = GC_PACE_PAY_AT + sizeof(u32);
static_assert(HEAP_GC_CONTROL_OFFSET + GC_FULL_EPOCHS + sizeof(u32) <= HEAP_LOGICAL_OCCUPIED_OFFSET);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_TRACE_RECORD) % (2 * sizeof(u32)) == 0u);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_THREAD_TRACE_OPEN) % (2 * sizeof(u32)) == 0u);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_REMARK_VISIT_INDEX) % (2 * sizeof(u32)) == 0u);
static_assert((HEAP_GC_CONTROL_OFFSET + GC_EPOCH_WORK) % (2 * sizeof(u32)) == 0u);
inline constexpr u32 GC_VISIT_HEADER_BYTE = 3u;
inline constexpr u8 GC_VISIT_MEMBER = 0x40u;

class GcHeap {
public:
	GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings);
	LuaHeap& budget;
	Memory& memory;
	HeapAllocator& arena;
	const StringId indexKey;
	const StringId newIndexKey;
	const StringId lengthKey;
	void publishObject(u32 address);
	using ObjectVisitor = void (*)(void*, u32);
	void visitObjectRecords(void* context, ObjectVisitor visit) const;
	u32 tableRecordAddress(u32 address) const;
	u32 cellRecordAddress(u32 address) const;
	u32 closureRecordAddress(u32 address) const;
	u32 threadRecordAddress(u32 address) const;
	u32 openCellAddress(u32 address) const;
	static GcPhase decodePhase(u8 word) {
		// Two unconnected selector inputs do not clock the collector.
		constexpr std::array phases{GcPhase::Pause, GcPhase::Mark, GcPhase::MarkAgain, GcPhase::Atomic,
			GcPhase::Sweep, GcPhase::Strings, GcPhase::Pause, GcPhase::Pause};
		return phases[word & 7u];
	}
	// Incremental marking and reclamation price physical growth before a
	// reservation. Pause has no cycle and Atomic belongs to the stopped mutator.
	static bool pacedPhase(GcPhase phase) { return phase != GcPhase::Pause && phase != GcPhase::Atomic; }
	GcPhase phase() const { return decodePhase(memory.readRamRecordByte(m_controlOffset)); }
	u8 white() const { return memory.readRamRecordByte(m_controlOffset + 1u) & 1u; }
	bool active() const { return phase() != GcPhase::Pause; }
	bool finalMarkPending() const { return phase() == GcPhase::Atomic; }
	u32 fullEpochs() const { return memory.readRamRecordByte(m_controlOffset + GC_FULL_EPOCHS); }
	bool stoppedFinalMarkPending() const;
	void requestFullCollection();
	size_t stepFullCollection(u32 epochs, size_t words);
	bool sweepGarbage(u32 address) const {
		return phase() == GcPhase::Sweep && markColor(address) == (white() ^ 1u);
	}
	bool isAlive(u32 address) const { return !unmarked(memory.readRamRecordByte(address + GC_COLOR_OFFSET)); }
	size_t allocationBytes(u32 threadAddress) const;
	size_t step(Value root0, Value root1, Value root2, u32 growingThread = 0u, bool compactThreads = false,
		size_t limit = GC_STEP_WORDS);
	void assistPhysicalPressureAtTick();
	bool reservationAssistDue(size_t requested) const;
	void assistBeforeReservation(size_t requested, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	// Only the stopped mutator may advance the final pass.
	size_t stepFinalMark(size_t limit = GC_STEP_WORDS);
	size_t finishFinalMark(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	// The owner retries its actual request after each recovered epoch.
	LuaAllocationRecovery recoverAllocation(LuaAllocationRecovery next,
		Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	size_t collect(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	void markString(StringId id) { m_stringPool.markReachable(id); }
	bool markValue(Value value, u32 queue = GC_TRACE_HEAD);
	bool markThread(u32 address, u32 queue = GC_TRACE_HEAD);
	// Strong name/value edges from the permanently rooted global banks.
	void markGlobalWrite(Value reference);
	const u8* phaseAddress() const { return memory.ramData() + m_controlOffset; }
	void writeBarrier(u32 address, u32 link) {
		if (markColor(address) == 3u) enqueue(address, link, GC_CHANGED_HEAD);
	}
	void writeTableValue(u32 table, Value value) {
		if (valueTagHasGcEdge(valueTag(value)) && markColor(table) == 3u)
			writeBlackTableValue(table, value);
	}
	void writeTableEntry(u32 table, Value key, Value value);
	void writeClosedValue(u32 cell, Value value) {
		if (valueTagHasGcEdge(valueTag(value)) && markColor(cell) == 3u)
			writeBlackClosedValue(cell, value);
	}
	// Native stores already checked the color and the presence of an edge.
	void writeBlackTableValue(u32 table, Value value);
	void writeBlackClosedValue(u32 cell, Value value);
	void tableEntriesMoved(u32 address);
	u32 changedHeadOffset() const { return m_controlOffset + GC_CHANGED_HEAD; }
private:
	enum class RemarkStage : u32 { None, Threads, Weak, Roots, Trace, ClearWeak };
	u8 markColor(u32 address) const { return memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK; }
	bool unmarked(u8 flags) const { return (flags & GC_COLOR_MASK) == white(); }
	void color(u32 address, u8 mark) {
		const u32 lane = address + GC_COLOR_OFFSET;
		memory.writeRamRecordByte(lane, mark);
	}
	bool markClosure(u32 address, u32 queue = GC_TRACE_HEAD);
	void creditBarrierMarks();
	u8 weakModeBits(Value value);
	std::pair<int, size_t> probeTableMode(const TableRecord&, size_t limit);
	bool markTable(u32 address, u32 queue = GC_TRACE_HEAD);
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
	size_t trace(bool atomic, size_t limit);
	size_t traceRootBanks(size_t limit, size_t work, GcRootBank stop);
	size_t traceCaptures(u32 closure, u32 next, u32 count, size_t work, size_t limit);
	size_t traceThread(u32 thread, bool atomic, size_t limit, u32 cursor, u32 open, u32 captureTop, bool resumed);
	size_t resumeTrace(u32 record, bool atomic, size_t limit);
	size_t traceQuantum(bool atomic, size_t limit, size_t work);
	size_t remarkVisits(size_t allowance);
	size_t remarkRoots(Value root0, Value root1, Value root2, size_t limit, size_t work, bool final);
	size_t accountEpochWork(size_t work);
	size_t stepWork(Value root0, Value root1, Value root2, u32 growingThread, bool compactThreads, size_t limit);
	size_t finalMarkWork(Value root0, Value root1, Value root2, bool scopedRoots, size_t limit);
	RemarkStage remarkStage() const {
		return static_cast<RemarkStage>(memory.readRamRecordWord(m_controlOffset + GC_REMARK_VISIT_STATE) >> GC_GRAY_INDEX_BITS);
	}
	void setRemarkStage(RemarkStage stage) {
		memory.writeRamRecordWord(m_controlOffset + GC_REMARK_VISIT_STATE, static_cast<u32>(stage) << GC_GRAY_INDEX_BITS);
	}
	size_t clearWeakQuantum(size_t limit);
	u32 objectRecordAddress(u32 address, u8 kind) const;
	bool markRecord(u32 address, u8 kind, u32 queue);
	size_t sweepObjects(size_t allowance, u32 growingThread, bool compactThreads);
	void beginPaceCredit(u32 estimate, u32 runwayShift);
	void updatePaceCredit(u32 basis, u32 paid, u32 estimate, u32 runway);
	size_t sweepRecord(u32 address, u32 header, bool garbage, u8 white, u32 growingThread, bool compactThreads);
	CPU& m_cpu;
	void setPhase(GcPhase phase) { memory.writeRamRecordByte(m_controlOffset, static_cast<u8>(phase)); }
	StringId m_modeKey;
	StringPool& m_stringPool;
	const u32 m_controlOffset;
};

inline u32 asClosure(Value value, const GcHeap& heap) { return heap.closureRecordAddress(valuePayload(value)); }
inline u32 asThread(Value value, const GcHeap& heap) { return heap.threadRecordAddress(valuePayload(value)); }
} // namespace bmsx
