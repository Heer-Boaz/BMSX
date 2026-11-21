#include "machine/cpu/gc_heap.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"
#include "machine/common/numeric.h"
#include "spec/blua32/image_format.h"
#include <algorithm>
#include <limits>
#include <utility>
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
#include <chrono>
#endif

namespace bmsx {
namespace {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
using GcProfileClock = std::chrono::steady_clock;

// Both enclosing and phase intervals close during exception unwinding, so
// failed collections remain attributable without any per-object clocks.
class GcPhaseMeasurement {
public:
	explicit GcPhaseMeasurement(u64& nanoseconds)
		: m_nanoseconds(&nanoseconds), m_start(GcProfileClock::now()) {}
	~GcPhaseMeasurement() {
		*m_nanoseconds += static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
			GcProfileClock::now() - m_start).count());
	}
	void phase(u64& nanoseconds) {
		const auto now = GcProfileClock::now();
		*m_nanoseconds += static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - m_start).count());
		m_start = now;
		m_nanoseconds = &nanoseconds;
	}
private:
	u64* m_nanoseconds;
	GcProfileClock::time_point m_start;
};

class GcStepMeasurement {
public:
	explicit GcStepMeasurement(DiagnosticGcProfile& profile, bool young = false)
		: m_profile(profile), m_start(GcProfileClock::now()), m_young(young) {
		++profile.steps;
		if (young) ++profile.minorCollections;
	}
	~GcStepMeasurement() {
		const u64 elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(GcProfileClock::now() - m_start).count());
		m_profile.totalNanoseconds += elapsed;
		if (m_young) m_profile.minorNanoseconds += elapsed;
		m_profile.maxStepNanoseconds = std::max(m_profile.maxStepNanoseconds, elapsed);
		if (elapsed > 2000000) ++m_profile.stepsOver2ms;
		if (elapsed > 8000000) ++m_profile.stepsOver8ms;
	}
private:
	DiagnosticGcProfile& m_profile;
	GcProfileClock::time_point m_start;
	bool m_young;
};
#endif

constexpr uint8_t kTableWeakKeys = 1, kTableWeakValues = 2;
constexpr u8 tableRecordKind = static_cast<u8>(ValueTag::Table);
constexpr u32 tableSlotClass = heapClassIndex(TableRecord::HEADER_BYTES);
constexpr u32 cellSlotClass = heapClassIndex(UPVALUE_HEAP_BYTES);
constexpr u32 threadSlotClass = heapClassIndex(THREAD_HEAP_BYTES);
// Dense capture lanes use four bytes each, and Table entries use at least
// one Value word plus a tag; both cursors fit one more bit than a gray index.
constexpr u32 TRACE_CURSOR_BITS = GC_GRAY_INDEX_BITS + 1u;
constexpr u32 TRACE_CURSOR_MASK = (1u << TRACE_CURSOR_BITS) - 1u;
constexpr u32 TABLE_MODE_PENDING = 4u << TRACE_CURSOR_BITS;
enum class ThreadTraceStage : u32 { Frames, Protected, Values, Clear, Padding };
constexpr u32 THREAD_TRACE_OPEN_HEAD = 1u; // An open cell's address is aligned.
}
bool GcHeap::markValue(Value v) {
	switch (valueTag(v)) {
		case ValueTag::Thread:
			return markThread(valuePayload(v));
		case ValueTag::Table:
			return markTable(valuePayload(v));
		case ValueTag::Closure:
			return markClosure(valuePayload(v));
		case ValueTag::BuiltinFunction:
			return false;
		case ValueTag::String:
			markString(asStringId(v));
			return false;
		default:
			return false;
	}
}

void GcHeap::enqueue(u32 address, u32 link, u32 queue) {
	const u32 previous = indexWord(queue);
	const u32 otherBits = link == GC_RECORD_LINK ? memory.readRamRecordWord(address + link) & ~GC_GRAY_INDEX_MASK : 0u;
	const u32 head = (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	memory.writeRamRecordWord(address + link, otherBits | previous);
	color(address, 2);
	memory.writeRamRecordWord(m_controlOffset + queue, head);
}

void GcHeap::tableEntriesMoved(u32 address) {
	const u32 table = memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD);
	if (table != address && memory.readRamRecordWord(m_controlOffset + GC_MODE_META) != address) return;
	// An unvisited entry may now be behind the cursor. Revisit the record in
	// the next pass rather than retrying it indefinitely under the mutator.
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, 0u, 0u);
	memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, 0u, 0u);
	memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, 0u);
	if (markColor(table) == 3u) enqueue(table, GC_RECORD_LINK, GC_CHANGED_HEAD);
}

// The regular gray index occupies the low bits of +4. Tables and Threads
// also wire an independent visit link through its high bits and byte 3.
static constexpr u32 VISIT_LINK_LOW_BITS = 32u - GC_GRAY_INDEX_BITS;
static constexpr u8 VISIT_LINK_HIGH_MASK = GC_GRAY_INDEX_MASK >> VISIT_LINK_LOW_BITS;

void GcHeap::setVisitLink(u32 address, u8 meta, u32 index) {
	const u32 gray = memory.readRamRecordWord(address + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK;
	memory.writeRamRecordWord(address + GC_RECORD_LINK, gray | (index << GC_GRAY_INDEX_BITS));
	memory.writeRamRecordByte(address + GC_VISIT_HEADER_BYTE,
		(meta & ~VISIT_LINK_HIGH_MASK) | (index >> VISIT_LINK_LOW_BITS));
}

void GcHeap::appendVisit(u32 list, u32 address) {
	const u8 meta = memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
	if (meta & GC_VISIT_MEMBER) return;
	const u32 index = (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	const u32 tail = indexWord(list + GC_VISIT_TAIL);
	setVisitLink(address, meta | GC_VISIT_MEMBER, 0u);
	if (tail != 0u) {
		const u32 last = tail << GC_RECORD_SHIFT;
		setVisitLink(last, memory.readRamRecordByte(last + GC_VISIT_HEADER_BYTE), index);
	} else {
		memory.writeRamRecordWord(m_controlOffset + list, index);
	}
	memory.writeRamRecordWord(m_controlOffset + list + GC_VISIT_TAIL, index);
	const u32 count = indexWord(list + GC_VISIT_COUNT);
	memory.writeRamRecordWord(m_controlOffset + list + GC_VISIT_COUNT, (count + 1u) & GC_GRAY_INDEX_MASK);
}

template<u8 Kind, bool Drain, class Visitor>
size_t GcHeap::visitList(u32 list, Visitor&& visitor, size_t allowance, RemarkStage stage) {
	const bool resumeWeak = stage == RemarkStage::Weak;
	u32 index = indexWord(resumeWeak ? GC_REMARK_VISIT_INDEX : list);
	u32 remaining = indexWord(resumeWeak ? GC_REMARK_VISIT_STATE : list + GC_VISIT_COUNT);
	size_t work = 0, visits = 0;
	while (index != 0u && remaining != 0u && visits < allowance) {
		const u32 address = RAM_BASE + (index << GC_RECORD_SHIFT);
		const u8 meta = memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
		// Only the matching, linked record clocks the list port.
		if (!(meta & GC_VISIT_MEMBER)) { index = 0u; break; }
		if constexpr (Kind == tableRecordKind) {
			if (tableRecordAddress(address) != address) { index = 0u; break; }
		} else {
			static_assert(Kind == THREAD_RECORD_KIND);
			if (threadRecordAddress(address) == 0u) { index = 0u; break; }
		}
		--remaining;
		++visits;
		const u32 low = memory.readRamRecordWord(address + GC_RECORD_LINK) >> GC_GRAY_INDEX_BITS;
		index = low | ((meta & VISIT_LINK_HIGH_MASK) << VISIT_LINK_LOW_BITS);
		if constexpr (Drain) setVisitLink(address, meta & ~GC_VISIT_MEMBER, 0u);
		work += visitor(address);
	}
	if (index == 0u || remaining == 0u) index = remaining = 0u;
	if constexpr (Drain) {
		if (index == 0u) memory.writeRamRecordPair(m_controlOffset + list, 0u, 0u);
		else memory.writeRamRecordWord(m_controlOffset + list, index);
		memory.writeRamRecordWord(m_controlOffset + list + GC_VISIT_COUNT, remaining);
	} else if (resumeWeak) {
		memory.writeRamRecordPair(m_controlOffset + GC_REMARK_VISIT_INDEX,
			index, (static_cast<u32>(stage) << GC_GRAY_INDEX_BITS) | remaining);
	}
	return stage == RemarkStage::None ? work : visits;
}

void GcHeap::requeueVisited(u32 address) {
	if (markColor(address) == 3u) enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
}

u32 GcHeap::threadRecordAddress(u32 address) const {
	const u32 offset = address & GC_RECORD_MASK;
	return (offset & (HEAP_PAGE_SIZE - 1u)) % THREAD_HEAP_BYTES == 0u && offset < arena.managementOffset()
		&& memory.readRamRecordByte(offset) == THREAD_RECORD_KIND
		&& arena.issuedObjectSlotClass(offset) == threadSlotClass ? RAM_BASE + offset : 0u;
}

bool GcHeap::markThread(u32 address) {
	const u32 offset = address & GC_RECORD_MASK;
	if ((offset & (HEAP_PAGE_SIZE - 1u)) % THREAD_HEAP_BYTES != 0u || offset >= arena.managementOffset()) return false;
	const u32 header = memory.readRamRecordWord(offset);
	if ((header & 0xffu) != THREAD_RECORD_KIND || !unmarked(static_cast<u8>(header >> 8u))
		|| arena.issuedObjectSlotClass(offset) != threadSlotClass) return false;
	enqueue(RAM_BASE + offset, GC_RECORD_LINK, GC_TRACE_HEAD);
	return true;
}

u32 GcHeap::closureRecordAddress(u32 address) const {
	const u32 offset = address & GC_RECORD_MASK;
	return offset < arena.managementOffset() && memory.readRamRecordByte(offset) == static_cast<u8>(ValueTag::Closure)
		&& arena.issuedObjectStart(offset) ? RAM_BASE + offset : 0u;
}

bool GcHeap::markClosure(u32 address) {
	const u32 offset = address & GC_RECORD_MASK;
	if (offset >= arena.managementOffset()) return false;
	const u32 header = memory.readRamRecordWord(offset);
	if ((header & 0xffu) != static_cast<u8>(ValueTag::Closure) || !unmarked(static_cast<u8>(header >> 8u))
		|| !arena.issuedObjectStart(offset)) return false;
	enqueue(RAM_BASE + offset, GC_RECORD_LINK, GC_TRACE_HEAD);
	return true;
}

u32 GcHeap::tableRecordAddress(u32 address) const {
	const u32 offset = address & (MAIN_RAM_SIZE - TableRecord::HEADER_BYTES);
	return arena.issuedObjectSlotClass(offset) == tableSlotClass
		&& memory.readRamRecordByte(offset) == tableRecordKind ? RAM_BASE + offset : 0u;
}

u32 GcHeap::cellRecordAddress(u32 address) const {
	const u32 offset = address & UPVALUE_ADDRESS_MASK;
	return arena.issuedObjectSlotClass(offset) == cellSlotClass
		&& memory.readRamRecordByte(offset) == UPVALUE_RECORD_KIND ? RAM_BASE + offset : 0u;
}

u32 GcHeap::openCellAddress(u32 address) const {
	const u32 cell = cellRecordAddress(address);
	return cell != 0u && Upvalue::isOpen(memory, cell) ? cell : 0u;
}

bool GcHeap::markTable(u32 address) {
	const u32 record = tableRecordAddress(address);
	if (record == 0u || !unmarked(memory.readRamRecordByte(record + GC_COLOR_OFFSET))) return false;
	enqueue(record, GC_RECORD_LINK, GC_TRACE_HEAD);
	return true;
}

size_t GcHeap::markCell(u32 cell) {
	if (cell == 0u || !unmarked(memory.readRamRecordByte(cell + GC_COLOR_OFFSET))) return 0;
	color(cell, 3);
	if (Upvalue::isOpen(memory, cell)) markThread(memory.readRamRecordWord(cell + UPVALUE_OWNER));
	markValue(Upvalue::load(memory, cell));
	return UPVALUE_HEAP_BYTES / sizeof(u32);
}

size_t GcHeap::allocationBytes(u32 threadAddress) const {
	return ThreadRecord::storageLayout(memory, threadAddress).allocationBytes();
}
uint8_t GcHeap::tableWeakMode(const TableRecord& table) {
	const u32 meta = table.metatableAddress();
	if (meta == 0u) {
		return 0;
	}
	const u32 address = tableRecordAddress(meta);
	if (address == 0u) return 0;
	return weakModeBits(TableRecord(*this, address).getStringKey(m_modeKey));
}

u8 GcHeap::weakModeBits(Value modeValue) {
	if (!valueIsString(modeValue)) {
		return 0;
	}
	const StringId mode = asStringId(modeValue);
	const int length = m_stringPool.byteLength(mode);
	if (length != 1 && length != 2) return 0u;
	const u32 first = m_stringPool.byteAt(mode, 0u);
	if (length == 1) return first == 'k' ? kTableWeakKeys : first == 'v' ? kTableWeakValues : 0u;
	const u32 second = m_stringPool.byteAt(mode, 1u);
	return (first == 'k' && second == 'v') || (first == 'v' && second == 'k') ? kTableWeakKeys | kTableWeakValues : 0u;
}

int GcHeap::probeTableMode(const TableRecord& table, size_t limit) {
	const u32 address = tableRecordAddress(table.metatableAddress());
	const u32 current = memory.readRamRecordWord(m_controlOffset + GC_MODE_META);
	if (address != 0u) {
		const TableRecord meta(*this, address);
		auto probe = address == current
			? TableStringProbe{static_cast<i32>(memory.readRamRecordWord(m_controlOffset + GC_MODE_NODE)),
				memory.readRamRecordWord(m_controlOffset + GC_MODE_REMAINING)}
			: meta.beginStringProbe(m_modeKey);
		m_modeProbeWork += meta.advanceStringProbe(m_modeKey, probe, limit);
		if (probe.node >= 0 && probe.remaining != 0u) {
			memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, address, static_cast<u32>(probe.node));
			memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, probe.remaining);
			return -1;
		}
		if (current == 0u) return weakModeBits(probe.value);
		memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, 0u);
		return weakModeBits(probe.value);
	}
	if (current != 0u) {
		memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, 0u);
	}
	return 0;
}

bool GcHeap::valueIsAlive(Value value) const {
	switch (valueTag(value)) {
		case ValueTag::Thread: {
			const u32 address = threadRecordAddress(valuePayload(value));
			return address != 0u && isAlive(address);
		}
		case ValueTag::Table: {
			const u32 address = tableRecordAddress(valuePayload(value));
			return address != 0u && isAlive(address);
		}
		case ValueTag::Closure: {
			const u32 closure = asClosure(value, *this);
			return closure != 0u && isAlive(closure);
		}
		default:
			return true;
	}
}

size_t GcHeap::trace(bool atomic, size_t limit) {
	const u32 index = indexWord(GC_TRACE_HEAD);
	const u32 offset = index << GC_RECORD_SHIFT, address = RAM_BASE + offset;
	const u8 kind = offset < arena.managementOffset() ? memory.readRamRecordByte(address) : 0u;
	const bool table = kind == tableRecordKind && (offset & (TableRecord::HEADER_BYTES - 1u)) == 0u
		&& arena.issuedObjectSlotClass(offset) == tableSlotClass;
	const bool cell = kind == UPVALUE_RECORD_KIND && (offset & (UPVALUE_HEAP_BYTES - 1u)) == 0u
		&& arena.issuedObjectSlotClass(offset) == cellSlotClass && !Upvalue::isOpen(memory, address);
	const bool closure = kind == static_cast<u8>(ValueTag::Closure) && arena.issuedObjectStart(offset);
	const bool thread = kind == THREAD_RECORD_KIND && (offset & (HEAP_PAGE_SIZE - 1u)) % THREAD_HEAP_BYTES == 0u
		&& arena.issuedObjectSlotClass(offset) == threadSlotClass;
	// A link is clocked only by a queued record. Consuming its color bounds
	// malformed cycles as well as preventing a duplicate scan.
	if ((!table && !cell && !closure && !thread) || markColor(address) != 2u) {
		memory.writeRamRecordWord(m_controlOffset + GC_TRACE_HEAD, 0u);
		return 0;
	}
	const u32 link = address + (cell ? UPVALUE_NEXT : GC_RECORD_LINK);
	const u32 packed = memory.readRamRecordWord(link);
	memory.writeRamRecordWord(m_controlOffset + GC_TRACE_HEAD, packed & GC_GRAY_INDEX_MASK);
	memory.writeRamRecordWord(link, cell ? 0u : packed & ~GC_GRAY_INDEX_MASK);
	const u8 flags = memory.readRamRecordByte(address + GC_COLOR_OFFSET);
	if (m_minor && (flags & GC_OLD)) memory.writeRamRecordByte(address + GC_COLOR_OFFSET, GC_OLD | white());
	else color(address, 3);
	if (table) return traceTable(address, limit);
	if (cell) {
		markValue(Upvalue::load(memory, address));
		return UPVALUE_HEAP_BYTES / sizeof(u32);
	}
	if (closure) {
		const u32 count = ClosureRecord::captureCount(memory, address);
		// A capture word can discover a four-word cell and one String.
		if (3u + 6u * count > limit) return traceCaptures(address, 0u, count, 3u, limit);
		size_t work = 3u + count;
		for (u32 index = 0; index < count; ++index)
			work += markCell(cellRecordAddress(ClosureRecord::captureAddress(memory, address, index)));
		return work;
	}
	return traceThread(address, atomic, limit, 0u, THREAD_TRACE_OPEN_HEAD, 0u, 0u);
}

size_t GcHeap::traceThread(u32 address, bool atomic, size_t limit, u32 cursor, u32 open, u32 captureTop, u32 billed) {
	const bool resumed = billed != 0u;
	size_t work = 0;
	if (!resumed) {
		if (!atomic) appendVisit(GC_THREAD_VISITS, address);
		markThread(ThreadRecord::read(memory, address, ThreadField::Resumer));
		markClosure(ThreadRecord::read(memory, address, ThreadField::Entry));
		markValue(ThreadRecord::error(memory, address));
		billed = THREAD_HEAP_BYTES / sizeof(u32);
		work = billed + m_stringPool.takeMarkWork();
	}
	const auto layout = ThreadRecord::storageLayout(memory, address);
	const u32 depth = ThreadRecord::count(memory, address, ThreadField::FrameDepth);
	auto stage = static_cast<ThreadTraceStage>(cursor >> TRACE_CURSOR_BITS);
	u32 next = cursor & TRACE_CURSOR_MASK;
	const auto chargeStorage = [&](u32 words) { billed += words; work += words; };
	// Rebind logical indices every time. The frame and value allocations can
	// move between grants, but neither a span nor a frame pointer is saved.
	if (stage == ThreadTraceStage::Frames) {
		while (next < depth && work < limit) {
			if (open == THREAD_TRACE_OPEN_HEAD) {
				const u32 frame = layout.frameAddress(next);
				markClosure(memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Closure)));
				open = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::OpenHead));
				chargeStorage(FRAME_CONTROL_BYTES / sizeof(u32));
			}
			while (open != 0u && work < limit) {
				const u32 cell = openCellAddress(open);
				// A returning frame may have closed the saved cell while the
				// collector was paused. Its Next lane is no longer a stack link.
				if (cell == 0u) { open = 0u; break; }
				const u32 slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
				if (slot < layout.valueCapacity) captureTop = std::max(captureTop, slot + 1u);
				open = memory.readRamRecordWord(cell + UPVALUE_NEXT);
				work += std::max(size_t{1}, markCell(cell));
				work += m_stringPool.takeMarkWork();
			}
			if (open == 0u) { ++next; open = THREAD_TRACE_OPEN_HEAD; }
		}
		if (next >= depth) { stage = ThreadTraceStage::Protected; next = 0u; open = 0u; }
	}
	if (stage == ThreadTraceStage::Protected) {
		const u32 depth = ThreadRecord::count(memory, address, ThreadField::ProtectedDepth);
		while (next < depth && work < limit) {
			const u32 continuation = layout.protectedAddress(next++);
			const u32 flags = memory.readRamRecordWord(continuation + static_cast<u32>(ProtectedField::Flags));
			if ((flags & PROTECTED_CALL_KIND_MASK) != static_cast<u32>(ProtectedCallKind::PCall)
				&& (flags & PROTECTED_CALL_HANDLER_BUILTIN) == 0u) {
				markClosure(memory.readRamRecordWord(continuation + static_cast<u32>(ProtectedField::Handler)));
			}
			chargeStorage(PROTECTED_CALL_BYTES / sizeof(u32));
		}
		if (next >= depth) { stage = ThreadTraceStage::Values; next = 0u; }
	}
	if (stage == ThreadTraceStage::Values) {
		u32 liveTop = captureTop;
		if (depth != 0u) {
			const u32 frame = layout.frameAddress(depth - 1u);
			const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
			const u32 top = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Top)) & FRAME_WINDOW_MASK;
			const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
			liveTop = std::max(liveTop, base + std::min(top, capacity));
		}
		auto slots = layout.slots(memory, liveTop > layout.valueCapacity);
		while (next < liveTop && work < limit) {
			// One five-byte slot costs at most two storage words and one String mark.
			const u32 stop = next + static_cast<u32>(std::min<size_t>(liveTop - next, std::max(size_t{1}, (limit - work) / 3u)));
			const u32 words = ceilDiv4(static_cast<int>(stop * THREAD_STACK_SLOT_BYTES))
				- ceilDiv4(static_cast<int>(next * THREAD_STACK_SLOT_BYTES));
			while (next < stop) markValue(slots.get(next++));
			chargeStorage(words);
			work += m_stringPool.takeMarkWork();
		}
		if (next >= liveTop) {
			// Only the final pass has the stable complete open-capture frontier.
			stage = atomic ? ThreadTraceStage::Clear : ThreadTraceStage::Padding;
			next = liveTop;
		}
	}
	if (stage == ThreadTraceStage::Clear) {
		while (next < layout.valueCapacity && work < limit) {
			const u32 stop = next + static_cast<u32>(std::min<size_t>(layout.valueCapacity - next,
				std::max(size_t{1}, (limit - work) / 2u)));
			layout.slots(memory).clear(next, stop - next);
			chargeStorage(ceilDiv4(static_cast<int>(stop * THREAD_STACK_SLOT_BYTES))
				- ceilDiv4(static_cast<int>(next * THREAD_STACK_SLOT_BYTES)));
			next = stop;
		}
		if (next >= layout.valueCapacity) stage = ThreadTraceStage::Padding;
	}
	if (stage == ThreadTraceStage::Padding) {
		const u32 total = ceilDiv4(static_cast<int>(layout.allocationBytes()));
		if (work < limit) chargeStorage(static_cast<u32>(std::min<size_t>(total - billed, limit - work)));
		if (billed == total) {
			if (resumed) {
				memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, 0u, 0u);
				memory.writeRamRecordWord(m_controlOffset + GC_THREAD_TRACE_OPEN, 0u);
				memory.writeRamRecordPair(m_controlOffset + GC_THREAD_TRACE_TOP, 0u, 0u);
			}
			return work;
		}
	}
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, (static_cast<u32>(stage) << TRACE_CURSOR_BITS) | next);
	memory.writeRamRecordWord(m_controlOffset + GC_THREAD_TRACE_OPEN, open);
	memory.writeRamRecordPair(m_controlOffset + GC_THREAD_TRACE_TOP, captureTop, billed);
	return work;
}

size_t GcHeap::traceCaptures(u32 closure, u32 next, u32 count, size_t work, size_t limit) {
	while (next < count && work < limit) {
		work += 1u + markCell(cellRecordAddress(ClosureRecord::captureAddress(memory, closure, next++)));
		work += m_stringPool.takeMarkWork();
	}
	// The capture lanes do not move after construction. The saved position
	// and the queued edges share the same RAM snapshot as the values.
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD,
		next < count ? closure : 0u, next < count ? next : 0u);
	return work;
}

size_t GcHeap::resumeTrace(u32 record, bool atomic, size_t limit) {
	const u32 cursor = memory.readRamRecordWord(m_controlOffset + GC_TRACE_CURSOR);
	switch (memory.readRamRecordByte(record)) {
	case tableRecordKind: {
		if (cursor == TABLE_MODE_PENDING) return traceTable(record, limit, true);
		const TableRecord table(*this, record);
		return traceTableEntries(table, static_cast<u8>(cursor >> TRACE_CURSOR_BITS),
			cursor & TRACE_CURSOR_MASK, 0u, limit);
	}
	case THREAD_RECORD_KIND:
		return traceThread(record, atomic, limit, cursor,
			memory.readRamRecordWord(m_controlOffset + GC_THREAD_TRACE_OPEN),
			memory.readRamRecordWord(m_controlOffset + GC_THREAD_TRACE_TOP),
			memory.readRamRecordWord(m_controlOffset + GC_THREAD_TRACE_BILLED));
	default:
		return traceCaptures(record, cursor, ClosureRecord::captureCount(memory, record), 0u, limit);
	}
}

size_t GcHeap::traceQuantum(bool atomic, size_t& limit, size_t work) {
	m_modeProbeWork = 0;
	if (const u32 record = memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD)) {
		work += resumeTrace(record, atomic, limit - work);
		limit -= std::exchange(m_modeProbeWork, 0u);
		if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u) return work;
	}
	while (indexWord(GC_TRACE_HEAD) != 0u && work < limit) {
		work += trace(atomic, limit - work);
		work += m_stringPool.takeMarkWork();
		limit -= std::exchange(m_modeProbeWork, 0u);
	}
	return work;
}

size_t GcHeap::traceTable(u32 address, size_t limit, bool resumingMode) {
	const TableRecord table(*this, address);
	const u32 meta = table.metatableAddress();
	if (meta != 0u && !resumingMode) markTable(meta);
	const size_t words = resumingMode ? 0u : TableRecord::HEADER_BYTES / sizeof(u32);
	int mode = 0;
	if (m_minor) mode = tableWeakMode(table);
	else if (meta != 0u || resumingMode) {
		const auto before = m_modeProbeWork;
		mode = probeTableMode(table, words < limit ? limit - words : 0u);
		limit -= m_modeProbeWork - before;
	}
	if (mode < 0) {
		memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
		return words;
	}
	const auto weakMode = static_cast<u8>(mode);
	if (weakMode != 0u) appendVisit(GC_WEAK_VISITS, address);
	const size_t slots = table.scanSlots();
	if (resumingMode || words + slots * 2 > limit) return traceTableEntries(table, weakMode, 0u, words, limit);
	traceTableEdges(table, weakMode);
	return words + slots;
}

void GcHeap::traceTableEdges(const TableRecord& table, u8 mode, u32 first, u32 end) {
	switch (mode) {
	case 0u:
		table.forEachEntry([this](Value key, Value value) { markValue(key); markValue(value); }, first, end);
		break;
	case kTableWeakKeys:
		table.forEachEntry([this](Value, Value value) { markValue(value); }, first, end);
		break;
	case kTableWeakValues:
		table.forEachEntry([this](Value key, Value) { markValue(key); }, first, end);
		break;
	}
}

size_t GcHeap::traceTableEntries(const TableRecord& table, u8 mode, u32 next, size_t work, size_t limit) {
	const u32 array = table.arrayCapacity(), end = static_cast<u32>(table.storedSlotCount());
	const bool scan = mode != (kTableWeakKeys | kTableWeakValues);
	while (next < end && work < limit) {
		const bool arrayEntry = next < array;
		const u32 entryWords = arrayEntry ? 1u : 2u;
		const size_t worst = entryWords * (scan ? 2u : 1u); // at most one String mark per Value
		const u32 span = static_cast<u32>(std::max(size_t{1}, (limit - work) / worst));
		const u32 stop = std::min(arrayEntry ? array : end, next + span);
		traceTableEdges(table, mode, next, stop);
		work += (stop - next) * entryWords + m_stringPool.takeMarkWork();
		next = stop;
	}
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, next < end ? table.address() : 0u,
		next < end ? (u32{mode} << TRACE_CURSOR_BITS) | next : 0u);
	return work;
}

size_t GcHeap::traceRootBanks(size_t limit) {
	const u32 cursor = memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR);
	u32 kind = cursor >> TRACE_CURSOR_BITS;
	size_t work = 0u, next = cursor & TRACE_CURSOR_MASK;
	for (; kind < static_cast<u32>(GcRootBank::End); ++kind, next = 0u) {
		const auto bank = static_cast<GcRootBank>(kind);
		const size_t end = m_cpu.rootBankSlots(bank);
		const bool globals = bank < GcRootBank::SystemConstants;
		const size_t words = globals ? 3u : 2u, worst = words + (globals ? 2u : 1u);
		while (next < end) {
			if (work >= limit) {
				memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, (kind << TRACE_CURSOR_BITS) | static_cast<u32>(next));
				return work;
			}
			const size_t stop = std::min(end, next + std::max(size_t{1}, (limit - work) / worst));
			m_cpu.markRootBank(*this, bank, next, stop);
			work += (stop - next) * words + m_stringPool.takeMarkWork();
			next = stop;
		}
	}
	memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, 0u);
	m_cpu.markRootThreads(*this);
	return work;
}

size_t GcHeap::remarkVisits(size_t allowance) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	GcPhaseMeasurement measurement(m_cpu.m_diagnosticGcProfile.rootsNanoseconds);
#endif
	const auto requeue = [this](u32 address) { requeueVisited(address); return 0u; };
	auto stage = remarkStage();
	size_t visits = 0;
	if (stage == RemarkStage::Threads) {
		visits = visitList<THREAD_RECORD_KIND, true>(GC_THREAD_VISITS, requeue, allowance, stage);
		if (indexWord(GC_THREAD_VISITS) != 0u) return visits;
		stage = RemarkStage::Weak;
		memory.writeRamRecordPair(m_controlOffset + GC_REMARK_VISIT_INDEX, indexWord(GC_WEAK_VISITS),
			(static_cast<u32>(stage) << GC_GRAY_INDEX_BITS) | indexWord(GC_WEAK_VISITS + GC_VISIT_COUNT));
	}
	if (stage == RemarkStage::Weak) {
		visits += visitList<tableRecordKind, false>(GC_WEAK_VISITS, requeue, allowance - visits, stage);
		if (indexWord(GC_REMARK_VISIT_INDEX) != 0u || visits == allowance) return visits;
		// Transfer only after all visits. During the visit slices mutator
		// barriers still publish to Changed, and no allocation can sweep.
		memory.writeRamRecordPair(m_controlOffset + GC_TRACE_HEAD, indexWord(GC_CHANGED_HEAD), 0u);
		setRemarkStage(RemarkStage::Roots);
		m_cpu.markRootHead(*this);
		memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, static_cast<u32>(GcRootBank::SystemGlobals) << TRACE_CURSOR_BITS);
	}
	return visits;
}

size_t GcHeap::remarkRoots(Value root0, Value root1, Value root2, size_t allowance, bool final) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	GcPhaseMeasurement measurement(m_cpu.m_diagnosticGcProfile.rootsNanoseconds);
#endif
	markValue(root0); markValue(root1); markValue(root2);
	m_stringPool.markLocalRoots();
	size_t work = m_stringPool.takeMarkWork();
	if (work < allowance) work += traceRootBanks(allowance - work);
	if (memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR) == 0u) {
		setRemarkStage(final ? RemarkStage::Trace : RemarkStage::None);
		if (!final) setPhase(GcPhase::MarkAgain);
	}
	return work;
}

size_t GcHeap::stepFinalMark(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement totalAtomic(profile.atomicNanoseconds);
#endif
	size_t limit = GC_STEP_WORDS, work = 0;
	if (remarkStage() == RemarkStage::None) setRemarkStage(RemarkStage::Threads);
	if (remarkStage() <= RemarkStage::Weak) {
		limit -= remarkVisits(limit);
		if (remarkStage() != RemarkStage::Roots) return 0u;
	}
	if (remarkStage() == RemarkStage::Roots) {
		work += remarkRoots(root0, root1, root2, limit, true);
		if (remarkStage() == RemarkStage::Roots || work >= limit) return work;
	}
	if (remarkStage() == RemarkStage::Trace) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		GcPhaseMeasurement traceTime(profile.traceNanoseconds);
#endif
		work = traceQuantum(true, limit, work);
		if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u || indexWord(GC_TRACE_HEAD) != 0u)
			return work;
		setRemarkStage(RemarkStage::ClearWeak);
		if (work >= limit) return work;
	}
	work += clearWeakQuantum(limit - work);
	if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u || indexWord(GC_WEAK_VISITS) != 0u) return work;
	memory.writeRamRecordByte(m_controlOffset + 1u, white() ^ 1u);
	arena.beginObjectSweep();
	setRemarkStage(RemarkStage::None);
	setPhase(GcPhase::Sweep);
	return work;
}

void GcHeap::clearWeakRange(TableRecord& table, u8 mode, u32 first, u32 end) {
	table.clearWeakEntries((mode & kTableWeakKeys) != 0u, (mode & kTableWeakValues) != 0u,
		[this](Value value) { return valueIsAlive(value); }, first, end);
	table.forEachEntry([this](Value key, Value value) {
		if (valueIsString(key)) markString(asStringId(key));
		if (valueIsString(value)) markString(asStringId(value));
	}, first, end);
}

size_t GcHeap::clearWeakQuantum(size_t limit) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	GcPhaseMeasurement weakTime(m_cpu.m_diagnosticGcProfile.weakNanoseconds);
#endif
	size_t work = 0;
	m_modeProbeWork = 0;
	while (work < limit) {
		u32 record = memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD);
		if (record == 0u) {
			if (indexWord(GC_WEAK_VISITS) == 0u) break;
			visitList<tableRecordKind, true>(GC_WEAK_VISITS, [&](u32 address) {
				record = address;
				memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
				return 0u;
			}, 1u);
			--limit; // Even an empty weak table consumes one physical visit.
			if (record == 0u || work == limit) break;
		}
		TableRecord table(*this, record);
		u32 cursor = memory.readRamRecordWord(m_controlOffset + GC_TRACE_CURSOR);
		if (cursor == TABLE_MODE_PENDING) {
			const int mode = probeTableMode(table, limit - work);
			limit -= std::exchange(m_modeProbeWork, 0u);
			if (mode < 0) break;
			cursor = static_cast<u32>(mode) << TRACE_CURSOR_BITS;
		}
		const u8 mode = static_cast<u8>(cursor >> TRACE_CURSOR_BITS);
		const u32 array = table.arrayCapacity(), end = static_cast<u32>(table.storedSlotCount());
		u32 next = cursor & TRACE_CURSOR_MASK;
		while (next < end && work < limit) {
			const u32 entryWords = next < array ? 1u : 2u;
			const u32 stop = std::min(next < array ? array : end,
				next + static_cast<u32>(std::max(size_t{1}, (limit - work) / (2u * entryWords))));
			clearWeakRange(table, mode, next, stop);
			work += (stop - next) * entryWords + m_stringPool.takeMarkWork();
			next = stop;
		}
		memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, next < end ? record : 0u,
			next < end ? (u32{mode} << TRACE_CURSOR_BITS) | next : 0u);
	}
	return work;
}

size_t GcHeap::resolveWeak() {
	size_t work = 0;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement timing(profile.traceNanoseconds);
#endif

	while (indexWord(GC_TRACE_HEAD) != 0u) {
		work += trace(true);
		work += m_stringPool.takeMarkWork();
	}
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	timing.phase(profile.weakNanoseconds);
#endif
	work += visitList<tableRecordKind, true>(GC_WEAK_VISITS, [&](u32 address) {
		TableRecord table(*this, address);
		const auto mode = tableWeakMode(table);
		const auto slots = table.scanSlots();
		clearWeakRange(table, mode, 0u, static_cast<u32>(table.storedSlotCount()));
		return slots;
	});
	return work + m_stringPool.takeMarkWork();
}

i32 GcHeap::seedRemembered(void* context, u32 address) {
	auto& heap = *static_cast<GcHeap*>(context);
	const u32 header = heap.memory.readRamRecordWord(address);
	const u8 kind = static_cast<u8>(header);
	if ((header & (u32{GC_REMEMBERED} << 8u)) != 0u) {
		if (kind == tableRecordKind) heap.enqueue(address, GC_RECORD_LINK, GC_TRACE_HEAD);
		else if (kind == UPVALUE_RECORD_KIND && !Upvalue::isOpen(heap.memory, address))
			heap.enqueue(address, UPVALUE_NEXT, GC_TRACE_HEAD);
	}
	return 1;
}

i32 GcHeap::seedThread(void* context, u32 address) {
	auto& heap = *static_cast<GcHeap*>(context);
	const u32 header = heap.memory.readRamRecordWord(address);
	if ((header & (0xffu | (u32{GC_OLD} << 8u))) == (THREAD_RECORD_KIND | (u32{GC_OLD} << 8u)))
		heap.enqueue(address, GC_RECORD_LINK, GC_TRACE_HEAD);
	return 1;
}

size_t GcHeap::collectYoung(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcStepMeasurement total(profile, true);
	++profile.collections;
#endif
	m_minor = true;
	size_t work;
	{
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		GcPhaseMeasurement roots(profile.rootsNanoseconds);
#endif
		markString(m_modeKey);
		m_cpu.markRoots(*this);
		markValue(root0); markValue(root1); markValue(root2);
		m_stringPool.markLocalRoots(true);
		work = m_cpu.collectionRootWordCount() + m_stringPool.takeMarkWork();
		work += arena.visitGcPages(HeapGcPages::Remembered, this, &GcHeap::seedRemembered);
		work += arena.visitGcPages(HeapGcPages::Threads, this, &GcHeap::seedThread);
	}
	work += resolveWeak();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	GcPhaseMeasurement sweepTime(profile.sweepNanoseconds);
#endif
	SweepContext sweep{*this, 0u, white()};
	work += arena.visitGcPages(HeapGcPages::Young, &sweep, &GcHeap::sweepRecord);
	arena.clearGcPages(HeapGcPages::Young);
	arena.clearGcPages(HeapGcPages::Remembered);
	m_minor = false;
	return work;
}

i32 GcHeap::sweepRecord(void* context, u32 address) {
	const auto& sweep = *static_cast<SweepContext*>(context);
	auto& heap = sweep.heap;
	const u32 header = heap.memory.readRamRecordWord(address);
	const u8 kind = static_cast<u8>(header);
	const u8 flags = static_cast<u8>(header >> 8u);
	if (heap.m_minor && kind == BLUA32_STRING_RECORD_KIND)
		return 1 + static_cast<i32>(heap.m_stringPool.sweepYoungBucket(address));
	if (heap.m_minor && (flags & GC_OLD)) return 1;
	const bool garbage = (flags & GC_COLOR_MASK) == (sweep.white ^ (heap.m_minor ? 0u : 1u));
	const u8 survivor = sweep.white | (heap.m_minor ? GC_OLD : flags & ~GC_COLOR_MASK);
	if (kind == tableRecordKind || kind == UPVALUE_RECORD_KIND || kind == static_cast<u8>(ValueTag::Closure)) {
		if (garbage) {
			if (kind == tableRecordKind) TableRecord(heap, address).freeRecord();
			else {
				if (kind == static_cast<u8>(ValueTag::Closure)) heap.m_cpu.retireStaticClosure(address);
				const u32 bytes = kind == UPVALUE_RECORD_KIND ? UPVALUE_HEAP_BYTES
					: closureRecordBytes(ClosureRecord::captureCount(heap.memory, address),
						(header & (CLOSURE_LATCHED_PROTOTYPE << (8u * CLOSURE_BINDING_FLAGS))) != 0u);
				heap.budget.releaseRecord(address, bytes);
			}
			return -1;
		}
		heap.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
		return 1;
	}
	if (kind != THREAD_RECORD_KIND || heap.threadRecordAddress(address) == 0u) return 1;
	const auto layout = ThreadRecord::storageLayout(heap.memory, address);
	const i32 work = ceilDiv4(static_cast<int>(layout.allocationBytes()));
	if (!garbage) {
		heap.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
		const u32 relocated = sweep.compactThreads && address != sweep.growingThread
			? ThreadRecord::shrinkStack(heap, address, layout) : 0u;
		if (relocated != 0u) heap.m_cpu.rebindRelocatedThread(address);
		return work + 2 * ceilDiv4(relocated);
	}

	// Clear any selected execution view before its old record or backing can
	// be reused. View residency does not contribute a root or collector work.
	heap.m_cpu.retireThreadView(address);
	heap.budget.releaseRecord(layout.block, layout.valueBytes());
	heap.budget.releaseRecord(layout.frameBlock, layout.frameBytes());
	if (layout.protectedBlock != 0u) heap.budget.releaseRecord(layout.protectedBlock, layout.protectedBytes());
	heap.budget.releaseRecord(address, THREAD_HEAP_BYTES);
	return -work;
}

size_t GcHeap::step(Value root0, Value root1, Value root2, u32 growingThread, bool compactThreads) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcStepMeasurement total(profile);
#endif
	size_t work = 0, limit = GC_STEP_WORDS;
	if (phase() != GcPhase::Atomic && remarkStage() != RemarkStage::None) {
		limit -= remarkVisits(limit);
		if (remarkStage() != RemarkStage::Roots) return 0u;
		work += remarkRoots(root0, root1, root2, limit, false);
		if (phase() == GcPhase::Mark) return work;
	} else if (phase() == GcPhase::Pause || phase() == GcPhase::Mark || phase() == GcPhase::MarkAgain) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		GcPhaseMeasurement roots(profile.rootsNanoseconds);
#endif
		if (phase() == GcPhase::Pause) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
			++profile.collections;
#endif
			setPhase(GcPhase::Mark);
			m_stringPool.beginReachabilityEpoch();
			m_stringPool.markReachable(m_modeKey);
			m_cpu.markRootHead(*this);
			memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, static_cast<u32>(GcRootBank::SystemGlobals) << TRACE_CURSOR_BITS);
		}
		if (memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR) != 0u) {
			work += m_stringPool.takeMarkWork();
			if (work < GC_STEP_WORDS) work += traceRootBanks(GC_STEP_WORDS - work);
		}
		markValue(root0); markValue(root1); markValue(root2);
		m_stringPool.markLocalRoots();
		work += m_stringPool.takeMarkWork();
	}
	while (work < limit && active()) {
		switch (phase()) {
			case GcPhase::Mark:
			case GcPhase::MarkAgain: {
				{
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
					GcPhaseMeasurement traceTime(phase() == GcPhase::Mark ? profile.traceNanoseconds : profile.markAgainNanoseconds);
#endif
					work = traceQuantum(false, limit, work);
				}
				if (work < limit) {
					if (phase() == GcPhase::Mark) {
						setRemarkStage(RemarkStage::Threads);
						limit -= remarkVisits(limit - work);
						if (remarkStage() != RemarkStage::Roots) return work;
						work += remarkRoots(root0, root1, root2, limit - work, false);
						if (phase() == GcPhase::Mark) return work;
					} else {
						setPhase(GcPhase::Atomic);
						return work;
					}
				}
				break;
			}
			case GcPhase::Atomic:
				// The explicit and space-exhausted collection paths stay synchronous.
				do { work += stepFinalMark(root0, root1, root2); } while (phase() == GcPhase::Atomic);
				return work;
			case GcPhase::Sweep: {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
				GcPhaseMeasurement sweepTime(profile.sweepNanoseconds);
#endif
				SweepContext sweep{*this, growingThread, white(), compactThreads};
				work += arena.sweepObjects(GC_STEP_WORDS - work, &sweep, &GcHeap::sweepRecord);
				if (work < GC_STEP_WORDS && !arena.objectSweepActive()) {
					memory.writeRamRecordWord(m_controlOffset + GC_CHANGED_HEAD, 0u);
					setPhase(GcPhase::Strings);
					m_stringPool.beginSweep();
				}
				break;
			}
			case GcPhase::Strings: {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
				GcPhaseMeasurement strings(profile.stringReclaimNanoseconds);
#endif
				work += m_stringPool.sweepStep(GC_STEP_WORDS - work);
				if (!m_stringPool.sweeping()) {
					setPhase(GcPhase::Pause);
					budget.finishCollection();
				}
				break;
			}
			case GcPhase::Pause: break;
		}
	}
	return work;
}
size_t GcHeap::collect(Value root0, Value root1, Value root2, u32 growingThread) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	++m_cpu.m_diagnosticGcProfile.fullCollections;
#endif
	size_t work = 0;
	// An explicit/full collection also removes floating garbage from an active cycle.
	while (active()) work += step(root0, root1, root2, growingThread, true);
	do { work += step(root0, root1, root2, growingThread, true); } while (active());
	return work;
}
} // namespace bmsx
