#pragma once

#include <unordered_map>
#include <vector>
#include "common/object_storage_pool.h"
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
struct GcState {
	GcPhase phase = GcPhase::Pause;
	u32 white = 0;
	int sweep = -1;
	std::vector<u32> allocations, colors, gray, grayAgain, threads, weak, references, freeReferences;
};

class GcHeap {
public:
	GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings, StringId modeKey)
		: budget(budget), memory(memory), arena(arena), m_cpu(cpu), m_modeKey(modeKey), m_stringPool(strings) {}
	~GcHeap();
	LuaHeap& budget;
	Memory& memory;
	HeapAllocator& arena;
	Table* tableAt(u32 address) const { return m_tableRecords[(address & RAM_RECORD_WORD_MASK) / Table::HEADER_BYTES]; }
	Upvalue* cellAt(u32 address) const { return m_cellRecords[(address & (MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES)) / UPVALUE_HEAP_BYTES]; }
	void forgetPhysicalRecords() {
		std::fill(m_tableRecords.begin(), m_tableRecords.end(), nullptr);
		std::fill(m_cellRecords.begin(), m_cellRecords.end(), nullptr);
	}
	template<class T, class... Args> T* allocate(ObjType type, Args&&... args) {
		if constexpr (!std::is_same_v<T, Table>) reserveReference();
		T* object;
		if constexpr (std::is_same_v<T, Table>) object = m_tables.construct(std::forward<Args>(args)...);
		else object = new T(std::forward<Args>(args)...);
		object->type = type;
		track(object);
		return object;
	}
	Closure* bindClosureRecord(u32 address, const FunctionPrototype&, u32 count, bool canonical);
	u32 allocateHashId() { return m_nextObjectHashId++; }
	u32 nextObjectHashId() const { return m_nextObjectHashId; }
	// Only the host-backed allocations still use directory slots.
	u32 reference(const GCObject* object) const {
		return object->type == ObjType::Table ? static_cast<const Table*>(object)->address() : object->referenceId;
	}
	u32 reference(const Table* table) const { return table->address(); }
	GCObject* object(u32 reference) const { return m_references[reference].object; }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeReferencesOffset();
	static size_t nativeTableRecordsOffset();
	static size_t nativeCellRecordsOffset();
#endif
	uint32_t hash(Value value) const {
		switch (valueTag(value)) {
			case ValueTag::Table: return scalarValueHash(valueInteger(static_cast<i32>(valuePayload(value))));
			case ValueTag::Closure: case ValueTag::Thread:
				return object(valuePayload(value))->hashId * 2654435761u;
			default: return scalarValueHash(value);
		}
	}
	template<class Visitor> void visitThreads(Visitor&& visit) {
		for (auto* object = m_objects; object; object = object->next)
			if (object->type == ObjType::Thread) visit(*static_cast<Thread*>(object));
	}
	template<class Ref> GcState captureState(Ref&& ref) const {
		GcState state;
		state.phase = m_phase; state.white = m_white;
		state.sweep = m_sweep ? static_cast<int>(ref(m_sweep)) : -1;
		for (auto* object = m_objects; object; object = object->next) {
			state.allocations.push_back(ref(object)); state.colors.push_back(object->gcColor);
			state.references.push_back(object->referenceId);
		}
		for (u32 slot = m_freeReference; slot != 0; slot = m_references[slot].nextFree)
			state.freeReferences.push_back(slot);
		for (auto* object = m_gray; object; object = object->grayNext) state.gray.push_back(ref(object));
		for (auto* object = m_grayAgain; object; object = object->grayNext) state.grayAgain.push_back(ref(object));
		for (auto* object : m_threads) state.threads.push_back(ref(object));
		for (auto* object : m_weakTables) state.weak.push_back(ref(object));
		return state;
	}
	void restoreState(const GcState& state, const std::vector<GCObject*>& objects);
	void bindRestoredReferences(const GcState&, const std::vector<GCObject*>& objects, u32 nextHashId);
	bool active() const { return m_phase != GcPhase::Pause; }
	bool sweepGarbage(const GCObject* object) const {
		return m_phase == GcPhase::Sweep && object->gcColor == (m_white ^ 1u);
	}
	bool isAlive(const GCObject* object) const { return object && object->gcColor != m_white; }
	size_t allocationBytes(const GCObject* object) const;
	size_t step(Value root0, Value root1, Value root2, Thread* growingStack = nullptr);
	size_t collect(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), Thread* growingStack = nullptr);
	bool markValue(Value value);
	bool markObject(GCObject* object);
private:
	union ReferenceSlot {
		GCObject* object;
		u32 nextFree;
	};
	void reserveReference();
	void releaseReference(GCObject* object);
	void track(GCObject* object);
	uint8_t tableWeakMode(const Table& table) const;
	bool valueIsAlive(Value value) const;
	size_t trace(bool atomic);
	size_t remark(Value root0, Value root1, Value root2);
	size_t atomic(Value root0, Value root1, Value root2);
	void destroyObject(GCObject* object);
	static bool sweepRecord(void* context, u32 address);
	void unlink(GCObject* object);
	CPU& m_cpu;
	GCObject* m_objects = nullptr;
	GCObject* m_gray = nullptr;
	GCObject* m_grayAgain = nullptr;
	GCObject* m_sweep = nullptr;
	std::vector<Thread*> m_threads;
	std::vector<Table*> m_weakTables;
	u32 m_nextObjectHashId = 1;
	uint8_t m_white = 0;
	GcPhase m_phase = GcPhase::Pause;
	StringId m_modeKey;
	StringPool& m_stringPool;
	ObjectStoragePool<Table> m_tables;
	// Map nodes are stable across rehash; erasure is tied to the last closure.
	std::unordered_map<FunctionPrototype, size_t, FunctionPrototypeHash> m_prototypes;
	std::vector<Table*> m_tableRecords = std::vector<Table*>(MAIN_RAM_SIZE / Table::HEADER_BYTES);
	std::vector<Upvalue*> m_cellRecords = std::vector<Upvalue*>(MAIN_RAM_SIZE / UPVALUE_HEAP_BYTES);
	std::vector<ReferenceSlot> m_references{{.object = nullptr}};
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Published address of this owner's current directory allocation. Native
	// code reloads it; reserve/restore never leave cached directory pointers.
	ReferenceSlot* m_referenceBase = m_references.data();
	Table* const* const m_tableRecordBase = m_tableRecords.data();
	Upvalue* const* const m_cellRecordBase = m_cellRecords.data();
#endif
	u32 m_freeReference = 0;
};

inline Table* asTable(Value value, const GcHeap& heap) { return heap.tableAt(valuePayload(value)); }
inline Closure* asClosure(Value value, const GcHeap& heap) { return static_cast<Closure*>(heap.object(valuePayload(value))); }
inline Thread* asThread(Value value, const GcHeap& heap) { return static_cast<Thread*>(heap.object(valuePayload(value))); }
inline uint32_t valueObjectHashId(Value value, const GcHeap& heap) {
	return valueIsTable(value) ? valuePayload(value) : heap.object(valuePayload(value))->hashId;
}
} // namespace bmsx
