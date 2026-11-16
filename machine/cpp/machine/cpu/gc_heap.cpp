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
	if (!valueIsTagged(v)) {
		return false;
	}
	switch (valueTag(v)) {
		case ValueTag::Thread:
			return markObject(asThread(v));
		case ValueTag::Table:
			return markObject(asTable(v));
		case ValueTag::Closure:
			return markObject(asClosure(v));
		case ValueTag::BuiltinFunction:
			return false;
		case ValueTag::String:
			m_stringPool.markReachable(asStringId(v));
			return false;
		default:
			return false;
	}
}

void GcHeap::track(GCObject* object) {
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
	void* storage = ::operator new(sizeof(Closure) + count * sizeof(Upvalue*));
	auto* closure = new (storage) Closure();
	closure->type = ObjType::Closure;
	closure->upvalueCount = count;
	closure->upvalues = reinterpret_cast<Upvalue**>(static_cast<uint8_t*>(storage) + sizeof(Closure));
	std::fill_n(closure->upvalues, count, nullptr);
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
	if (!table.metatable) {
		return 0;
	}
	const Value modeValue = table.metatable->getStringKey(m_modeKey);
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
	if (!valueIsTagged(value)) {
		return true;
	}
	switch (valueTag(value)) {
		case ValueTag::Thread:
			return isAlive(asThread(value));
		case ValueTag::Table:
			return isAlive(asTable(value));
		case ValueTag::Closure: {
			const Closure* closure = asClosure(value);
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
	const size_t work = ceilDiv4(static_cast<int>(allocationBytes(obj)));
	switch (obj->type) {
		case ObjType::Thread: {
			auto* thread = static_cast<Thread*>(obj);
			if (!atomic) m_threads.push_back(thread);
			markObject(thread->resumer);
			if (thread->entry != nullptr) markObject(thread->entry);
			markValue(thread->error);
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
			for (int slot = 0; slot < liveTop; ++slot) markValue(thread->stack[slot]);
			std::fill(thread->stack + liveTop, thread->stack + thread->stackCapacity, valueNil());
			thread->trimFrames();
			break;
		}
		case ObjType::Table: {
			auto* table = static_cast<Table*>(obj);
			if (table->metatable) {
				markObject(table->metatable);
			}
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
			break;
		}
		case ObjType::Closure: {
			auto* closure = static_cast<Closure*>(obj);
			for (size_t index = 0; index < closure->upvalueCount; ++index) {
				markObject(closure->upvalues[index]);
			}
			break;
		}
		case ObjType::Garbage: break;
		case ObjType::Upvalue: {
			auto* upvalue = static_cast<Upvalue*>(obj);
			if (!upvalue->open) {
				markValue(upvalue->value);
			} else {
				markObject(upvalue->frame->thread);
			}
			break;
		}
	}
	return work;
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
			work += ceilDiv4(static_cast<int>(table->trackedHeapBytes()));
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
		work += ceilDiv4(static_cast<int>(table->trackedHeapBytes()));
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
	switch (object->type) {
		case ObjType::Garbage:
			m_luaHeap.release(static_cast<GarbageAllocation*>(object)->bytes);
			delete static_cast<GarbageAllocation*>(object);
			break;
		case ObjType::Thread:
			m_luaHeap.release(THREAD_HEAP_BYTES + static_cast<Thread*>(object)->stackCapacity * THREAD_STACK_SLOT_BYTES);
			delete static_cast<Thread*>(object);
			break;
		case ObjType::Table:
			m_luaHeap.release(static_cast<Table*>(object)->trackedHeapBytes());
			m_tables.destroy(static_cast<Table*>(object));
			break;
		case ObjType::Closure:
			m_luaHeap.release(static_cast<Closure*>(object)->trackedHeapBytes);
			static_cast<Closure*>(object)->~Closure();
			::operator delete(object);
			break;
		case ObjType::Upvalue:
			m_luaHeap.release(UPVALUE_HEAP_BYTES);
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
					if (sweepGarbage(object)) { unlink(object); destroyObject(object); }
					else {
						object->gcColor = m_white;
						if (object->type == ObjType::Thread && object != growingStack) {
							auto* thread = static_cast<Thread*>(object);
							const size_t released = thread->shrinkStack();
							m_luaHeap.release(released * THREAD_STACK_SLOT_BYTES);
							if (released != 0) work += thread->stackCapacity * 4;
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
					m_luaHeap.finishCollection();
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
void GcHeap::finishRestore(u32 nextHashId) {
	for (auto* object = m_objects; object;) {
		auto* next = object->next;
		if (object->restored) object->restored = false;
		else { unlink(object); destroyObject(object); }
		object = next;
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
