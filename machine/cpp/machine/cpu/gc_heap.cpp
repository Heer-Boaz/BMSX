#include "machine/cpu/gc_heap.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include <algorithm>
#include <new>
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
	explicit GcStepMeasurement(DiagnosticGcProfile& profile) : m_profile(profile), m_start(GcProfileClock::now()) { ++profile.steps; }
	~GcStepMeasurement() {
		const u64 elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(GcProfileClock::now() - m_start).count());
		m_profile.totalNanoseconds += elapsed;
		m_profile.maxStepNanoseconds = std::max(m_profile.maxStepNanoseconds, elapsed);
		if (elapsed > 2000000) ++m_profile.stepsOver2ms;
		if (elapsed > 8000000) ++m_profile.stepsOver8ms;
	}
private:
	DiagnosticGcProfile& m_profile;
	GcProfileClock::time_point m_start;
};
#endif

constexpr uint8_t kTableWeakKeys = 1, kTableWeakValues = 2;
}
void GCObject::setGcColor(uint8_t color) {
	gcMemory->writeRamRecordByte(static_cast<u32>(gcRecord - gcMemory->ramData()) + GC_COLOR_OFFSET, color);
}

bool GcHeap::markValue(Value v) {
	switch (valueTag(v)) {
		case ValueTag::Thread:
			return markObject(asThread(v, *this));
		case ValueTag::Table:
			return markObject(asTable(v, *this));
		case ValueTag::Closure:
			return markObject(asClosure(v, *this));
		case ValueTag::BuiltinFunction:
			return false;
		case ValueTag::String:
			m_stringPool.markReachable(asStringId(v));
			return false;
		default:
			return false;
	}
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
size_t GcHeap::nativePhysicalRecordsOffset() { return offsetof(GcHeap, m_recordBase); }
size_t GcHeap::nativeControlOffset() { return offsetof(GcHeap, m_controlOffset); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif
void GcHeap::track(GCObject* object) {
	const u32 address = physicalAddress(object);
	physicalSlot(address) = object;
	object->gcRecord = memory.ramData() + (address & GC_RECORD_MASK);
	object->gcMemory = &memory;
	object->previous = nullptr;
	object->next = m_objects;
	if (m_objects) m_objects->previous = object;
	m_objects = object;
}
Closure* GcHeap::bindClosureRecord(u32 address, const FunctionPrototype& prototype, bool canonical) {
	const auto entry = m_prototypes.try_emplace(prototype, 0u).first;
	auto* closure = new Closure(memory, address, entry->first, canonical);
	++entry->second;
	closure->type = ObjType::Closure;
	track(closure);
	return closure;
}
GcHeap::~GcHeap() {
	while (m_objects) {
		auto* object = m_objects; m_objects = object->next; destroyObject(object);
	}
}
void GcHeap::enqueue(u32 address, u32 link, u32 queue) {
	const u32 previous = indexWord(queue);
	const u32 otherBits = link == GC_RECORD_LINK ? memory.readRamRecordWord(address + link) & ~GC_GRAY_INDEX_MASK : 0u;
	memory.writeRamRecordWord(address + link, otherBits | previous);
	memory.writeRamRecordByte(address + GC_COLOR_OFFSET, 2);
	memory.writeRamRecordWord(m_controlOffset + queue, (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT);
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

template<ObjType Kind, bool Drain, class Visitor>
size_t GcHeap::visitList(u32 list, Visitor&& visitor) {
	u32 index = indexWord(list);
	u32 remaining = indexWord(list + GC_VISIT_COUNT);
	size_t work = 0;
	while (index != 0u && remaining-- != 0u) {
		const u32 address = index << GC_RECORD_SHIFT;
		const u8 meta = memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
		auto* record = m_records[index];
		// Only the matching, linked record clocks the list port.
		if (!(meta & GC_VISIT_MEMBER) || !record || record->type != Kind) break;
		const u32 low = memory.readRamRecordWord(address + GC_RECORD_LINK) >> GC_GRAY_INDEX_BITS;
		index = low | ((meta & VISIT_LINK_HIGH_MASK) << VISIT_LINK_LOW_BITS);
		if constexpr (Drain) setVisitLink(address, meta & ~GC_VISIT_MEMBER, 0u);
		work += visitor(record);
	}
	if constexpr (Drain) {
		memory.writeRamRecordPair(m_controlOffset + list, 0u, 0u);
		memory.writeRamRecordWord(m_controlOffset + list + GC_VISIT_COUNT, 0u);
	}
	return work;
}

bool GcHeap::markObject(GCObject* object) {
	if (!object || object->gcColor() != white()) return false;
	enqueue(physicalAddress(object), GC_RECORD_LINK, GC_TRACE_HEAD);
	return true;
}

size_t GcHeap::markCell(Upvalue* cell) {
	if (!cell || cell->gcColor() != white()) return 0;
	cell->setGcColor(3);
	if (cell->isOpen()) markObject(threadAt(cell->ownerAddress()));
	markValue(cell->value());
	return UPVALUE_HEAP_BYTES / sizeof(u32);
}

void GcHeap::armThreadStackWatches() {
	for (auto* object = m_objects; object; object = object->next)
		if (object->type == ObjType::Thread) {
			auto* thread = static_cast<Thread*>(object);
			thread->armStackWatch();
			thread->armFrameWindowWatches();
		}
}

bool GcHeap::observeStackWrites(u32 first, u32 end, const Thread* active) {
	bool rebound = false;
	for (u32 address = first & ~(static_cast<u32>(THREAD_HEAP_BYTES) - 1u); address < end; address += THREAD_HEAP_BYTES) {
		const u32 descriptor = address + static_cast<u32>(ThreadField::StackBlock);
		const u32 depth = address + static_cast<u32>(ThreadField::FrameDepth);
		const bool cursorWrite = first <= depth && depth < end;
		if (!cursorWrite && (end <= descriptor || first >= descriptor + 16u)) continue;
		if (auto* thread = threadAt(address)) {
			if (cursorWrite) {
				m_cpu.bindPhysicalFrames(*thread);
				thread->armStackWatch();
				rebound |= thread == active;
			} else rebound |= thread->observeStackWrite() && thread == active;
		}
	}
	for (auto* object = m_objects; object; object = object->next) {
		if (object->type != ObjType::Thread) continue;
		auto* thread = static_cast<Thread*>(object);
		rebound |= thread->observeFrameWindowWrites(first, end) && thread == active;
	}
	return rebound;
}

size_t GcHeap::allocationBytes(const GCObject* object) const {
	switch (object->type) {
		case ObjType::Table: return static_cast<const Table*>(object)->trackedHeapBytes();
		case ObjType::Closure: {
			const auto* closure = static_cast<const Closure*>(object);
			return heapAllocationBytes(closureRecordBytes(closure->upvalueCount(), closure->hasLatchedPrototype()));
		}
		case ObjType::Upvalue: return UPVALUE_HEAP_BYTES;
		case ObjType::Thread: return THREAD_HEAP_BYTES + heapAllocationBytes(static_cast<const Thread*>(object)->backingByteLength());

	}
	BMSX_UNREACHABLE();
}
uint8_t GcHeap::tableWeakMode(const Table& table) const {
	const auto* meta = table.metatable();
	if (!meta) {
		return 0;
	}
	const Value modeValue = meta->getStringKey(m_modeKey);
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
		case ValueTag::Thread:
			return isAlive(asThread(value, *this));
		case ValueTag::Table:
			return isAlive(asTable(value, *this));
		case ValueTag::Closure: {
			const Closure* closure = asClosure(value, *this);
			return isAlive(closure);
		}
		default:
			return true;
	}
}

size_t GcHeap::trace(bool atomic) {
	const u32 index = indexWord(GC_TRACE_HEAD);
	auto* obj = m_records[index];
	// A link is clocked only by a queued record. Consuming its color bounds
	// malformed cycles as well as preventing a duplicate scan.
	if (!obj || obj->gcColor() != 2u) {
		memory.writeRamRecordWord(m_controlOffset + GC_TRACE_HEAD, 0u);
		return 0;
	}
	const u32 address = index << GC_RECORD_SHIFT;
	const u32 link = address + (obj->type == ObjType::Upvalue ? UPVALUE_NEXT : GC_RECORD_LINK);
	const u32 packed = memory.readRamRecordWord(link);
	memory.writeRamRecordWord(m_controlOffset + GC_TRACE_HEAD, packed & GC_GRAY_INDEX_MASK);
	memory.writeRamRecordWord(link, obj->type != ObjType::Upvalue ? packed & ~GC_GRAY_INDEX_MASK : 0u);
	obj->setGcColor(3);
	switch (obj->type) {
		case ObjType::Thread: {
			auto* thread = static_cast<Thread*>(obj);
			size_t cellWork = 0;
			if (!atomic) appendVisit(GC_THREAD_VISITS, thread->address);
			markObject(thread->resumer());
			markObject(thread->entry());
			markValue(thread->error());
			int liveTop = thread->currentFrame ? thread->currentFrame->stackBase()
				+ std::min(thread->currentFrame->readWindow(FrameField::Top), thread->currentFrame->stackCapacity()) : 0;
			CallFrame* frame = thread->firstFrame;
			for (size_t depth = 0; depth < thread->frameDepth(); ++depth, frame = frame->next) {
				markObject(frame->attachedClosure());
				u32 address = frame->readControl(FrameField::OpenHead);
				for (u32 remaining = UPVALUE_CHAIN_LIMIT; address != 0 && remaining != 0; --remaining) {
					auto* upvalue = openCellAt(address);
					if (!upvalue) break;
					cellWork += markCell(upvalue);
					const u32 slot = upvalue->stackSlot();
					if (slot < thread->stackCapacity)
						liveTop = std::max(liveTop, static_cast<int>(slot + 1));
					address = upvalue->nextAddress();
				}
			}
			for (int slot = 0; slot < liveTop; ++slot) markValue(thread->stack.get(slot));
			if (static_cast<size_t>(liveTop) < thread->stackCapacity)
				thread->stack.clear(liveTop, thread->stackCapacity - liveTop);
			thread->trimFrames();
			return cellWork + ceilDiv4(static_cast<int>(allocationBytes(thread)));
		}
		case ObjType::Table: {
			auto* table = static_cast<Table*>(obj);
			markObject(table->metatable());
			const uint8_t weakMode = tableWeakMode(*table);
			if (weakMode != 0) appendVisit(GC_WEAK_VISITS, table->address());
			if ((weakMode & kTableWeakKeys) == 0) {
				table->forEachEntry([this, weakMode](Value key, Value value) {
					markValue(key);
					if (weakMode == 0) {
						markValue(value);
					}
				});
			}
			return Table::HEADER_BYTES / sizeof(u32) + table->scanSlots();
		}
		case ObjType::Closure: {
			auto* closure = static_cast<Closure*>(obj);
			const u32 count = closure->upvalueCount();
			size_t work = 3u + count;
			for (u32 index = 0; index < count; ++index) work += markCell(cellAt(closure->captureAddress(index)));
			return work;
		}
		case ObjType::Upvalue:
			// Only closed, changed cells enter the queue.
			markValue(static_cast<Upvalue*>(obj)->value());
			return UPVALUE_HEAP_BYTES / sizeof(u32);
	}
	BMSX_UNREACHABLE();
}

size_t GcHeap::remark(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement measurement(profile.rootsNanoseconds);
#endif
	const auto requeue = [&](GCObject* record) {
		writeBarrier(physicalAddress(record), GC_RECORD_LINK);
		return 0u;
	};
	visitList<ObjType::Thread, true>(GC_THREAD_VISITS, requeue);
	// Also observe mode changes made through a shared metatable.
	visitList<ObjType::Table, false>(GC_WEAK_VISITS, requeue);
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
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement measurement(profile.traceNanoseconds);
#endif
	while (indexWord(GC_TRACE_HEAD) != 0u) {
		work += trace(true);
		work += m_stringPool.takeMarkWork();
	}
	bool changed;
	do {
		changed = false;
		work += visitList<ObjType::Table, false>(GC_WEAK_VISITS, [&](GCObject* record) -> size_t {
			auto* table = static_cast<Table*>(record);
			if (tableWeakMode(*table) != kTableWeakKeys) return 0;
			table->forEachEntry([&](Value key, Value value) {
				if (valueIsAlive(key) && markValue(value)) changed = true;
			});
			return table->scanSlots();
		});
		while (indexWord(GC_TRACE_HEAD) != 0u) {
			work += trace(true);
			work += m_stringPool.takeMarkWork();
		}
	} while (changed);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	measurement.phase(profile.weakNanoseconds);
#endif
	work += visitList<ObjType::Table, true>(GC_WEAK_VISITS, [&](GCObject* record) {
		auto* table = static_cast<Table*>(record);
		const auto mode = tableWeakMode(*table);
		const auto slots = table->scanSlots();
		table->clearWeakEntries((mode & 1) != 0, (mode & 2) != 0,
			[this](Value value) { return valueIsAlive(value); });
		table->forEachEntry([this](Value key, Value value) {
			if (valueIsString(key)) m_stringPool.markReachable(asStringId(key));
			if (valueIsString(value)) m_stringPool.markReachable(asStringId(value));
		});
		return slots;
	});
	m_cpu.pruneStaticClosures();
	memory.writeRamRecordByte(m_controlOffset + 1u, white() ^ 1u);
	arena.beginObjectSweep();
	setPhase(GcPhase::Sweep);
	return work + m_stringPool.takeMarkWork();
}
void GcHeap::unlink(GCObject* object) {
	if (object->previous) object->previous->next = object->next;
	else m_objects = object->next;
	if (object->next) object->next->previous = object->previous;
}
void GcHeap::destroyObject(GCObject* object) {
	switch (object->type) {
		case ObjType::Thread:

			delete static_cast<Thread*>(object);
			break;
		case ObjType::Table:

			m_tables.destroy(static_cast<Table*>(object));
			break;
		case ObjType::Closure: {
			auto* closure = static_cast<Closure*>(object);
			auto prototype = m_prototypes.find(*closure->prototype);
			if (--prototype->second == 0) m_prototypes.erase(prototype);

			delete closure;
			break;
		}
		case ObjType::Upvalue:

			delete static_cast<Upvalue*>(object);
			break;
	}
}

i32 GcHeap::sweepRecord(void* context, u32 address) {
	const auto& sweep = *static_cast<SweepContext*>(context);
	auto& heap = sweep.heap;
	auto& slot = heap.physicalSlot(address);
	auto* object = slot;
	if (!object) return 1;
	auto* thread = object->type == ObjType::Thread ? static_cast<Thread*>(object) : nullptr;
	const i32 work = thread ? ceilDiv4(static_cast<int>(heap.allocationBytes(thread))) : 1;
	if (object->gcColor() != (sweep.white ^ 1u)) {
		object->setGcColor(sweep.white);
		return work + (thread && thread != sweep.growingStack ? 2 * ceilDiv4(thread->shrinkStack()) : 0);
	}

	slot = nullptr;
	if (object->type == ObjType::Table) {
		static_cast<Table*>(object)->freeRecord();
	} else {
		if (thread) thread->freeStack();
		heap.arena.free(address);
	}
	heap.unlink(object);
	heap.destroyObject(object);
	return -work;
}

size_t GcHeap::step(Value root0, Value root1, Value root2, Thread* growingStack) {
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
				SweepContext sweep{*this, growingStack, white()};
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
size_t GcHeap::collect(Value root0, Value root1, Value root2, Thread* growingStack) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	++m_cpu.m_diagnosticGcProfile.fullCollections;
#endif
	size_t work = 0;
	// An explicit/full collection also removes floating garbage from an active cycle.
	while (active()) work += step(root0, root1, root2, growingStack);
	do { work += step(root0, root1, root2, growingStack); } while (active());
	return work;
}
void GcHeap::discardAttachments(Thread* retainedRoot) {
	// RAM has already been loaded. Destroy derived objects without freeing
	// their guest storage or following any edge in the restored heap.
	auto* object = std::exchange(m_objects, nullptr);
	while (object) {
		auto* next = object->next;
		physicalSlot(physicalAddress(object)) = nullptr;
		if (object != retainedRoot) destroyObject(object);
		object = next;
	}
	if (retainedRoot) {
		retainedRoot->detachFrameViews();
		track(retainedRoot);
	}
}
} // namespace bmsx
