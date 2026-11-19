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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		m_referenceBase = m_references.data();
#endif
	}
}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
size_t GcHeap::nativeReferencesOffset() {
	static_assert(sizeof(ReferenceSlot) == sizeof(void*));
	return offsetof(GcHeap, m_referenceBase);
}
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
	if (object->type == ObjType::Table) {
		auto* table = static_cast<Table*>(object);
		m_tableRecords[(table->address() & RAM_RECORD_WORD_MASK) / Table::HEADER_BYTES] = table;
	}
	if (m_freeReference != 0) {
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
Closure* GcHeap::allocateClosure(size_t count) {
	reserveReference();
	void* storage = ::operator new(sizeof(Closure) + count * sizeof(u32));
	auto* closure = new (storage) Closure();
	closure->type = ObjType::Closure;
	closure->upvalueCount = count;
	closure->upvalues = reinterpret_cast<u32*>(static_cast<uint8_t*>(storage) + sizeof(Closure));
	std::fill_n(closure->upvalues, count, 0u);
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
size_t GcHeap::allocationBytes(const GCObject* object) const {
	switch (object->type) {
		case ObjType::Table: return static_cast<const Table*>(object)->trackedHeapBytes();
		case ObjType::Closure: return static_cast<const Closure*>(object)->trackedHeapBytes;
		case ObjType::Upvalue: return UPVALUE_HEAP_BYTES;
		case ObjType::Thread: return THREAD_HEAP_BYTES + static_cast<const Thread*>(object)->stackCapacity * THREAD_STACK_SLOT_BYTES;
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
	const std::string& mode = m_stringPool.toString(asStringId(modeValue));
	uint8_t weakMode = 0;
	for (char ch : mode) {
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
			markObject(thread->resumer);
			if (thread->entry != nullptr) markObject(thread->entry);
			markValue(thread->error());
			int liveTop = thread->currentFrame ? thread->currentFrame->stackBase
				+ std::min(thread->currentFrame->top, thread->currentFrame->stackCapacity) : 0;
			CallFrame* frame = thread->firstFrame;
			for (size_t depth = 0; depth < thread->frameDepth; ++depth, frame = frame->next) {
				markObject(frame->closure);
				for (Upvalue* upvalue = frame->openUpvalueHead; upvalue; upvalue = upvalue->nextOpen) {
					markObject(upvalue);
					liveTop = std::max(liveTop, frame->stackBase + upvalue->index + 1);
				}
			}
			for (int slot = 0; slot < liveTop; ++slot) markValue(thread->stack.get(slot));
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
				markObject(object(closure->upvalues[index]));
			}
			break;
		}
		case ObjType::Garbage: break;
		case ObjType::Upvalue: {
			auto* upvalue = static_cast<Upvalue*>(obj);
			if (!upvalue->open) {
				markValue(upvalue->value());
			} else {
				markObject(upvalue->frame->thread);
			}
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
	return m_cpu.collectionRootWordCount();
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
	while (m_gray) work += trace(true);
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
		while (m_gray) work += trace(true);
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
	m_phase = GcPhase::Sweep;
	return work;
}
void GcHeap::unlink(GCObject* object) {
	if (object->previous) object->previous->next = object->next;
	else m_objects = object->next;
	if (object->next) object->next->previous = object->previous;
}
void GcHeap::destroyObject(GCObject* object) {
	releaseReference(object);
	switch (object->type) {
		case ObjType::Garbage:
			budget.release(static_cast<GarbageAllocation*>(object)->bytes);
			delete static_cast<GarbageAllocation*>(object);
			break;
		case ObjType::Thread:
			budget.release(THREAD_HEAP_BYTES + static_cast<Thread*>(object)->stackCapacity * THREAD_STACK_SLOT_BYTES);
			delete static_cast<Thread*>(object);
			break;
		case ObjType::Table:
			budget.release(static_cast<Table*>(object)->trackedHeapBytes());
			m_tables.destroy(static_cast<Table*>(object));
			break;
		case ObjType::Closure:
			budget.release(static_cast<Closure*>(object)->trackedHeapBytes);
			static_cast<Closure*>(object)->~Closure();
			::operator delete(object);
			break;
		case ObjType::Upvalue:
			budget.release(UPVALUE_HEAP_BYTES);
			delete static_cast<Upvalue*>(object);
			break;
	}
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
	}
	while (work < GC_STEP_WORDS && active()) {
		switch (m_phase) {
			case GcPhase::Mark:
			case GcPhase::MarkAgain: {
				{
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
					GcPhaseMeasurement traceTime(m_phase == GcPhase::Mark ? profile.traceNanoseconds : profile.markAgainNanoseconds);
#endif
					while (m_gray && work < GC_STEP_WORDS) work += trace(false);
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
				while (m_sweep && work < GC_STEP_WORDS) {
					auto* object = m_sweep;
					m_sweep = object->next;
					work += ceilDiv4(static_cast<int>(allocationBytes(object)));
					if (sweepGarbage(object)) {
						if (object->type == ObjType::Table) {
							auto* table = static_cast<Table*>(object);
							m_tableRecords[(table->address() & RAM_RECORD_WORD_MASK) / Table::HEADER_BYTES] = nullptr;
							table->freeRecord();
						}
						else if (object->type == ObjType::Garbage) {
							const u32 storage = static_cast<const GarbageAllocation*>(object)->storage;
							if (storage) arena.free(storage);
							const u32 record = static_cast<const GarbageAllocation*>(object)->record;
							if (record) arena.free(record);
						}
						unlink(object); destroyObject(object);
					}
					else {
						object->gcColor = m_white;
						if (object->type == ObjType::Thread && object != growingStack) {
							auto* thread = static_cast<Thread*>(object);
							const size_t released = thread->shrinkStack();
							budget.release(released * THREAD_STACK_SLOT_BYTES);
							if (released != 0) work += 2 * ceilDiv4(thread->stackCapacity * THREAD_STACK_SLOT_BYTES);
						}
					}
				}
				if (!m_sweep && work < GC_STEP_WORDS) {
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
	m_references.resize(1u + state.references.size() + state.freeReferences.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	m_referenceBase = m_references.data();
#endif
	for (size_t i = 0; i < state.references.size(); ++i) {
		auto* object = objects[state.allocations[i]];
		object->referenceId = state.references[i];
		m_references[object->referenceId].object = object;
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
