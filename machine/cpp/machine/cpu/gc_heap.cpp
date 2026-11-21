#include "machine/cpu/gc_heap.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"
#include "machine/common/numeric.h"
#include "spec/blua32/image_format.h"
#include <algorithm>
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
size_t GcHeap::visitList(u32 list, Visitor&& visitor) {
	u32 index = indexWord(list);
	u32 remaining = indexWord(list + GC_VISIT_COUNT);
	size_t work = 0;
	while (index != 0u && remaining-- != 0u) {
		const u32 address = RAM_BASE + (index << GC_RECORD_SHIFT);
		const u8 meta = memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
		// Only the matching, linked record clocks the list port.
		if (!(meta & GC_VISIT_MEMBER)) break;
		if constexpr (Kind == tableRecordKind) {
			if (tableRecordAddress(address) != address) break;
		} else {
			static_assert(Kind == THREAD_RECORD_KIND);
			if (threadRecordAddress(address) == 0u) break;
		}
		const u32 low = memory.readRamRecordWord(address + GC_RECORD_LINK) >> GC_GRAY_INDEX_BITS;
		index = low | ((meta & VISIT_LINK_HIGH_MASK) << VISIT_LINK_LOW_BITS);
		if constexpr (Drain) setVisitLink(address, meta & ~GC_VISIT_MEMBER, 0u);
		work += visitor(address);
	}
	if constexpr (Drain) {
		memory.writeRamRecordPair(m_controlOffset + list, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + list + GC_VISIT_COUNT, 0u);
	}
	return work;
}

u32 GcHeap::threadRecordAddress(u32 address) const {
	const u32 offset = address & GC_RECORD_MASK;
	return (offset & (THREAD_HEAP_BYTES - 1u)) == 0u && offset < arena.managementOffset()
		&& memory.readRamRecordByte(offset) == THREAD_RECORD_KIND
		&& arena.issuedObjectSlotClass(offset) == threadSlotClass ? RAM_BASE + offset : 0u;
}

bool GcHeap::markThread(u32 address) {
	const u32 offset = address & GC_RECORD_MASK;
	if ((offset & (THREAD_HEAP_BYTES - 1u)) != 0u || offset >= arena.managementOffset()) return false;
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
	return THREAD_HEAP_BYTES + heapAllocationBytes(ThreadRecord::stackLayout(memory, threadAddress).byteLength());
}
uint8_t GcHeap::tableWeakMode(const TableRecord& table) {
	const u32 meta = table.metatableAddress();
	if (meta == 0u) {
		return 0;
	}
	const u32 address = tableRecordAddress(meta);
	if (address == 0u) return 0;
	const Value modeValue = TableRecord(*this, address).getStringKey(m_modeKey);
	if (!valueIsString(modeValue)) {
		return 0;
	}
	const StringId mode = asStringId(modeValue);
	const int length = m_stringPool.byteLength(mode);
	uint8_t weakMode = 0;
	for (int i = 0; i < length; ++i) {
		const auto ch = m_stringPool.byteAt(mode, i);
		switch (ch) {
			case 'k':
				weakMode |= kTableWeakKeys;
				break;
			case 'v':
				weakMode |= kTableWeakValues;
				break;
		}
	}
	return weakMode;
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

size_t GcHeap::trace(bool atomic) {
	const u32 index = indexWord(GC_TRACE_HEAD);
	const u32 offset = index << GC_RECORD_SHIFT, address = RAM_BASE + offset;
	const u8 kind = offset < arena.managementOffset() ? memory.readRamRecordByte(address) : 0u;
	const bool table = kind == tableRecordKind && (offset & (TableRecord::HEADER_BYTES - 1u)) == 0u
		&& arena.issuedObjectSlotClass(offset) == tableSlotClass;
	const bool cell = kind == UPVALUE_RECORD_KIND && (offset & (UPVALUE_HEAP_BYTES - 1u)) == 0u
		&& arena.issuedObjectSlotClass(offset) == cellSlotClass && !Upvalue::isOpen(memory, address);
	const bool closure = kind == static_cast<u8>(ValueTag::Closure) && arena.issuedObjectStart(offset);
	const bool thread = kind == THREAD_RECORD_KIND && (offset & (THREAD_HEAP_BYTES - 1u)) == 0u
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
	if (table) return traceTable(address);
	if (cell) {
		markValue(Upvalue::load(memory, address));
		return UPVALUE_HEAP_BYTES / sizeof(u32);
	}
	if (closure) {
		const u32 count = ClosureRecord::captureCount(memory, address);
		size_t work = 3u + count;
		for (u32 index = 0; index < count; ++index)
			work += markCell(cellRecordAddress(ClosureRecord::captureAddress(memory, address, index)));
		return work;
	}
	size_t cellWork = 0;
	if (!atomic) appendVisit(GC_THREAD_VISITS, address);
	markThread(ThreadRecord::read(memory, address, ThreadField::Resumer));
	markClosure(ThreadRecord::read(memory, address, ThreadField::Entry));
	markValue(ThreadRecord::error(memory, address));
	const auto layout = ThreadRecord::stackLayout(memory, address);
	const u32 depth = ThreadRecord::count(memory, address, ThreadField::FrameDepth);
	u32 liveTop = 0;
	if (depth != 0u) {
		const u32 frame = layout.frameAddress(depth - 1u);
		const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
		const u32 top = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Top)) & FRAME_WINDOW_MASK;
		const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
		liveTop = base + std::min(top, capacity);
	}
	u32 frame = layout.frameAddress(0);
	for (u32 index = 0; index < depth; ++index, frame += FRAME_CONTROL_BYTES) {
		markClosure(memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Closure)));
		u32 open = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::OpenHead));
		for (u32 remaining = UPVALUE_CHAIN_LIMIT; open != 0 && remaining != 0; --remaining) {
			const u32 cell = openCellAddress(open);
			if (cell == 0u) break;
			cellWork += markCell(cell);
			const u32 slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
			if (slot < layout.valueCapacity) liveTop = std::max(liveTop, slot + 1u);
			open = memory.readRamRecordWord(cell + UPVALUE_NEXT);
		}
	}
	const u32 protectedDepth = ThreadRecord::count(memory, address, ThreadField::ProtectedDepth);
	for (u32 index = 0; index < protectedDepth; ++index) {
		const u32 continuation = layout.protectedAddress(index);
		const u32 flags = memory.readRamRecordWord(continuation + static_cast<u32>(ProtectedField::Flags));
		if ((flags & PROTECTED_CALL_KIND_MASK) != static_cast<u32>(ProtectedCallKind::PCall)
			&& (flags & PROTECTED_CALL_HANDLER_BUILTIN) == 0u) {
			markClosure(memory.readRamRecordWord(continuation + static_cast<u32>(ProtectedField::Handler)));
		}
	}
	auto slots = layout.slots(memory, liveTop > layout.valueCapacity);
	for (u32 index = 0; index < liveTop; ++index) markValue(slots.get(index));
	if (liveTop < layout.valueCapacity) slots.clear(liveTop, layout.valueCapacity - liveTop);
	return cellWork + ceilDiv4(static_cast<int>(THREAD_HEAP_BYTES + heapAllocationBytes(layout.byteLength())));
}

size_t GcHeap::traceTable(u32 address) {
	const TableRecord table(*this, address);
	const u32 meta = table.metatableAddress();
	if (meta != 0u) markTable(meta);
	const u8 weakMode = tableWeakMode(table);
	if (weakMode != 0u) appendVisit(GC_WEAK_VISITS, address);
	if ((weakMode & kTableWeakKeys) == 0u) {
		table.forEachEntry([this, weakMode](Value key, Value value) {
			markValue(key);
			if (weakMode == 0u) markValue(value);
		});
	}
	return TableRecord::HEADER_BYTES / sizeof(u32) + table.scanSlots();
}

size_t GcHeap::remark(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement measurement(profile.rootsNanoseconds);
#endif
	const auto requeue = [&](u32 address) {
		if (markColor(address) == 3u) enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
		return 0u;
	};
	visitList<THREAD_RECORD_KIND, true>(GC_THREAD_VISITS, requeue);
	// Also observe mode changes made through a shared metatable.
	visitList<tableRecordKind, false>(GC_WEAK_VISITS, requeue);
	// The current trace queue is empty. Further writes go to grayAgain, so
	// mutation cannot continually put the same object in this pass's queue.
	memory.writeRamRecordPair(m_controlOffset + GC_TRACE_HEAD, indexWord(GC_CHANGED_HEAD), 0u);
	m_cpu.markRoots(*this);
	m_stringPool.markLocalRoots();
	markValue(root0); markValue(root1); markValue(root2);
	return m_cpu.collectionRootWordCount() + m_stringPool.takeMarkWork();
}

size_t GcHeap::atomic(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	GcPhaseMeasurement totalAtomic(m_cpu.m_diagnosticGcProfile.atomicNanoseconds);
#endif
	size_t work = remark(root0, root1, root2);
	work += resolveWeak();
	m_cpu.pruneStaticClosures();
	memory.writeRamRecordByte(m_controlOffset + 1u, white() ^ 1u);
	arena.beginObjectSweep();
	setPhase(GcPhase::Sweep);
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
	bool changed;
	do {
		changed = false;
		work += visitList<tableRecordKind, false>(GC_WEAK_VISITS, [&](u32 address) -> size_t {
			const TableRecord table(*this, address);
			if (tableWeakMode(table) != kTableWeakKeys) return 0;
			table.forEachEntry([&](Value key, Value value) {
				if (valueIsAlive(key) && markValue(value)) changed = true;
			});
			return table.scanSlots();
		});
		while (indexWord(GC_TRACE_HEAD) != 0u) {
			work += trace(true);
			work += m_stringPool.takeMarkWork();
		}
	} while (changed);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	timing.phase(profile.weakNanoseconds);
#endif
	work += visitList<tableRecordKind, true>(GC_WEAK_VISITS, [&](u32 address) {
		TableRecord table(*this, address);
		const auto mode = tableWeakMode(table);
		const auto slots = table.scanSlots();
		table.clearWeakEntries((mode & 1) != 0, (mode & 2) != 0,
			[this](Value value) { return valueIsAlive(value); });
		table.forEachEntry([this](Value key, Value value) {
			if (valueIsString(key)) markString(asStringId(key));
			if (valueIsString(value)) markString(asStringId(value));
		});
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
				if (heap.m_minor && kind == static_cast<u8>(ValueTag::Closure)) heap.m_cpu.retireStaticClosure(address);
				heap.arena.free(address);
			}
			return -1;
		}
		heap.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
		return 1;
	}
	if (kind != THREAD_RECORD_KIND || heap.threadRecordAddress(address) == 0u) return 1;
	const auto layout = ThreadRecord::stackLayout(heap.memory, address);
	const i32 work = ceilDiv4(static_cast<int>(THREAD_HEAP_BYTES + heapAllocationBytes(layout.byteLength())));
	if (!garbage) {
		heap.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
		const u32 relocated = !heap.m_minor && address != sweep.growingThread ? ThreadRecord::shrinkStack(heap, address, layout) : 0u;
		if (relocated != 0u) heap.m_cpu.rebindRelocatedThread(address);
		return work + 2 * ceilDiv4(relocated);
	}

	// Clear any selected execution view before its old record or backing can
	// be reused. View residency does not contribute a root or collector work.
	heap.m_cpu.retireThreadView(address);
	heap.arena.free(layout.block);
	heap.arena.free(address);
	return -work;
}

size_t GcHeap::step(Value root0, Value root1, Value root2, u32 growingThread) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcStepMeasurement total(profile);
#endif
	size_t work = 0;
	if (phase() == GcPhase::Pause || phase() == GcPhase::Mark || phase() == GcPhase::MarkAgain) {
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
			m_cpu.markRoots(*this);
			work += m_cpu.collectionRootWordCount();
		}
		markValue(root0); markValue(root1); markValue(root2);
		m_stringPool.markLocalRoots();
		work += m_stringPool.takeMarkWork();
	}
	while (work < GC_STEP_WORDS && active()) {
		switch (phase()) {
			case GcPhase::Mark:
			case GcPhase::MarkAgain: {
				{
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
					GcPhaseMeasurement traceTime(phase() == GcPhase::Mark ? profile.traceNanoseconds : profile.markAgainNanoseconds);
#endif
					while (indexWord(GC_TRACE_HEAD) != 0u && work < GC_STEP_WORDS) {
						work += trace(false);
						work += m_stringPool.takeMarkWork();
					}
				}
				if (work < GC_STEP_WORDS) {
					if (phase() == GcPhase::Mark) {
						work += remark(root0, root1, root2);
						setPhase(GcPhase::MarkAgain);
					} else {
						setPhase(GcPhase::Atomic);
						return work;
					}
				}
				break;
			}
			case GcPhase::Atomic: return atomic(root0, root1, root2);
			case GcPhase::Sweep: {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
				GcPhaseMeasurement sweepTime(profile.sweepNanoseconds);
#endif
				SweepContext sweep{*this, growingThread, white()};
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
	while (active()) work += step(root0, root1, root2, growingThread);
	do { work += step(root0, root1, root2, growingThread); } while (active());
	return work;
}
} // namespace bmsx
