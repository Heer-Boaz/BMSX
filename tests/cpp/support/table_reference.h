#pragma once

#include <span>

#include "gc_heap_reference.h"
#include "machine/cpu/table.h"
#include "table_constructor_layout.h"

namespace bmsx::test {

// The native table allocation and GC oracle. Physical lanes and probes
// are shared with the machine's memory-only TableRecord.
class NativeTableReference : public TableRecord {
public:
	NativeTableReference(const GcHeap& heap, u32 address) : TableRecord(heap.memory, address), m_heap(heap) {}

	static constexpr u32 HEADER_CHARGE = 32;
	static u32 storageBytes(size_t arraySize, size_t hashSize);
	static u32 allocationCharge(size_t arraySize, size_t hashSize);
	static size_t hashCapacity(int hashSize);

	// A fresh table with fixed String keys in source order.
	static TableConstructorLayout planStringRecord(std::span<const StringId> keys, u32 present) noexcept;
	void fillStringRecord(const TableConstructorLayout& layout, std::span<const StringId> keys,
		std::span<const Value> values) noexcept;

	int set(const Value& key, const Value& value);
	bool setIntegerArrayKey(int key, const Value& value);
	void setInteger(int index, const Value& value);
	int setStringKey(StringId key, const Value& value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	void setMetatableAddress(u32 address);
	void clear();
	void freeRecord();
	size_t trackedHeapBytes() const;

	template <typename ValueIsAlive>
	void clearWeakEntries(bool weakKeys, bool weakValues, ValueIsAlive&& valueIsAlive,
		u32 first = 0u, u32 end = UINT32_MAX) {
		const u32 array = arrayCapacity(), hash = hashSlots();
		const auto slots = values();
		for (u32 slot = first; slot < std::min(array, end); ++slot) {
			const Value value = slots.get(slot);
			if (isNil(value)) continue;
			if (weakValues && !valueIsAlive(value)) slots.set(slot, valueNil());
			else if (valueIsString(value)) m_heap.markString(asStringId(value));
		}
		const auto nodes = hashBody(hash).slots;
		for (u32 slot = std::max(first, array); slot < std::min(array + hash, end); ++slot) {
			const Value key = nodes.get(slot - array);
			const Value value = nodes.get(slot - array + hash);
			if (isNil(key) || isNil(value)) {
				continue;
			}
			if ((weakKeys && !valueIsAlive(key)) || (weakValues && !valueIsAlive(value))) {
				markHashNodeDead(slot - array);
			} else {
				if (valueIsString(key)) m_heap.markString(asStringId(key));
				if (valueIsString(value)) m_heap.markString(asStringId(value));
			}
		}
	}

private:
	using RebuildBody = HashStorage<true>;
	struct ResizePlan { size_t array, hash; bool keepHash; };

	ResizePlan planRehash(Value key, u8 extraHashSlots) const;
	int insertHashWithAdmission(Value key, Value value, u8 extraHashSlots);
	int commitHashPlan(const ResizePlan&, Value key, Value value, u32 previous, u32 requested);
	int resize(const ResizePlan&, u32 base, u32 storage, Value key, Value value, u32 previous, u32 requested);
	void bindHash(size_t hashSize, u32 address);
	void initializeArray(u32 address, u32 capacity, u32 retained);
	void initializeHash(u32 address, u32 count);
	void freeStorage();

	template<bool BulkWrite>
	static int findFreeIndex(const HashStorage<BulkWrite>& body, int first);
	int rebuildHashOnly(const RebuildBody& source, const RebuildBody& body, Value key, Value value);
	int reinsertMapping(const RebuildBody& body, int& nextFree, Value key, Value value) noexcept;
	int insertHashWithoutGrowth(const HashBody& body, u32 home, const Value& key, const Value& value) noexcept;
	int setHash(Value key, Value value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	void publishHashInsertion(Value key, Value value);
	void removeFromHash(const Value& key, int slot);
	void markHashNodeDead(size_t index);

	GcHeap m_heap;
};

inline NativeTableReference asReferenceTable(Value value, const GcHeap& heap) {
	return NativeTableReference(heap, valuePayload(value));
}

} // namespace bmsx::test
