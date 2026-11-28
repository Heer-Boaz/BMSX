#include "gc_heap_reference.h"
#include "firmware_heap_layout.h"
#include "global_bank_reference.h"
#include "thread_storage_reference.h"
#include "table_reference.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/upvalue.h"
#include "machine/common/numeric.h"
#include "spec/blua32/image_format.h"
#include <algorithm>
#include <limits>
#include <utility>

namespace bmsx::test {

GcHeap::GcHeap(CPU& cpu, LocalStringRoots* roots)
	: budget(cpu, roots), memory(cpu.memory()), arena(memory)
	, m_cpu(cpu), m_roots(roots), m_stringPool(cpu, roots)
	, m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}

void GcHeap::writeBarrier(u32 address, u32 link) {
	if (markColor(address) == 3u) enqueue(address, link, GC_CHANGED_HEAD);
}

void GcHeap::enqueue(u32 address, u32 link, u32 queue) {
	const u32 previous = indexWord(queue);
	const u32 otherBits = link == GC_RECORD_LINK ? memory.readRamRecordWord(address + link) & ~GC_GRAY_INDEX_MASK : 0u;
	const u32 head = (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	memory.writeRamRecordWord(address + link, otherBits | previous);
	color(address, 2);
	memory.writeRamRecordWord(m_controlOffset + queue, head);
}

namespace {

constexpr uint8_t kTableWeakKeys = 1, kTableWeakValues = 2;
constexpr u8 tableRecordKind = static_cast<u8>(ValueTag::Table);
// Dense capture lanes use four bytes each, and Table entries use at least
// one Value word plus a tag; both cursors fit one more bit than a gray index.
constexpr u32 TRACE_CURSOR_BITS = GC_GRAY_INDEX_BITS + 1u;
constexpr u32 TRACE_CURSOR_MASK = (1u << TRACE_CURSOR_BITS) - 1u;
constexpr u32 TABLE_MODE_PENDING = 4u << TRACE_CURSOR_BITS;
enum class ThreadTraceStage : u32 { Frames, Values, Clear };
constexpr u32 THREAD_TRACE_OPEN_HEAD = 1u; // An open cell's address is aligned.
}
bool GcHeap::markValue(Value v, u32 queue) {
	switch (valueTag(v)) {
		case ValueTag::Thread:
			return markThread(valuePayload(v), queue);
		case ValueTag::Table:
			return markTable(valuePayload(v), queue);
		case ValueTag::Closure:
			return markClosure(valuePayload(v), queue);
		case ValueTag::BuiltinFunction:
			return false;
		case ValueTag::String:
			markString(asStringId(v));
			return false;
		default:
			return false;
	}
}

void GcHeap::creditBarrierMarks() {
	// String marks executed by the mutator must not carry host-only work
	// across a save or rewind boundary.
	if (const auto work = m_stringPool.takeMarkWork()) accountEpochWork(work);
}

void GcHeap::markGlobalWrite(Value reference) {
	const auto current = phase();
	if (current < GcPhase::Mark || current > GcPhase::Atomic) return;
	if (valueTag(reference) == ValueTag::String) {
		markString(asStringId(reference));
		creditBarrierMarks();
		return;
	}
	const auto stage = current == GcPhase::MarkAgain ? RemarkStage::Roots : remarkStage();
	// While remark is visiting owners, Changed has not yet been detached.
	// A mark in Trace then would be lost at the handoff.
	const bool beforeDetach = stage <= RemarkStage::Weak && (stage != RemarkStage::None || current == GcPhase::Atomic);
	markValue(reference, beforeDetach ? GC_CHANGED_HEAD : GC_TRACE_HEAD);
}

void GcHeap::writeBlackTableValue(u32 table, Value value) {
	if (phase() == GcPhase::MarkAgain && TableRecord(memory, table).metatableAddress() == 0u) {
		markValue(value);
		creditBarrierMarks();
	} else {
		enqueue(table, GC_RECORD_LINK, GC_CHANGED_HEAD);
	}
}

void GcHeap::writeTableEntry(u32 table, Value key, Value value) {
	if ((!valueTagHasGcEdge(valueTag(key)) && !valueTagHasGcEdge(valueTag(value))) || markColor(table) != 3u)
		return;
	if (phase() == GcPhase::MarkAgain && TableRecord(memory, table).metatableAddress() == 0u) {
		markValue(key);
		markValue(value);
		creditBarrierMarks();
	} else {
		enqueue(table, GC_RECORD_LINK, GC_CHANGED_HEAD);
	}
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
	size_t visits = 0;
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
		visitor(address);
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
	return visits;
}

void GcHeap::requeueVisited(u32 address) {
	if (markColor(address) == 3u) enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
}

void GcHeap::publishObject(u32 address) {
	const u32 head = m_controlOffset + GC_OBJECTS;
	const u32 link = address - GC_OBJECT_LINK_BEFORE;
	memory.writeRamRecordWord(link, memory.readRamRecordWord(head));
	// A new object is already current-white. Keep an untouched sweep
	// frontier on the old list rather than making it revisit new births.
	const u32 sweep = m_controlOffset + GC_SWEEP_LINK;
	if (memory.readRamRecordWord(sweep) == head) memory.writeRamRecordWord(sweep, link);
	memory.writeRamRecordPair(head, address, memory.readRamRecordWord(head + sizeof(u32)) + 1u);
}

void GcHeap::visitObjectRecords(void* context, ObjectVisitor visit) const {
	for (u32 address = memory.readRamRecordWord(m_controlOffset + GC_OBJECTS); address != 0u;
		address = memory.readRamRecordWord(address - GC_OBJECT_LINK_BEFORE)) {
		visit(context, address);
	}
}

bool GcHeap::markRecord(u32 address, u8 kind, u32 queue) {
	const u32 offset = address & GC_RECORD_MASK;
	const u32 header = memory.readRamRecordWord(offset);
	if (static_cast<u8>(header) != kind || !unmarked(static_cast<u8>(header >> 8u))) return false;
	if (!arena.issuedObjectStart(offset - GC_OBJECT_PREFIX)) return false;
	enqueue(RAM_BASE + offset, GC_RECORD_LINK, queue);
	return true;
}

bool GcHeap::markThread(u32 address, u32 queue) {
	return markRecord(address, THREAD_RECORD_KIND, queue);
}

bool GcHeap::markClosure(u32 address, u32 queue) {
	return markRecord(address, static_cast<u8>(ValueTag::Closure), queue);
}

bool GcHeap::markTable(u32 address, u32 queue) {
	return markRecord(address, tableRecordKind, queue);
}

size_t GcHeap::markCell(u32 cell) {
	if (cell == 0u || !unmarked(memory.readRamRecordByte(cell + GC_COLOR_OFFSET))) return 0;
	color(cell, 3);
	if (Upvalue::isOpen(memory, cell)) markThread(memory.readRamRecordWord(cell + UPVALUE_OWNER));
	markValue(Upvalue::load(memory, cell));
	return UPVALUE_HEAP_BYTES / sizeof(u32);
}

size_t GcHeap::allocationBytes(u32 threadAddress) const {
	const auto layout = ThreadRecord::storageLayout(memory, threadAddress);
	return arena.allocationBytes(threadAddress - GC_OBJECT_PREFIX)
		+ arena.allocationBytes(layout.block) + arena.allocationBytes(layout.frameBlock);
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

std::pair<int, size_t> GcHeap::probeTableMode(const TableRecord& table, size_t limit) {
	const u32 address = tableRecordAddress(table.metatableAddress());
	const u32 current = memory.readRamRecordWord(m_controlOffset + GC_MODE_META);
	if (address != 0u) {
		const TableRecord meta(memory, address);
		const StringId modeKey = diagnosticWord(GcDiagnosticField::Mode);
		auto probe = address == current
			? TableStringProbe{static_cast<i32>(memory.readRamRecordWord(m_controlOffset + GC_MODE_NODE)),
				memory.readRamRecordWord(m_controlOffset + GC_MODE_REMAINING)}
			: meta.beginStringProbe(modeKey);
		const size_t work = meta.advanceStringProbe(modeKey, probe, limit);
		if (probe.node >= 0 && probe.remaining != 0u) {
			memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, address, static_cast<u32>(probe.node));
			memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, probe.remaining);
			return {-1, work};
		}
		if (current == 0u) return {weakModeBits(probe.value), work};
		memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, 0u);
		return {weakModeBits(probe.value), work};
	}
	if (current != 0u) {
		memory.writeRamRecordPair(m_controlOffset + GC_MODE_META, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + GC_MODE_REMAINING, 0u);
	}
	return {0, 0u};
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
	const u8 kind = arena.issuedObjectStart(offset - GC_OBJECT_PREFIX) ? memory.readRamRecordByte(address) : 0u;
	const bool table = kind == tableRecordKind;
	const bool cell = kind == UPVALUE_RECORD_KIND && !Upvalue::isOpen(memory, address);
	const bool closure = kind == static_cast<u8>(ValueTag::Closure);
	const bool thread = kind == THREAD_RECORD_KIND;
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
	color(address, 3);
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
	return traceThread(address, atomic, limit, 0u, THREAD_TRACE_OPEN_HEAD, 0u, false);
}

size_t GcHeap::traceThread(u32 address, bool atomic, size_t limit, u32 cursor, u32 open, u32 captureTop, bool resumed) {
	size_t work = 0;
	if (!resumed) {
		if (!atomic) appendVisit(GC_THREAD_VISITS, address);
		markThread(ThreadRecord::read(memory, address, ThreadField::Resumer));
		markClosure(ThreadRecord::read(memory, address, ThreadField::Entry));
		markValue(ThreadRecord::error(memory, address));
		work = THREAD_HEAP_BYTES / sizeof(u32) + m_stringPool.takeMarkWork();
	}
	const auto layout = ThreadRecord::storageLayout(memory, address);
	const u32 depth = ThreadRecord::count(memory, address, ThreadField::FrameDepth);
	auto stage = static_cast<ThreadTraceStage>(cursor >> TRACE_CURSOR_BITS);
	u32 next = cursor & TRACE_CURSOR_MASK;
	bool complete = false;
	// Rebind logical indices every time. The frame and value allocations can
	// move between grants, but neither a span nor a frame pointer is saved.
	if (stage == ThreadTraceStage::Frames) {
		while (next < depth && work < limit) {
			if (open == THREAD_TRACE_OPEN_HEAD) {
				const u32 frame = layout.frameAddress(next);
				markClosure(memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Closure)));
				open = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::OpenHead));
				work += FRAME_CONTROL_BYTES / sizeof(u32);
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
		if (next >= depth) { stage = ThreadTraceStage::Values; next = 0u; open = 0u; }
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
			work += words + m_stringPool.takeMarkWork();
		}
		if (next >= liveTop) {
			// Only the final pass has the stable complete open-capture frontier.
			if (atomic) {
				stage = ThreadTraceStage::Clear;
				next = liveTop;
			} else complete = true;
		}
	}
	if (stage == ThreadTraceStage::Clear) {
		while (next < layout.valueCapacity && work < limit) {
			const u32 stop = next + static_cast<u32>(std::min<size_t>(layout.valueCapacity - next,
				std::max(size_t{1}, (limit - work) / 2u)));
			layout.slots(memory).clear(next, stop - next);
			work += ceilDiv4(static_cast<int>(stop * THREAD_STACK_SLOT_BYTES))
				- ceilDiv4(static_cast<int>(next * THREAD_STACK_SLOT_BYTES));
			next = stop;
		}
		complete = next >= layout.valueCapacity;
	}
	if (complete) {
		if (resumed) {
			memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, 0u, 0u);
			memory.writeRamRecordPair(m_controlOffset + GC_THREAD_TRACE_OPEN, 0u, 0u);
		}
		return work;
	}
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, (static_cast<u32>(stage) << TRACE_CURSOR_BITS) | next);
	memory.writeRamRecordPair(m_controlOffset + GC_THREAD_TRACE_OPEN, open, captureTop);
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
		const TableRecord table(memory, record);
		return traceTableEntries(table, static_cast<u8>(cursor >> TRACE_CURSOR_BITS),
			cursor & TRACE_CURSOR_MASK, 0u, limit);
	}
	case THREAD_RECORD_KIND:
		return traceThread(record, atomic, limit, cursor,
			memory.readRamRecordWord(m_controlOffset + GC_THREAD_TRACE_OPEN),
			memory.readRamRecordWord(m_controlOffset + GC_THREAD_TRACE_TOP), true);
	default:
		return traceCaptures(record, cursor, ClosureRecord::captureCount(memory, record), 0u, limit);
	}
}

size_t GcHeap::traceQuantum(bool atomic, size_t limit, size_t work) {
	if (const u32 record = memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD)) {
		work += resumeTrace(record, atomic, limit - work);
		if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u) return work;
	}
	while (indexWord(GC_TRACE_HEAD) != 0u && work < limit) {
		work += trace(atomic, limit - work);
		work += m_stringPool.takeMarkWork();
	}
	return work;
}

size_t GcHeap::traceTable(u32 address, size_t limit, bool resumingMode) {
	const TableRecord table(memory, address);
	const u32 meta = table.metatableAddress();
	if (meta != 0u && !resumingMode) markTable(meta);
	size_t work = resumingMode ? 0u : TableRecord::HEADER_BYTES / sizeof(u32);
	int mode = 0;
	if (meta != 0u || resumingMode) {
		const auto [resolved, inspected] = probeTableMode(table, work < limit ? limit - work : 0u);
		mode = resolved;
		work += inspected;
	}
	if (mode < 0) {
		memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
		return work;
	}
	const auto weakMode = static_cast<u8>(mode);
	if (weakMode != 0u) appendVisit(GC_WEAK_VISITS, address);
	if (weakMode == (kTableWeakKeys | kTableWeakValues)) {
		if (resumingMode) memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, 0u, 0u);
		return work;
	}
	// Weak array values have no key edge. The final weak pass owns their visits.
	const bool weakValues = (weakMode & kTableWeakValues) != 0u;
	const u32 first = weakValues ? table.arrayCapacity() : 0u;
	const size_t slots = weakValues ? 2u * table.hashSlots() : table.scanSlots();
	if (resumingMode || work + slots * 2 > limit) return traceTableEntries(table, weakMode, first, work, limit);
	traceTableEdges(table, weakMode, first);
	return work + slots;
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
	while (next < end && work < limit) {
		const bool arrayEntry = next < array;
		const u32 entryWords = arrayEntry ? 1u : 2u;
		const size_t worst = 2u * entryWords; // at most one String mark per Value
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

size_t GcHeap::traceRootBanks(size_t limit, size_t work, GcRootBank stop) {
	const u32 cursor = memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR);
	u32 kind = cursor >> TRACE_CURSOR_BITS;
	size_t next = cursor & TRACE_CURSOR_MASK;
	for (; kind < static_cast<u32>(stop); ++kind, next = 0u) {
		const auto bank = static_cast<GcRootBank>(kind);
		const size_t end = rootBankEnd(bank);
		const bool globals = bank < GcRootBank::SystemConstants;
		const size_t words = globals ? 3u : 1u, worst = words + (globals ? 2u : 1u);
		while (next < end) {
			if (work >= limit) {
				memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, (kind << TRACE_CURSOR_BITS) | static_cast<u32>(next));
				return work;
			}
			const size_t allowance = std::max(size_t{1}, (limit - work) / worst);
			work += markRootBank(bank, next, end, allowance) * words;
			work += m_stringPool.takeMarkWork();
		}
	}
	memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, 0u);
	markRootThreads();
	return work;
}

size_t GcHeap::remarkVisits(size_t allowance) {
	const auto requeue = [this](u32 address) { requeueVisited(address); };
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
		markRootHead();
		// Global banks were scanned once. Their mutation path retains new edges.
		memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, static_cast<u32>(GcRootBank::SystemConstants) << TRACE_CURSOR_BITS);
	}
	return visits;
}

size_t GcHeap::remarkRoots(Value root0, Value root1, Value root2, size_t limit, size_t work, bool final) {
	markValue(root0); markValue(root1); markValue(root2);
	work += m_stringPool.takeMarkWork();
	if (work < limit) work = traceRootBanks(limit, work, GcRootBank::End);
	if (memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR) == 0u) {
		setRemarkStage(final ? RemarkStage::Trace : RemarkStage::None);
		if (!final) setPhase(GcPhase::MarkAgain);
	}
	return work;
}

size_t GcHeap::finishFinalMark(Value root0, Value root1, Value root2) {
	if (!finalMarkPending()) return 0u;
	size_t work = 0;
	bool scopedRoots = true;
	do {
		work += finalMarkWork(root0, root1, root2, scopedRoots, GC_STEP_WORDS);
		scopedRoots = remarkStage() <= RemarkStage::Weak;
	} while (finalMarkPending());
	return accountEpochWork(work);
}

size_t GcHeap::stepFinalMark(size_t limit) {
	const size_t work = finalMarkWork(valueNil(), valueNil(), valueNil(), false, limit);
	return accountEpochWork(work);
}

size_t GcHeap::finalMarkWork(Value root0, Value root1, Value root2, bool scopedRoots, size_t limit) {
	size_t work = 0;
	if (remarkStage() == RemarkStage::None) setRemarkStage(RemarkStage::Threads);
	if (remarkStage() <= RemarkStage::Weak) {
		work += remarkVisits(limit);
		if (remarkStage() != RemarkStage::Roots) return work;
	}
	// Only a synchronous final pass can run inside a temporary host scope.
	// Before final tracing these values need neither marking nor a cursor:
	// the collector cannot reclaim this epoch until the mutator stops.
	if (scopedRoots && remarkStage() < RemarkStage::ClearWeak) {
		markScopedRoots();
		m_stringPool.markLocalRoots();
		markValue(root0); markValue(root1); markValue(root2);
		work += m_stringPool.takeMarkWork();
	}
	return finalMarkTail(limit, work);
}

size_t GcHeap::finalMarkTail(size_t limit, size_t work) {
	if (work >= limit) return work;
	if (remarkStage() == RemarkStage::Roots) {
		work = remarkRoots(valueNil(), valueNil(), valueNil(), limit, work, true);
		if (remarkStage() == RemarkStage::Roots || work >= limit) return work;
	}
	if (remarkStage() == RemarkStage::Trace) {
		return finishAtomicTrace(limit, traceQuantum(true, limit, work));
	}
	return atomicWeakWork(limit, work);
}

size_t GcHeap::finishAtomicTrace(size_t limit, size_t work) {
	if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u || indexWord(GC_TRACE_HEAD) != 0u)
		return work;
	setRemarkStage(RemarkStage::ClearWeak);
	return work >= limit ? work : atomicWeakWork(limit, work);
}

size_t GcHeap::atomicWeakWork(size_t limit, size_t work) {
	return finishAtomicCollection(work + clearWeakQuantum(limit - work));
}

size_t GcHeap::finishAtomicCollection(size_t work) {
	if (memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD) != 0u || indexWord(GC_WEAK_VISITS) != 0u) return work;
	memory.writeRamRecordByte(m_controlOffset + 1u, white() ^ 1u);
	memory.writeRamRecordWord(m_controlOffset + GC_SWEEP_LINK, m_controlOffset + GC_OBJECTS);
	setRemarkStage(RemarkStage::None);
	// Reprice the remaining runway against the post-mark reclamation work.
	beginPaceCredit(memory.readRamRecordWord(m_controlOffset + GC_OBJECT_COUNT) + m_stringPool.estimateSweepWork(), 0u);
	setPhase(GcPhase::Sweep);
	return work;
}

size_t GcHeap::clearWeakQuantum(size_t limit) {
	size_t work = 0;
	while (work < limit) {
		u32 record = memory.readRamRecordWord(m_controlOffset + GC_TRACE_RECORD);
		if (record == 0u) {
			if (indexWord(GC_WEAK_VISITS) == 0u) break;
			work += visitList<tableRecordKind, true>(GC_WEAK_VISITS, [&](u32 address) {
				record = address;
				memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
			}, 1u);
			if (record == 0u || work == limit) break;
		}
		test::NativeTableReference table(*this, record);
		u32 cursor = memory.readRamRecordWord(m_controlOffset + GC_TRACE_CURSOR);
		if (cursor == TABLE_MODE_PENDING) {
			const auto [mode, inspected] = probeTableMode(table, limit - work);
			work += inspected;
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
			table.clearWeakEntries((mode & kTableWeakKeys) != 0u, (mode & kTableWeakValues) != 0u,
				[this](Value value) { return valueIsAlive(value); }, next, stop);
			work += (stop - next) * entryWords + m_stringPool.takeMarkWork();
			next = stop;
		}
		memory.writeRamRecordPair(m_controlOffset + GC_TRACE_RECORD, next < end ? record : 0u,
			next < end ? (u32{mode} << TRACE_CURSOR_BITS) | next : 0u);
	}
	return work;
}

size_t GcHeap::sweepObjects(size_t allowance, u32 growingThread, bool compactThreads) {
	const u32 cursor = m_controlOffset + GC_SWEEP_LINK;
	u32 link = memory.readRamRecordWord(cursor);
	if (link == 0u) return 0;
	u32 address = memory.readRamRecordWord(link);
	const u8 currentWhite = white();
	size_t work = 0;
	u32 removed = 0;
	while (address != 0u && work < allowance) {
		// The cursor names the link to the next unvisited object. Unlink
		// garbage before freeing it, so the cursor always remains live.
		const u32 nextLink = address - GC_OBJECT_LINK_BEFORE;
		const u32 next = memory.readRamRecordWord(nextLink);
		const u32 header = memory.readRamRecordWord(address);
		const bool garbage = ((header >> 8u) & GC_COLOR_MASK) == (currentWhite ^ 1u);
		if (garbage) {
			memory.writeRamRecordWord(link, next);
			++removed;
		} else link = nextLink;
		work += sweepRecord(address, header, garbage, currentWhite, growingThread, compactThreads);
		address = next;
	}
	if (removed != 0u) {
		const u32 count = m_controlOffset + GC_OBJECT_COUNT;
		memory.writeRamRecordWord(count, memory.readRamRecordWord(count) - removed);
	}
	memory.writeRamRecordWord(cursor, address != 0u ? link : 0u);
	return work;
}

inline size_t GcHeap::compactThreadStack(u32 address) {
	const auto layout = ThreadRecord::storageLayout(memory, address);
	const u32 retained = shrinkReferenceThreadStack(*this, address, layout);
	if (retained != 0u) rebindRelocatedThread(address);
	return 2u * ceilDiv4(retained);
}

size_t GcHeap::sweepRecord(u32 address, u32 header, bool garbage, u8 currentWhite, u32 growingThread, bool compactThreads) {
	const u8 kind = static_cast<u8>(header);
	if (!garbage) {
		memory.writeRamRecordByte(address + GC_COLOR_OFFSET, currentWhite);
		if (kind != THREAD_RECORD_KIND || !compactThreads || address == growingThread) return 1;
		return 1u + compactThreadStack(address);
	}
	if (kind == tableRecordKind) {
		test::NativeTableReference(*this, address).freeRecord();
		return 1;
	}
	if (kind != THREAD_RECORD_KIND) {
		const u32 bytes = kind == UPVALUE_RECORD_KIND ? UPVALUE_HEAP_BYTES
			: closureRecordBytes(ClosureRecord::captureCount(memory, address),
				(header & (CLOSURE_LATCHED_PROTOTYPE << (8u * CLOSURE_BINDING_FLAGS))) != 0u);
		budget.releaseObject(address, bytes);
		return 1;
	}
	// Clear any selected execution view before its old record or backing can
	// be reused. View residency does not contribute a root or collector work.
	const auto layout = ThreadRecord::storageLayout(memory, address);
	retireThreadView(address);
	budget.releaseRecord(layout.block, layout.valueBytes());
	budget.releaseRecord(layout.frameBlock, layout.frameBytes());
	budget.releaseObject(address, THREAD_HEAP_BYTES);
	return 1;
}

u32 GcHeap::epochWork() const {
	return memory.readRamRecordWord(m_controlOffset + GC_EPOCH_WORK);
}

u32 GcHeap::workSinceEpoch(u32 before) const {
	return (active() ? epochWork() : memory.readRamRecordWord(m_controlOffset + GC_LAST_EPOCH_WORK)) - before;
}

size_t GcHeap::accountEpochWork(size_t work) {
	const u32 accumulated = epochWork() + static_cast<u32>(work);
	if (active()) {
		memory.writeRamRecordWord(m_controlOffset + GC_EPOCH_WORK, accumulated);
	} else {
		memory.writeRamRecordPair(m_controlOffset + GC_EPOCH_WORK, 0u, accumulated);
		memory.writeRamRecordWord(m_controlOffset + GC_PHYSICAL_ASSIST, 0u);
	}
	return work;
}

void GcHeap::beginPaceCredit(u32 estimate, u32 runwayShift) {
	// Proportional assists: price real allocation growth against the
	// estimated work and a share of the physical room at this frontier.
	// This is not a contiguous-space guarantee.
	const u32 occupied = arena.occupiedBytes();
	const u32 runway = std::max((arena.capacityBytes() - occupied) >> runwayShift, 1u);
	memory.writeRamRecordWord(m_controlOffset + GC_PACE_ESTIMATE, estimate);
	memory.writeRamRecordWord(m_controlOffset + GC_PACE_RUNWAY, runway);
	updatePaceCredit(occupied, 0u, estimate, runway);
}

void GcHeap::updatePaceCredit(u32 basis, u32 paid, u32 estimate, u32 runway) {
	// Carry fractional debt until there is a batch worth stepping. Keep the
	// division on the collector, not the ordinary reservation path.
	constexpr u32 minimumBatch = 512;
	const u32 batch = paid < estimate ? std::min(minimumBatch, estimate - paid) : minimumBatch;
	const u64 product = static_cast<u64>(paid + batch) * runway;
	const i64 next = toSignedWord(basis) + static_cast<i64>((product + estimate - 1u) / estimate);
	memory.writeRamRecordWord(m_controlOffset + GC_PACE_BASIS, basis);
	memory.writeRamRecordWord(m_controlOffset + GC_PACE_PAID, paid);
	memory.writeRamRecordWord(m_controlOffset + GC_PACE_PAY_AT, static_cast<u32>(std::clamp<i64>(next, 0, MAIN_RAM_SIZE)));
}

bool GcHeap::reservationAssistDue(size_t requested) const {
	if (!pacedPhase(phase())) return false;
	const size_t occupiedAfterRequest = arena.occupiedBytes() + requested;
	return occupiedAfterRequest >= memory.readRamRecordWord(m_controlOffset + GC_PACE_PAY_AT)
		|| occupiedAfterRequest >= arena.capacityBytes();
}

std::optional<size_t> GcHeap::reservationAssistAllowance(size_t requested) const {
	// Only a published mutator reservation in a paced phase reaches here.
	const size_t occupiedAfterRequest = arena.occupiedBytes() + requested;
	const size_t capacity = arena.capacityBytes();
	if (occupiedAfterRequest < memory.readRamRecordWord(m_controlOffset + GC_PACE_PAY_AT)
		&& occupiedAfterRequest < capacity) return std::nullopt;
	if (occupiedAfterRequest >= capacity) return GC_STEP_WORDS;
	const auto growth = static_cast<i64>(occupiedAfterRequest)
		- toSignedWord(memory.readRamRecordWord(m_controlOffset + GC_PACE_BASIS));
	const u64 work = static_cast<u64>(growth) * memory.readRamRecordWord(m_controlOffset + GC_PACE_ESTIMATE);
	const u32 paid = memory.readRamRecordWord(m_controlOffset + GC_PACE_PAID);
	const u32 runway = memory.readRamRecordWord(m_controlOffset + GC_PACE_RUNWAY);
	return std::min<u64>(GC_STEP_WORDS, work / runway - paid);
}

void GcHeap::assistBeforeReservation(size_t requested, Value root0, Value root1, Value root2, u32 growingThread, const int* sourceBudget) {
	if (const auto allowance = reservationAssistAllowance(requested))
		assistAllocation(root0, root1, root2, growingThread, *allowance, sourceBudget);
}

size_t GcHeap::step(Value root0, Value root1, Value root2, u32 growingThread, bool compactThreads,
	size_t limit) {
	// Only explicit and space-exhausted collection enters a synchronous final pass.
	if (finalMarkPending()) return finishFinalMark(root0, root1, root2);
	const u32 occupied = arena.occupiedBytes();
	const auto work = stepWork(root0, root1, root2, growingThread, compactThreads, limit);
	return finishStepWork(occupied, work);
}

size_t GcHeap::finishStepWork(u32 occupiedBefore, size_t work) {
	if (active()) {
		// Every quantum, whichever assist ran it, pays the current pace,
		// including the first one after a cycle priced its runway.
		// Swept bytes are not a refund of allocation work already paid.
		const u32 basis = memory.readRamRecordWord(m_controlOffset + GC_PACE_BASIS);
		const u32 paid = memory.readRamRecordWord(m_controlOffset + GC_PACE_PAID);
		updatePaceCredit(basis + arena.occupiedBytes() - occupiedBefore, paid + static_cast<u32>(work),
			memory.readRamRecordWord(m_controlOffset + GC_PACE_ESTIMATE), memory.readRamRecordWord(m_controlOffset + GC_PACE_RUNWAY));
	}
	return accountEpochWork(work);
}

size_t GcHeap::stepWork(Value root0, Value root1, Value root2, u32 growingThread, bool compactThreads,
	size_t limit) {
	size_t work = 0;
	if (remarkStage() != RemarkStage::None) {
		work += remarkVisits(limit);
		if (remarkStage() != RemarkStage::Roots) return work;
		work = remarkRoots(root0, root1, root2, limit, work, false);
		if (phase() == GcPhase::Mark) return work;
	} else if (phase() == GcPhase::Pause || phase() == GcPhase::Mark || phase() == GcPhase::MarkAgain) {
		if (phase() == GcPhase::Pause) {
			setPhase(GcPhase::Mark);
			m_stringPool.beginReachabilityEpoch();
			m_stringPool.markReachable(diagnosticWord(GcDiagnosticField::Mode));
			markRootHead();
			beginInitialBanks();
		}
		if (memory.readRamRecordWord(m_controlOffset + GC_ROOT_CURSOR) != 0u) {
			work += m_stringPool.takeMarkWork();
			if (work < limit) {
				work = traceRootBanks(limit, work, GcRootBank::End);
			}
		}
		markValue(root0); markValue(root1); markValue(root2);
		work += m_stringPool.takeMarkWork();
	}
	while (work < limit && active()) {
		switch (phase()) {
			case GcPhase::Mark:
			case GcPhase::MarkAgain: {
				work = traceQuantum(false, limit, work);
				work = finishMajorTrace(root0, root1, root2, limit, work);
				if (work >= limit || phase() != GcPhase::MarkAgain) return work;
				break;
			}
			case GcPhase::Atomic: return work;
			case GcPhase::Sweep: {
				work += sweepObjects(limit - work, growingThread, compactThreads);
				if (work < limit && memory.readRamRecordWord(m_controlOffset + GC_SWEEP_LINK) == 0u) beginStrings();
				break;
			}
			case GcPhase::Strings: {
				work += m_stringPool.sweepStep(limit - work);
				finishStrings();
				return work;
			}
			case GcPhase::Pause: break;
		}
	}
	return work;
}

size_t GcHeap::finishMajorTrace(Value root0, Value root1, Value root2, size_t limit, size_t work) {
	if (work >= limit) return work;
	if (phase() == GcPhase::MarkAgain) {
		setPhase(GcPhase::Atomic);
		return work;
	}
	setRemarkStage(RemarkStage::Threads);
	work += remarkVisits(limit - work);
	if (remarkStage() != RemarkStage::Roots) return work;
	return remarkRoots(root0, root1, root2, limit, work, false);
}

void GcHeap::beginStrings() {
	memory.writeRamRecordWord(m_controlOffset + GC_CHANGED_HEAD, 0u);
	setPhase(GcPhase::Strings);
	m_stringPool.beginSweep();
}

void GcHeap::finishStrings() {
	if (!m_stringPool.sweeping()) {
		setPhase(GcPhase::Pause);
		budget.finishCollection();
	}
}

LuaAllocationRecovery GcHeap::beginAllocationRecovery(LuaAllocationRecovery next) {
	if (next == LuaAllocationRecovery::Exhausted) throw LuaOutOfMemorySignal{};
	const bool first = next == LuaAllocationRecovery::CurrentOrFresh;
	const bool continueCurrent = first && active();
	return continueCurrent ? LuaAllocationRecovery::Fresh : LuaAllocationRecovery::Exhausted;
}

LuaAllocationRecovery GcHeap::recoverAllocation(LuaAllocationRecovery next, Value root0, Value root1, Value root2, u32 growingThread) {
	const auto afterEpoch = beginAllocationRecovery(next);
	// Recovery finishes just this epoch, without allocating to shrink live stacks.
	do { chargeCollectionWork(step(root0, root1, root2, growingThread, false, GC_STEP_WORDS)); } while (active());
	return afterEpoch;
}

size_t GcHeap::stepFullCollection(u32 epochs, size_t words) {
	const size_t work = finalMarkPending() ? stepFinalMark(words)
		: step(valueNil(), valueNil(), valueNil(), 0u, true, words);
	if (!active()) memory.writeRamRecordByte(m_controlOffset + GC_FULL_EPOCHS, epochs - 1u);
	return work;
}

void GcHeap::beginInitialBanks() {
	memory.writeRamRecordWord(m_controlOffset + GC_ROOT_CURSOR, static_cast<u32>(GcRootBank::SystemGlobals) << TRACE_CURSOR_BITS);
	// Price the new cycle after marking the fixed roots. Half the space
	// remains available for growth through the final pass and sweep.
	const u32 previous = memory.readRamRecordWord(m_controlOffset + GC_LAST_EPOCH_WORK);
	beginPaceCredit(previous != 0u ? previous : std::max(arena.occupiedBytes() >> 2u, 1u), 1u);
}

size_t GcHeap::collect(Value root0, Value root1, Value root2, u32 growingThread) {
	size_t work = 0;
	// An explicit/full collection also removes floating garbage from an active cycle.
	while (active()) work += step(root0, root1, root2, growingThread, true);
	do { work += step(root0, root1, root2, growingThread, true); } while (active());
	return work;
}
u32 GcHeap::objectRecordAddress(u32 address, u8 kind) const {
	const u32 offset = address & GC_RECORD_MASK;
	return memory.readRamRecordByte(offset) == kind
		&& arena.issuedObjectStart(offset - GC_OBJECT_PREFIX) ? RAM_BASE + offset : 0u;
}

u32 GcHeap::threadRecordAddress(u32 address) const {
	return objectRecordAddress(address, THREAD_RECORD_KIND);
}

u32 GcHeap::closureRecordAddress(u32 address) const {
	return objectRecordAddress(address, static_cast<u8>(ValueTag::Closure));
}

u32 GcHeap::tableRecordAddress(u32 address) const {
	return objectRecordAddress(address, tableRecordKind);
}

u32 GcHeap::cellRecordAddress(u32 address) const {
	return objectRecordAddress(address, UPVALUE_RECORD_KIND);
}

u32 GcHeap::openCellAddress(u32 address) const {
	const u32 cell = cellRecordAddress(address);
	return cell != 0u && Upvalue::isOpen(memory, cell) ? cell : 0u;
}

void GcHeap::markRootHead() {
	using Field = GcDiagnosticField;
	// Opcode metamethod selectors stay interned independently of guest tables.
	markString(diagnosticWord(Field::Index));
	markString(diagnosticWord(Field::NewIndex));
	markString(diagnosticWord(Field::Length));
	markString(diagnosticWord(Field::Error));
	const u32 faults = diagnosticWord(Field::FaultIds);
	for (u32 reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
		if (reason != LUA_FAULT_REASON_EXPLICIT_ERROR) markString(memory.readRamRecordWord(faults + reason * sizeof(u32)));
	markValue(valueFromTag(static_cast<ValueTag>(diagnosticWord(Field::StringIndexTag)),
		diagnosticWord(Field::StringIndexWord)));
	if (m_cpu.m_stringComparison.remaining) { markString(m_cpu.m_stringComparison.left); markString(m_cpu.m_stringComparison.right); }
}

void GcHeap::markScopedRoots() {
	for (size_t scratchIndex = 0; scratchIndex < m_cpu.m_builtinResultScratchIndex; ++scratchIndex) {
		BuiltinResults& scratch = m_cpu.m_builtinResultScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			markValue(scratch[valueIndex]);
		}
	}
}

size_t GcHeap::rootBankEnd(GcRootBank bank) const {
	if (bank == GcRootBank::SystemGlobals) return m_cpu.m_systemGlobalBank.count();
	if (bank == GcRootBank::Globals) return m_cpu.m_globalBank.count();
	if (bank == GcRootBank::Completion) return m_cpu.m_completionValueCount;
	const u32 storage = firmwareImageStorageOffset(arena.managementOffset(),
		static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	return memory.readRamRecordWord(storage + FIRMWARE_IMAGE_STORAGE_RAM_STRING_END_OFFSET);
}

size_t GcHeap::markRootBank(GcRootBank bank, size_t& next, size_t end, size_t allowance) {
	const size_t stop = std::min(end, next + allowance);
	const size_t slotsVisited = stop - next;
	if (bank < GcRootBank::SystemConstants) {
		const auto& names = bank == GcRootBank::SystemGlobals ? m_cpu.m_systemGlobalBank : m_cpu.m_globalBank;
		const auto slots = names.values();
		for (; next < stop; ++next) {
			markString(NativeGlobalBankReference::name(names, next));
			markValue(slots.get(next));
		}
		return slotsVisited;
	}
	if (bank == GcRootBank::Completion) {
		for (; next < stop; ++next) markValue(m_cpu.m_completionValues.get(next));
		return slotsVisited;
	}
	const u32 binding = executionImageBindingOffset(static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	const u32 roots = memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	size_t marked = 0;
	// A literal bank resumes at a physical ordinal. As in the original
	// compact root scan, only the RAM String roots consume this allowance.
	for (; next < end && marked < allowance; ++next) {
		const StringId id = memory.readRamRecordWord(roots + static_cast<u32>(next) * 4u);
		if (!isRamStringId(id)) continue;
		markString(id);
		++marked;
	}
	return marked;
}

void GcHeap::markRootThreads() {
	markThread(m_cpu.m_rootView.address);
	if (m_cpu.m_activeThread) markThread(m_cpu.m_activeThread->address);
	markThread(m_cpu.m_completionThreadAddress);
	markThread(m_cpu.m_haltedUntilIrqThreadAddress);
}

void GcHeap::retireThreadView(u32 address) {
	for (auto& view : m_cpu.m_transferViews) {
		if (view.address != address) continue;
		view.select(0u);
		return;
	}
}

void GcHeap::rebindRelocatedThread(u32 address) {
	m_cpu.visitThreadViews([&](Thread& thread) {
		if (thread.address != address) return;
		thread.bindStack();
	});
}

void GcHeap::chargeCollectionWork(size_t work) {
	if (m_cpu.m_runKind != CpuRunKind::Idle) m_cpu.instructionBudgetRemaining -= GC_WORK_WORD_CYCLES * static_cast<int>(work);
}

size_t GcHeap::assistAllocation(Value root0, Value root1, Value root2, u32 growingThread, size_t words, const int* sourceBudget) {
	if (m_cpu.m_runKind != CpuRunKind::Idle || sourceBudget) {
		const int remaining = sourceBudget ? *sourceBudget : m_cpu.instructionBudgetRemaining;
		if (remaining < GC_WORK_WORD_CYCLES) return 0;
		words = std::min(words, static_cast<size_t>(remaining / GC_WORK_WORD_CYCLES));
	}
	const size_t work = step(root0, root1, root2, growingThread, false, words);
	chargeCollectionWork(work);
	return work;
}

} // namespace bmsx::test
