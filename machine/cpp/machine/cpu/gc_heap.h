#pragma once

#include <unordered_map>
#include <vector>
#include "common/compiler.h"
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
	std::vector<u32> allocations, threads, weak;
};

// Physical records start on an eight-byte boundary, including size-class slots.
inline constexpr u32 GC_RECORD_ALIGNMENT = 1u << GC_RECORD_SHIFT;
inline constexpr u32 GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
static_assert(GC_GRAY_INDEX_MASK == GC_RECORD_MASK >> GC_RECORD_SHIFT);
inline constexpr u32 GC_TRACE_HEAD = 4u;
inline constexpr u32 GC_CHANGED_HEAD = 8u;

class GcHeap {
public:
	GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings, StringId modeKey)
		: budget(budget), memory(memory), arena(arena), m_cpu(cpu), m_modeKey(modeKey), m_stringPool(strings),
		  m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}
	~GcHeap();
	LuaHeap& budget;
	Memory& memory;
	HeapAllocator& arena;
	Table* tableAt(u32 address) const { return attachedRecord<Table, ObjType::Table>(address & ~(Table::HEADER_BYTES - 1)); }
	Upvalue* cellAt(u32 address) const { return attachedRecord<Upvalue, ObjType::Upvalue>(address & ~(UPVALUE_HEAP_BYTES - 1)); }
	Closure* closureAt(u32 address) const { return attachedRecord<Closure, ObjType::Closure>(address); }
	Upvalue* openCellAt(u32 address) const {
		auto* cell = cellAt(address);
		return cell && cell->isOpen() ? cell : nullptr;
	}
	Thread* threadAt(u32 address) const { return attachedRecord<Thread, ObjType::Thread>(address); }
	void forgetPhysicalRecords() { std::fill(m_records.begin(), m_records.end(), nullptr); }
	template<class T, class... Args> T* allocate(ObjType type, Args&&... args) {
		T* object;
		if constexpr (std::is_same_v<T, Table>) object = m_tables.construct(std::forward<Args>(args)...);
		else object = new T(std::forward<Args>(args)...);
		object->type = type;
		track(object);
		return object;
	}
	Closure* bindClosureRecord(u32 address, const FunctionPrototype&, bool canonical);
	u32 allocateHashId() { return m_nextObjectHashId++; }
	u32 nextObjectHashId() const { return m_nextObjectHashId; }
	u32 reference(const GCObject* object) const { return physicalAddress(object); }
	u32 reference(const Table* table) const { return table->address(); }
	u32 reference(const Closure* closure) const { return closure->address; }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativePhysicalRecordsOffset();
	static size_t nativeControlOffset();
#endif
	uint32_t hash(Value value) const {
		switch (valueTag(value)) {
			case ValueTag::Table: case ValueTag::Closure: case ValueTag::Thread:
				return scalarValueHash(valueInteger(static_cast<i32>(valuePayload(value))));
			default: return scalarValueHash(value);
		}
	}
	template<class Visitor> void visitThreads(Visitor&& visit) {
		for (auto* object = m_objects; object; object = object->next)
			if (object->type == ObjType::Thread) visit(*static_cast<Thread*>(object));
	}
	template<class Ref> GcState captureState(Ref&& ref) const {
		GcState state;
		for (auto* object = m_objects; object; object = object->next) state.allocations.push_back(ref(object));
		for (auto* object : m_threads) state.threads.push_back(ref(object));
		for (auto* object : m_weakTables) state.weak.push_back(ref(object));
		return state;
	}
	void restoreState(const GcState& state, const std::vector<GCObject*>& objects);
	void bindRestoredRecords(const GcState&, const std::vector<GCObject*>& objects, u32 nextHashId);
	GcPhase phase() const {
		// Two unconnected selector inputs do not clock the collector.
		constexpr std::array phases{GcPhase::Pause, GcPhase::Mark, GcPhase::MarkAgain, GcPhase::Atomic,
			GcPhase::Sweep, GcPhase::Strings, GcPhase::Pause, GcPhase::Pause};
		return phases[memory.readRamRecordByte(m_controlOffset) & 7u];
	}
	u8 white() const { return memory.readRamRecordByte(m_controlOffset + 1u) & 1u; }
	bool active() const { return phase() != GcPhase::Pause; }
	bool sweepGarbage(const GCObject* object) const {
		return phase() == GcPhase::Sweep && object->gcColor() == (white() ^ 1u);
	}
	bool isAlive(const GCObject* object) const { return object && object->gcColor() != white(); }
	size_t allocationBytes(const GCObject* object) const;
	void armThreadStackWatches();
	bool observeStackWrites(u32 first, u32 end, const Thread* active);
	size_t step(Value root0, Value root1, Value root2, Thread* growingStack = nullptr);
	size_t collect(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), Thread* growingStack = nullptr);
	bool markValue(Value value);
	bool markObject(GCObject* object);
	void writeBarrier(u32 address, u32 link) {
		if (memory.readRamRecordByte(address + GC_COLOR_OFFSET) == 3u) enqueue(address, link, GC_CHANGED_HEAD);
	}
	u32 changedHeadOffset() const { return m_controlOffset + GC_CHANGED_HEAD; }
private:
	static u32 physicalAddress(const GCObject* object) {
		switch (object->type) {
			case ObjType::Table: return static_cast<const Table*>(object)->address();
			case ObjType::Closure: return static_cast<const Closure*>(object)->address;
			case ObjType::Upvalue: return static_cast<const Upvalue*>(object)->address;
			case ObjType::Thread: return static_cast<const Thread*>(object)->address;
		}
		BMSX_UNREACHABLE();
	}
	GCObject*& physicalSlot(u32 address) { return m_records[(address & GC_RECORD_MASK) / GC_RECORD_ALIGNMENT]; }
	template<class T, ObjType kind> T* attachedRecord(u32 address) const {
		auto* object = m_records[(address & GC_RECORD_MASK) / GC_RECORD_ALIGNMENT];
		return object && object->type == kind ? static_cast<T*>(object) : nullptr;
	}
	void track(GCObject* object);
	uint8_t tableWeakMode(const Table& table) const;
	bool valueIsAlive(Value value) const;
	u32 head(u32 queue) const { return memory.readRamRecordWord(m_controlOffset + queue) & GC_GRAY_INDEX_MASK; }
	void enqueue(u32 address, u32 link, u32 queue, bool closure = false);
	size_t markCell(Upvalue* cell);
	size_t trace(bool atomic);
	size_t remark(Value root0, Value root1, Value root2);
	size_t atomic(Value root0, Value root1, Value root2);
	void destroyObject(GCObject* object);
	struct SweepContext { GcHeap& heap; const Thread* growingStack; u8 white; };
	static i32 sweepRecord(void* context, u32 address);
	void unlink(GCObject* object);
	CPU& m_cpu;
	GCObject* m_objects = nullptr;
	std::vector<Thread*> m_threads;
	std::vector<Table*> m_weakTables;
	u32 m_nextObjectHashId = 1;
	void setPhase(GcPhase phase) { memory.writeRamRecordByte(m_controlOffset, static_cast<u8>(phase)); }
	StringId m_modeKey;
	StringPool& m_stringPool;
	const u32 m_controlOffset;
	ObjectStoragePool<Table> m_tables;
	// Map nodes are stable across rehash; erasure is tied to the last closure.
	std::unordered_map<FunctionPrototype, size_t, FunctionPrototypeHash> m_prototypes;
	std::vector<GCObject*> m_records = std::vector<GCObject*>(MAIN_RAM_SIZE / GC_RECORD_ALIGNMENT);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	GCObject* const* const m_recordBase = m_records.data();
#endif
};

inline Table* asTable(Value value, const GcHeap& heap) { return heap.tableAt(valuePayload(value)); }
inline Closure* asClosure(Value value, const GcHeap& heap) { return heap.closureAt(valuePayload(value)); }
inline Thread* asThread(Value value, const GcHeap& heap) { return heap.threadAt(valuePayload(value)); }
} // namespace bmsx
