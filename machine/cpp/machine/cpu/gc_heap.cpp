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

void GcHeap::reserveReference() {
	// Admit directory growth before constructing the object. Recycling a
	// directory slot and binding a constructed object do not allocate.
	if (m_freeReference == 0 && m_references.size() == m_references.capacity()) {
		m_references.reserve(std::max(size_t{64}, m_references.capacity() * 2));
	}
}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
size_t GcHeap::nativePhysicalRecordsOffset() { return offsetof(GcHeap, m_recordBase); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif
void GcHeap::releaseReference(GCObject* object) {
	const u32 reference = object->referenceId;
	m_references[reference].nextFree = m_freeReference;
	m_freeReference = reference;
	object->referenceId = 0;
}
void GcHeap::track(GCObject* object) {
	const u32 address = physicalAddress(object);
	if (address != 0) {
		physicalSlot(address) = object;
	} else if (m_freeReference != 0) {
		object->referenceId = m_freeReference;
		m_freeReference = m_references[m_freeReference].nextFree;
		m_references[object->referenceId].object = object;
	} else {
		object->referenceId = static_cast<u32>(m_references.size());
		m_references.push_back({.object = object});
	}
	object->gcColor = m_white;
	object->restored = false;
	object->grayHead = &m_grayAgain;
	object->grayNext = nullptr;
	object->hashId = allocateHashId();
	object->previous = nullptr;
	object->next = m_objects;
	if (m_objects) m_objects->previous = object;
	m_objects = object;
}
Closure* GcHeap::bindClosureRecord(u32 address, const FunctionPrototype& prototype, u32 count, bool canonical) {
	const auto entry = m_prototypes.try_emplace(prototype, 0u).first;
	auto* closure = new Closure(memory, address, count, entry->first, canonical);
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
bool GcHeap::markObject(GCObject* object) {
	if (!object || object->gcColor != m_white) return false;
	object->gcColor = 2;
	object->grayNext = m_gray; m_gray = object;
	return true;
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
		case ObjType::Closure: return heapAllocationBytes(closureRecordBytes(static_cast<const Closure*>(object)->upvalueCount));
		case ObjType::Upvalue: return UPVALUE_HEAP_BYTES;
		case ObjType::Thread: return THREAD_HEAP_BYTES + heapAllocationBytes(static_cast<const Thread*>(object)->backingByteLength());
		case ObjType::Garbage: return static_cast<const GarbageAllocation*>(object)->bytes;
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
	GCObject* obj = m_gray;
	m_gray = obj->grayNext;
	obj->grayNext = nullptr;
	obj->gcColor = 3;
	switch (obj->type) {
		case ObjType::Thread: {
			auto* thread = static_cast<Thread*>(obj);
			if (!atomic) m_threads.push_back(thread);
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
					markObject(upvalue);
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
			break;
		}
		case ObjType::Table: {
			auto* table = static_cast<Table*>(obj);
			markObject(table->metatable());
			const uint8_t weakMode = tableWeakMode(*table);
			if (weakMode != 0 && !table->gcWeakListed) {
				table->gcWeakListed = true;
				m_weakTables.push_back(table);
			}
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
			for (size_t index = 0; index < closure->upvalueCount; ++index) {
				markObject(cellAt(closure->captureAddress(static_cast<u32>(index))));
			}
			return 3u + closure->upvalueCount;
		}
		case ObjType::Garbage: break;
		case ObjType::Upvalue: {
			auto* upvalue = static_cast<Upvalue*>(obj);
			if (upvalue->isOpen()) markObject(threadAt(upvalue->ownerAddress()));
			markValue(upvalue->value());
			break;
		}
	}
	return ceilDiv4(static_cast<int>(allocationBytes(obj)));
}

size_t GcHeap::remark(Value root0, Value root1, Value root2) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcPhaseMeasurement measurement(profile.rootsNanoseconds);
#endif
	for (auto* thread : m_threads) thread->writeBarrier();
	// Also observe mode changes made through a shared metatable.
	for (auto* table : m_weakTables) table->writeBarrier();
	m_threads.clear();
	// The current trace queue is empty. Further writes go to grayAgain, so
	// mutation cannot continually put the same object in this pass's queue.
	m_gray = m_grayAgain; m_grayAgain = nullptr;
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
	while (m_gray) {
		work += trace(true);
		work += m_stringPool.takeMarkWork();
	}
	bool changed;
	do {
		changed = false;
		for (size_t index = 0; index < m_weakTables.size(); ++index) {
			auto* table = m_weakTables[index];
			if (tableWeakMode(*table) != kTableWeakKeys) continue;
			work += table->scanSlots();
			table->forEachEntry([&](Value key, Value value) {
				if (valueIsAlive(key) && markValue(value)) changed = true;
			});
		}
		while (m_gray) {
			work += trace(true);
			work += m_stringPool.takeMarkWork();
		}
	} while (changed);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	measurement.phase(profile.weakNanoseconds);
#endif
	for (auto* table : m_weakTables) {
		const auto mode = tableWeakMode(*table);
		work += table->scanSlots();
		table->clearWeakEntries((mode & 1) != 0, (mode & 2) != 0,
			[this](Value value) { return valueIsAlive(value); });
		table->forEachEntry([this](Value key, Value value) {
			if (valueIsString(key)) m_stringPool.markReachable(asStringId(key));
			if (valueIsString(value)) m_stringPool.markReachable(asStringId(value));
		});
		table->gcWeakListed = false;
	}
	m_cpu.pruneStaticClosures();
	m_weakTables.clear(); m_threads.clear();
	m_white ^= 1u;
	m_sweep = m_objects;
	arena.beginObjectSweep();
	m_phase = GcPhase::Sweep;
	return work + m_stringPool.takeMarkWork();
}
void GcHeap::unlink(GCObject* object) {
	if (object->previous) object->previous->next = object->next;
	else m_objects = object->next;
	if (object->next) object->next->previous = object->previous;
}
void GcHeap::destroyObject(GCObject* object) {
	if (object->referenceId != 0) releaseReference(object);
	switch (object->type) {
		case ObjType::Garbage:
			budget.release(static_cast<GarbageAllocation*>(object)->bytes);
			delete static_cast<GarbageAllocation*>(object);
			break;
		case ObjType::Thread:
			budget.release(allocationBytes(object));
			delete static_cast<Thread*>(object);
			break;
		case ObjType::Table:
			budget.release(static_cast<Table*>(object)->trackedHeapBytes());
			m_tables.destroy(static_cast<Table*>(object));
			break;
		case ObjType::Closure: {
			auto* closure = static_cast<Closure*>(object);
			auto prototype = m_prototypes.find(*closure->prototype);
			if (--prototype->second == 0) m_prototypes.erase(prototype);
			budget.release(heapAllocationBytes(closureRecordBytes(closure->upvalueCount)));
			delete closure;
			break;
		}
		case ObjType::Upvalue:
			budget.release(UPVALUE_HEAP_BYTES);
			delete static_cast<Upvalue*>(object);
			break;
	}
}

bool GcHeap::sweepRecord(void* context, u32 address) {
	auto& heap = *static_cast<GcHeap*>(context);
	auto& slot = heap.physicalSlot(address);
	auto* object = slot;
	if (!object) return false;
	if (!heap.sweepGarbage(object)) {
		object->gcColor = heap.m_white;
		return false;
	}
	if (heap.m_sweep == object) heap.m_sweep = object->next;
	slot = nullptr;
	if (object->type == ObjType::Table)
		static_cast<Table*>(object)->freeRecord();
	else
		heap.arena.free(address);
	heap.unlink(object);
	heap.destroyObject(object);
	return true;
}

size_t GcHeap::step(Value root0, Value root1, Value root2, Thread* growingStack) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	auto& profile = m_cpu.m_diagnosticGcProfile;
	GcStepMeasurement total(profile);
#endif
	size_t work = 0;
	if (m_phase == GcPhase::Pause || m_phase == GcPhase::Mark || m_phase == GcPhase::MarkAgain) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		GcPhaseMeasurement roots(profile.rootsNanoseconds);
#endif
		if (m_phase == GcPhase::Pause) {
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
			++profile.collections;
#endif
			m_phase = GcPhase::Mark;
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
		switch (m_phase) {
			case GcPhase::Mark:
			case GcPhase::MarkAgain: {
				{
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
					GcPhaseMeasurement traceTime(m_phase == GcPhase::Mark ? profile.traceNanoseconds : profile.markAgainNanoseconds);
#endif
					while (m_gray && work < GC_STEP_WORDS) {
						work += trace(false);
						work += m_stringPool.takeMarkWork();
					}
				}
				if (work < GC_STEP_WORDS) {
					if (m_phase == GcPhase::Mark) {
						work += remark(root0, root1, root2);
						m_phase = GcPhase::MarkAgain;
					} else {
						m_phase = GcPhase::Atomic;
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
				work += arena.sweepObjects(GC_STEP_WORDS - work, this, &GcHeap::sweepRecord);
				while (m_sweep && work < GC_STEP_WORDS) {
					auto* object = m_sweep;
					m_sweep = object->next;
					// The allocator has already visited (or will visit) every physical record.
					if (object->referenceId == 0 && object->type != ObjType::Thread) continue;
					work += ceilDiv4(static_cast<int>(allocationBytes(object)));
					if (sweepGarbage(object)) {
						if (object->type == ObjType::Thread) {
							auto* thread = static_cast<Thread*>(object);
							const u32 address = thread->address;
							thread->freeStack();
							physicalSlot(address) = nullptr;
							arena.free(address);
						}
						unlink(object); destroyObject(object);
					}
					else {
						object->gcColor = m_white;
						if (object->type == ObjType::Thread && object != growingStack) {
							auto* thread = static_cast<Thread*>(object);
							work += 2 * ceilDiv4(thread->shrinkStack());
						}
					}
				}
				if (!m_sweep && work < GC_STEP_WORDS && !arena.objectSweepActive()) {
					m_grayAgain = nullptr;
					m_phase = GcPhase::Strings;
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
					m_phase = GcPhase::Pause;
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
void GcHeap::bindRestoredReferences(const GcState& state, const std::vector<GCObject*>& objects, u32 nextHashId) {
	for (auto* object = m_objects; object;) {
		auto* next = object->next;
		if (object->restored) object->restored = false;
		else { unlink(object); destroyObject(object); }
		object = next;
	}
	// The old references are retired. Install the saved slots before resolving
	// any Value or upvalue edge in the newly constructed object graph.
	m_references.resize(1u + state.freeReferences.size() + std::count_if(state.references.begin(), state.references.end(), [](u32 slot) { return slot != 0; }));
	for (size_t i = 0; i < state.references.size(); ++i) {
		auto* object = objects[state.allocations[i]];
		object->referenceId = state.references[i];
		if (object->referenceId != 0) m_references[object->referenceId].object = object;
		else physicalSlot(physicalAddress(object)) = object;
	}
	m_freeReference = 0;
	for (auto it = state.freeReferences.rbegin(); it != state.freeReferences.rend(); ++it) {
		m_references[*it].nextFree = m_freeReference;
		m_freeReference = *it;
	}
	m_nextObjectHashId = nextHashId;
}
void GcHeap::restoreState(const GcState& state, const std::vector<GCObject*>& objects) {
	m_phase = state.phase; m_white = static_cast<uint8_t>(state.white);
	m_objects = nullptr;
	GCObject* previous = nullptr;
	for (size_t i = 0; i < state.allocations.size(); ++i) {
		auto* object = objects[state.allocations[i]];
		object->gcColor = static_cast<uint8_t>(state.colors[i]);
		object->previous = previous; object->next = nullptr; object->grayNext = nullptr;
		object->grayHead = &m_grayAgain;
		if (previous) previous->next = object; else m_objects = object;
		previous = object;
	}
	m_gray = nullptr;
	for (auto it = state.gray.rbegin(); it != state.gray.rend(); ++it) {
		auto* object = objects[*it]; object->grayNext = m_gray; m_gray = object;
	}
	m_grayAgain = nullptr;
	for (auto it = state.grayAgain.rbegin(); it != state.grayAgain.rend(); ++it) {
		auto* object = objects[*it]; object->grayNext = m_grayAgain; m_grayAgain = object;
	}
	m_threads.clear(); m_weakTables.clear();
	for (auto ref : state.threads) m_threads.push_back(static_cast<Thread*>(objects[ref]));
	for (auto ref : state.weak) {
		auto* table = static_cast<Table*>(objects[ref]); table->gcWeakListed = true; m_weakTables.push_back(table);
	}
	m_sweep = state.sweep < 0 ? nullptr : objects[state.sweep];
}
} // namespace bmsx
