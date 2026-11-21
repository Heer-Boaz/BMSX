#include "machine/cpu/table.h"

#include <algorithm>
#include <array>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

namespace bmsx {

namespace {
constexpr int32_t kTableHashNextEnd = -1;
constexpr int kStoreRequiresGrowth = -2;
} // namespace

TableRecord::TableRecord(GcHeap& heap, u32 address)
	: m_heap(&heap), m_memory(&heap.memory), m_address(address) {
}

void TableRecord::initialize(size_t array, size_t hash) {
	writeHeader(TableHeader::Kind, static_cast<u32>(ValueTag::Table) | (static_cast<u32>(m_heap->white()) << 8u));
	writeHeader(TableHeader::Gray, 0);
	writeHeader(TableHeader::Metatable, 0);
	writeHeader(TableHeader::Length, 0);
	bindStorage(array, hash, storageAddress());
	initializeStorage();
}

void TableRecord::setMetatableAddress(u32 address) {
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	writeHeader(TableHeader::Metatable, address);
}

void TableRecord::setArraySlot(size_t slot, const Value& value) {
	m_heap->writeValueBarrier(m_address, GC_RECORD_LINK, valueTag(value));
	values().set(slot, value);
	updateLengthHint(slot, !isNil(value));
}

u32 TableRecord::storageBytes(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(arraySize * 5 + hashSize * 14);
}

size_t TableRecord::hashCapacity(int hashSize) {
	return hashSize > 0
		? nextPowerOfTwo(static_cast<size_t>(hashSize))
		: 0;
}

size_t TableRecord::trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity) {
	const u32 bytes = storageBytes(arrayCapacity, hashCapacity);
	return HEADER_BYTES + (bytes ? heapAllocationBytes(bytes) : 0u);
}

u32 TableRecord::arraySlot(const Value& key) {
	i32 integer;
	return valueToInteger(key, integer) ? arraySlot(integer) : NO_ARRAY_SLOT;
}

bool TableRecord::hasIntegerKey(u32 key) const {
	if (key <= arrayCapacity()) {
		return !isNil(values().get(static_cast<size_t>(key - 1)));
	}
	const int nodeIndex = findNodeIndex(valueInteger(static_cast<i32>(key)));
	return nodeIndex >= 0 && !isNil(values().get(hashValueSlot(static_cast<size_t>(nodeIndex))));
}

int TableRecord::findNodeIndex(const Value& key, bool matchDead) const {
	const u32 count = hashSlots();
	return count == 0u ? -1
		: hashBody(count, arrayCapacity()).findNode(key, hashCanonicalTableKey(key) & (count - 1u), matchDead);
}

int TableRecord::HashBody::findNode(const Value& key, u32 home, bool matchDead) const {
	const auto tag = valueTag(key);
	const u32 payload = valuePayload(key);
	const bool collectableKey = matchDead && (tag == ValueTag::Table || tag == ValueTag::Closure || tag == ValueTag::Thread);
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		const u32 keySlot = array + slot;
		const auto nodeTag = slots.tag(keySlot);
		if (nodeTag == tag) {
			if (slots.word(keySlot) == payload) return index;
		} else if (collectableKey && nodeTag == ValueTag::Nil && slots.word(keySlot) == valueTagHeader(tag)) {
			const u32 valueSlot = keySlot + count;
			if (slots.tag(valueSlot) == ValueTag::DeadKey && slots.word(valueSlot) == payload) return index;
		}
		index = next(slot);
	}
	return -1;
}

int TableRecord::findNextLiveHashIndex(size_t start) const {
	for (size_t index = start; index < hashSlots(); ++index) {
		if (!isNil(values().get(hashKeySlot(index))) && !isNil(values().get(hashValueSlot(index)))) {
			return static_cast<int>(index);
		}
	}
	return -1;
}

inline int TableRecord::HashBody::findString(StringId key, u32 home) const {
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		if (matchesString(slot, key)) return index;
		index = next(slot);
	}
	return -1;
}

Value TableRecord::HashBody::predictedString(i32 node, StringId key) const {
	if (node < 0 || static_cast<u32>(node) >= count || !matchesString(node, key)) return valueNil();
	const u32 slot = array + count + static_cast<u32>(node);
	const auto tag = slots.tag(slot);
	return tag == ValueTag::Nil ? valueNil() : valueFromTag(tag, slots.word(slot));
}

int TableRecord::getFreeIndex(const HashBody& body) {
	for (int i = hashFree(); i >= 0; --i) {
		const u32 keySlot = body.array + static_cast<u32>(i);
		if (body.slots.tag(keySlot) == ValueTag::Nil && body.slots.tag(keySlot + body.count) == ValueTag::Nil) {
			writeHeader(TableHeader::Free, static_cast<u32>(i - 1));
			return i;
		}
	}
	writeHeader(TableHeader::Free, static_cast<u32>(-1));
	return -1;
}

void TableRecord::rehash(const Value& key, const Value& value) {
	const auto body = hashBody(hashSlots(), arrayCapacity());
	const auto& slots = body.slots;
	size_t totalKeys = 0;
	std::array<u32, 32> counts{};
	size_t countBins = 0;

	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			++countBins;
		}
		counts[log] += 1;
	};

	for (u32 i = 0; i < body.array; ++i) {
		if (slots.tag(i) != ValueTag::Nil) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (u32 i = 0; i < body.count; ++i) {
		const u32 slot = body.array + i;
		const auto tag = slots.tag(slot);
		if (tag != ValueTag::Nil && slots.tag(slot + body.count) != ValueTag::Nil) {
			totalKeys += 1;
			if (tag == ValueTag::Integer || tag == ValueTag::Float) {
				const u32 index = arraySlot(valueFromTag(tag, slots.word(slot)));
				if (index != NO_ARRAY_SLOT) countIntegerKey(index + 1u);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		const u32 index = arraySlot(key);
		if (index != NO_ARRAY_SLOT) countIntegerKey(index + 1u);
	}

	size_t arraySize = 0;
	size_t arrayKeys = 0;
	size_t total = 0;
	size_t power = 1;
	for (size_t i = 0; i < countBins; ++i) {
		total += counts[i];
		if (total > power / 2) {
			arraySize = power;
			arrayKeys = total;
		}
		power <<= 1;
	}

	size_t hashKeys = totalKeys - arrayKeys;
	size_t hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
	m_heap->budget.accountTableStorageWork(body.array + 2u * body.count);
	resize(arraySize, hashSize, key, value);
}

void TableRecord::resize(
	size_t newArraySize,
	size_t newHashSize,
	const Value& key,
	const Value& value
) {
	const u32 storage = m_heap->budget.allocateRecord(storageBytes(newArraySize, newHashSize), true, 0, 0,
		valueTable(m_address), key, value);
	const auto oldValues = values();
	const size_t oldArraySize = arrayCapacity(), oldHashSize = hashSlots();
	bindStorage(newArraySize, newHashSize, storage);
	initializeStorage();
	m_heap->budget.accountTableStorageWork(newArraySize + 2 * newHashSize);

	size_t relocatedSlots = 0;
	for (size_t i = 0; i < oldArraySize; ++i) {
		if (!isNil(oldValues.get(i))) {
			const int destination = rawSet(valueInteger(static_cast<i32>(i + 1)), oldValues.get(i));
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value key = oldValues.get(oldArraySize + i);
		if (!isNil(key) && !isNil(oldValues.get(oldArraySize + oldHashSize + i))) {
			const int destination = rawSet(key, oldValues.get(oldArraySize + oldHashSize + i));
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	m_heap->budget.accountTableStorageWork(oldArraySize + 2 * oldHashSize + relocatedSlots);
	if (oldValues.words != 0) m_heap->arena.free(oldValues.words);

}

void TableRecord::bindStorage(size_t arraySize, size_t hashSize, u32 address) {
	writeHeader(TableHeader::Storage, address);
	writeHeader(TableHeader::Array, static_cast<u32>(arraySize));
	writeHeader(TableHeader::Hash, static_cast<u32>(hashSize));
	writeHeader(TableHeader::Free, static_cast<u32>(hashSize) - 1u);
}

void TableRecord::initializeStorage() {
	const u32 bytes = storageBytes(arrayCapacity(), hashSlots());
	if (bytes == 0) return;
	const u32 words = storageAddress() & RAM_RECORD_WORD_MASK;
	const u32 links = words + (arrayCapacity() + 2u * hashSlots()) * 4u;
	const u32 tags = links + hashSlots() * 4u;
	u8* ram = m_memory->ramData();
	std::fill(ram + words, ram + links, u8{0});
	std::fill(ram + links, ram + tags, u8{0xff});
	std::fill(ram + tags, ram + words + bytes, u8{0});
	m_memory->invalidateRamWrite(words, bytes);
}

void TableRecord::freeStorage() {
	const u32 storage = storageAddress();
	if (storage != 0) m_heap->arena.free(storage);
}

void TableRecord::freeRecord() {
	freeStorage();
	m_heap->arena.free(m_address);
}

// Storage redistribution transfers existing edges and leaves the boundary hint alone.
int TableRecord::rawSet(const Value& key, const Value& value) {
	const u32 array = arrayCapacity(), count = hashSlots();
	const auto body = hashBody(count, array);
	const u32 index = arraySlot(key);
	if (index < array) {
		body.slots.set(index, value);
		return -1;
	}
	if (count != 0u) {
		const u32 home = hashCanonicalTableKey(canonicalTableKey(key)) & (count - 1u);
		const int nodeIndex = insertHashWithoutGrowth(body, home, key, value);
		if (nodeIndex >= 0) return nodeIndex;
	}
	// Growth may collect and relocate a source Thread's register storage.
	const Value pendingKey = key, pendingValue = value;
	rehash(pendingKey, pendingValue);
	return rawSet(pendingKey, pendingValue);
}

namespace {
// Lua's chained hash insertion is shared by actual writes and by placing the
// fixed keys of a future fresh table. Both get exactly the same relocation,
// links and free cursor, including when two keys have the same home.
template <typename Body, typename TakeFree>
int insertAbsentHashKey(const Body& body, u32 mainSlot, const Value& key, const Value& value, TakeFree takeFree) noexcept {
	const auto& slots = body.slots;
	const u32 count = body.count;
	const int mainIndex = static_cast<int>(mainSlot);
	const u32 keySlot = body.array + mainSlot, valueSlot = keySlot + count;
	const auto tag = slots.tag(keySlot);
	if (tag == ValueTag::Nil || slots.tag(valueSlot) == ValueTag::Nil) {
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		return mainIndex;
	}
	const Value mainKey = valueFromTag(tag, slots.word(keySlot));
	const int freeIndex = takeFree();
	if (freeIndex < 0) return -1;
	const u32 freeSlot = static_cast<u32>(freeIndex), freeKey = body.array + freeSlot;
	const int mainIndexOfOccupied = static_cast<int>(hashCanonicalTableKey(canonicalTableKey(mainKey)) & (count - 1u));
	if (mainIndexOfOccupied != mainIndex) {
		slots.set(freeKey, mainKey);
		slots.set(freeKey + count, slots.get(valueSlot));
		body.setNext(freeSlot, body.next(mainSlot));
		int prev = mainIndexOfOccupied;
		for (u32 remaining = count; remaining != 0u; --remaining) {
			const int next = body.next(static_cast<u32>(prev));
			if (next == mainIndex || next < 0) break;
			prev = next;
		}
		body.setNext(static_cast<u32>(prev), freeIndex);
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		body.setNext(mainSlot, kTableHashNextEnd);
		return mainIndex;
	}
	slots.set(freeKey, key);
	slots.set(freeKey + count, value);
	body.setNext(freeSlot, body.next(mainSlot));
	body.setNext(mainSlot, freeIndex);
	return freeIndex;
}

struct ConstructorScratch {
	struct Slots {
		mutable std::array<Value, 2 * TABLE_RECORD_FIELDS_MAX> data{};
		ValueTag tag(u32 index) const { return valueTag(data[index]); }
		u32 word(u32 index) const { return valuePayload(data[index]); }
		Value get(u32 index) const { return data[index]; }
		void set(u32 index, Value value) const { data[index] = value; }
	};
	Slots slots;
	const u32 array = 0;
	u32 count;
	TableConstructorLayout& layout;

	i32 next(u32 index) const { return layout.nodes[index].next; }
	void setNext(u32 index, i32 next) const { layout.nodes[index].next = static_cast<i8>(next); }
};
} // namespace

int TableRecord::insertHashWithoutGrowth(const HashBody& body, u32 home, const Value& key, const Value& value) noexcept {
	return insertAbsentHashKey(body, home, key, value, [this, &body] { return getFreeIndex(body); });
}

TableConstructorLayout TableRecord::planStringRecord(std::span<const StringId> keys, u32 present) noexcept {
	const u32 count = static_cast<u32>(hashCapacity(static_cast<int>(keys.size())));
	TableConstructorLayout layout;
	layout.free = static_cast<i8>(count - 1u);
	const ConstructorScratch scratch{.slots = {}, .count = count, .layout = layout};
	for (u32 field = 0; field < keys.size(); ++field) {
		if ((present & (1u << field)) == 0u) continue;
		const Value key = valueString(keys[field]);
		const u32 home = hashCanonicalTableKey(key) & (count - 1u);
		insertAbsentHashKey(scratch, home, key, valueInteger(static_cast<i32>(field)), [&] {
				for (int free = layout.free; free >= 0; --free) {
					if (scratch.slots.tag(static_cast<u32>(free)) != ValueTag::Nil) continue;
					layout.free = static_cast<i8>(free - 1);
					return free;
				}
				return -1;
			});
	}
	for (u32 slot = 0; slot < count; ++slot) {
		if (scratch.slots.tag(slot) != ValueTag::Nil)
			layout.nodes[slot].field = static_cast<i8>(scratch.slots.word(count + slot));
	}
	return layout;
}

void TableRecord::fillStringRecord(const TableConstructorLayout& layout, std::span<const StringId> keys,
	std::span<const Value> values) noexcept {
	const auto body = hashBody(hashSlots(), arrayCapacity());
	for (u32 slot = 0; slot < body.count; ++slot) {
		const auto& node = layout.nodes[slot];
		if (node.field < 0) continue;
		const auto field = static_cast<u32>(node.field);
		body.slots.set(slot, valueString(keys[field]));
		body.slots.set(slot + body.count, values[field]);
		if (node.next >= 0) body.setNext(slot, node.next);
	}
	if (layout.free != static_cast<i8>(body.count - 1u)) writeHeader(TableHeader::Free, static_cast<u32>(layout.free));
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
}

void TableRecord::removeFromHash(const Value& key) {
	const int existingIndex = findNodeIndex(key);
	if (existingIndex < 0 || isNil(values().get(hashValueSlot(static_cast<size_t>(existingIndex))))) {
		return;
	}
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void TableRecord::markHashNodeDead(size_t index) {
	const Value key = values().get(hashKeySlot(index));
	if (valueIsTable(key) || valueIsThread(key) || valueIsClosure(key)) {
		const uint32_t hashId = valuePayload(key);
		values().set(hashKeySlot(index), valueFromTag(ValueTag::Nil, valueHeader(key)));
		values().set(hashValueSlot(index), valueFromTag(ValueTag::DeadKey, hashId));
	} else {
		values().set(hashValueSlot(index), valueNil());
	}
}

Value TableRecord::get(const Value& rawKey) const {
	if (isNil(rawKey) || valueIsNaN(rawKey)) return valueNil();
	const Value key = canonicalTableKey(rawKey);
	return getCanonical(key);
}

Value TableRecord::getCanonical(const Value& key) const {
	const u32 index = arraySlot(key);
	if (index < arrayCapacity()) return values().get(index);
	return getHash(key);
}

Value TableRecord::getHash(const Value& key) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count, arrayCapacity());
	const int index = body.findNode(key, hashCanonicalTableKey(key) & (count - 1u));
	return index < 0 ? valueNil() : body.slots.get(body.array + count + static_cast<u32>(index));
}

void TableRecord::set(const Value& rawKey, const Value& value) {
	if (isNil(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	if (valueIsNaN(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
	const Value key = canonicalTableKey(rawKey);
	const u32 index = arraySlot(key);
	const u32 array = arrayCapacity();
	if (index < array) {
		setArraySlot(index, value);
		return;
	}
	const bool present = !isNil(value);
	setHash(array, key, value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
}

void TableRecord::setHash(u32 array, Value key, Value value) {
	if (isNil(value)) {
		removeFromHash(key);
		return;
	}
	const bool keyHasEdge = valueTagHasGcEdge(valueTag(key));
	const bool valueHasEdge = valueTagHasGcEdge(valueTag(value));
	const u32 count = hashSlots();
	bool needsGrowth = true;
	if (count != 0u) {
		const auto body = hashBody(count, array);
		const u32 home = hashCanonicalTableKey(key) & (count - 1u);
		const int nodeIndex = body.findNode(key, home, true);
		if (nodeIndex >= 0) {
			const u32 keySlot = array + static_cast<u32>(nodeIndex), valueSlot = keySlot + count;
			const bool deadKey = keyHasEdge && body.slots.tag(keySlot) == ValueTag::Nil;
			if (deadKey) body.slots.set(keySlot, key);
			if (valueHasEdge || (keyHasEdge && (deadKey || body.slots.tag(valueSlot) == ValueTag::Nil))) {
				m_heap->writeBarrier(m_address, GC_RECORD_LINK);
			}
			body.slots.set(valueSlot, value);
			return;
		}
		needsGrowth = insertHashWithoutGrowth(body, home, key, value) < 0;
	}
	if (needsGrowth) {
		// Growth invalidates the home and can move the key to the array.
		rehash(key, value);
		rawSet(key, value);
	}
	if (keyHasEdge || valueHasEdge) m_heap->writeBarrier(m_address, GC_RECORD_LINK);
}

Value TableRecord::getInteger(int indexValue) const {
	const u32 index = arraySlot(indexValue);
	if (index < arrayCapacity()) return values().get(index);
	return getHash(valueInteger(indexValue));
}

void TableRecord::setInteger(int indexValue, const Value& value) {
	const u32 index = arraySlot(indexValue), array = arrayCapacity();
	if (index < array) {
		setArraySlot(index, value);
		return;
	}
	const bool present = !isNil(value);
	setHash(array, valueInteger(indexValue), value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
}

Value TableRecord::getStringKey(StringId key) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count, arrayCapacity());
	const int nodeIndex = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
	return nodeIndex < 0 ? valueNil() : body.slots.get(body.array + count + static_cast<u32>(nodeIndex));
}

Value TableRecord::getStringKeyCached(StringId key, int& predictedSlot) const {
	const u32 count = hashSlots();
	if (count != 0u) {
		const auto body = hashBody(count, arrayCapacity());
		const auto& slots = body.slots;
		const Value predicted = body.predictedString(predictedSlot, key);
		if (!isNil(predicted)) return predicted;
		const int nodeIndex = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
		if (nodeIndex >= 0) {
			const u32 valueSlot = body.array + count + static_cast<u32>(nodeIndex);
			const auto tag = slots.tag(valueSlot);
			if (tag != ValueTag::Nil) {
				predictedSlot = nodeIndex;
				return valueFromTag(tag, slots.word(valueSlot));
			}
		}
	}
	predictedSlot = -1;
	return valueNil();
}

Value TableRecord::metatableField(StringId key) const {
	const u32 address = metatableAddress();
	return address != 0u ? TableRecord(*m_heap, address).getStringKey(key) : valueNil();
}

template <bool Assignment, bool RememberPath, typename Lookup>
void TableRecord::resolveIndexChain(StringId indexKey, int slot, TableLookupResult& result, Lookup&& lookup,
	TableStringReadCache* cache, u32 visitLimit) const {
	TableRecord current = *this;
	for (u32 depth = 0; depth < visitLimit; ++depth) {
		const u32 receiver = current.address();
		u32 metatable;
		if constexpr (Assignment) {
			metatable = current.metatableAddress();
			if (metatable == 0u) {
				result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
				return;
			}
		}
		if constexpr (RememberPath) {
			if (depth != 0 && depth == cache->holderDepth) slot = cache->holderSlot;
		}
		const Value own = lookup(current, slot);
		if (!isNil(own)) {
			if constexpr (Assignment) {
				result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
				return;
			}
			if constexpr (RememberPath) {
				if (depth == 0) cache->receiverSlot = slot;
				else {
					cache->holderDepth = depth;
					cache->holderSlot = slot;
				}
			}
			result = {own, slot, depth, TableLookupStatus::Resolved};
			return;
		}
		if constexpr (!Assignment) {
			metatable = current.metatableAddress();
			if (metatable == 0u) {
				result = {depth == 0u ? own : valueNil(), -1, depth, TableLookupStatus::Resolved};
				return;
			}
		}
		current.m_address = metatable;
		Value parent;
		if constexpr (RememberPath) {
			parent = depth < cache->indexSlots.size() ? current.getStringKeyCached(indexKey, cache->indexSlots[depth])
				: current.getStringKey(indexKey);
		} else parent = current.getStringKey(indexKey);
		if (!valueIsTable(parent)) {
			if (valueIsClosure(parent) || valueIsBuiltinFunction(parent))
				result = {parent, -1, depth, TableLookupStatus::Invoke, receiver};
			else if (!isNil(parent)) result = {parent, -1, depth, TableLookupStatus::Forward};
			else if constexpr (Assignment) result = {valueNil(), -1, depth, TableLookupStatus::Store, receiver};
			else result = {valueNil(), -1, depth, TableLookupStatus::Resolved};
			return;
		}
		current.m_address = valuePayload(parent);
		slot = -1;
	}
	result = {valueNil(), -1, visitLimit - 1, TableLookupStatus::ChainExhausted};
}

void TableRecord::resolveIndex(StringId indexKey, const Value& rawKey, TableLookupResult& result, u32 visitLimit) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain(indexKey, -1, result, [key, miss](const TableRecord& table, int&) {
		return miss ? valueNil() : table.getCanonical(key);
	}, nullptr, visitLimit);
}

void TableRecord::resolveIntegerIndex(StringId indexKey, int key, TableLookupResult& result) const {
	resolveIndexChain(indexKey, -1, result, [key](const TableRecord& table, int&) { return table.getInteger(key); });
}

void TableRecord::resolveStringIndex(StringId indexKey, StringId key, TableLookupResult& result) const {
	resolveIndexChain(indexKey, -1, result, [key](const TableRecord& table, int&) { return table.getStringKey(key); });
}

void TableRecord::resolveStringIndexCached(StringId indexKey, StringId key, int predictedSlot, TableLookupResult& result) const {
	resolveIndexChain(indexKey, predictedSlot, result, [key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); });
}

void TableRecord::resolveStringIndexPath(StringId indexKey, StringId key, int receiverPrediction,
	TableLookupResult& result, TableStringReadCache& cache) const {
	resolveIndexChain<false, true>(indexKey, receiverPrediction, result,
		[key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); }, &cache);
}

void TableRecord::resolveAssignment(StringId newIndexKey, Value rawKey, TableLookupResult& result) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain<true>(newIndexKey, -1, result, [key, miss](const TableRecord& table, int&) {
		return miss ? valueNil() : table.getCanonical(key);
	});
}

void TableRecord::resolveIntegerAssignment(StringId newIndexKey, int key, TableLookupResult& result) const {
	resolveIndexChain<true>(newIndexKey, -1, result, [key](const TableRecord& table, int&) { return table.getInteger(key); });
}

void TableRecord::resolveStringAssignment(StringId newIndexKey, StringId key, int predictedSlot, TableLookupResult& result) const {
	resolveIndexChain<true>(newIndexKey, predictedSlot, result, [key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); });
}

u32 TableRecord::trySingleStringIndex(GcHeap* heap, TableSingleIndexProbe* probe, const TableStringReadCache* slots) noexcept {
	const TableRecord receiver(*heap, probe->receiver);
	const auto key = probe->key;
	const u32 count = receiver.hashSlots();
	if (count != 0u) {
		// The emitted receiver prediction missed, but that does not prove
		// absence. Prove it at the live home bucket without chasing links.
		const u32 home = hashCanonicalTableKey(valueString(key)) & (count - 1u);
		if (static_cast<i32>(home) >= 0) {
			const auto body = receiver.hashBody(count, receiver.arrayCapacity());
			if (body.matchesString(home, key)) {
				if (body.slots.tag(body.array + count + home) != ValueTag::Nil) return 0;
			} else if (count != 1u && body.next(home) >= 0) {
				return 0;
			}
		}
	}
	const u32 metatable = receiver.metatableAddress();
	if (metatable == 0u) return 0;
	const TableRecord meta(*heap, metatable);
	const Value parent = meta.hashBody(meta.hashSlots(), meta.arrayCapacity()).predictedString(slots->indexSlots[0], probe->indexKey);
	if (!valueIsTable(parent)) return 0;
	const TableRecord holder(*heap, valuePayload(parent));
	const Value result = holder.hashBody(holder.hashSlots(), holder.arrayCapacity()).predictedString(slots->holderSlot, key);
	if (isNil(result)) return 0;
	probe->result = result;
	return 1;
}

int TableRecord::setStringKey(StringId key, const Value& value) {
	const int nodeIndex = storeStringKeyWithoutGrowth(key, value);
	if (nodeIndex != kStoreRequiresGrowth) return nodeIndex;
	const Value keyValue = valueString(key);
	const Value pendingValue = value;
	rehash(keyValue, pendingValue);
	const int slot = rawSet(keyValue, pendingValue);
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	return slot;
}

int TableRecord::storeStringKeyWithoutGrowth(StringId key, const Value& value) noexcept {
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		removeFromHash(keyValue);
		return -1;
	}
	const u32 count = hashSlots();
	if (count == 0u) return kStoreRequiresGrowth;
	const auto body = hashBody(count, arrayCapacity());
	const u32 home = hashCanonicalTableKey(keyValue) & (count - 1u);
	const int nodeIndex = body.findString(key, home);
	if (nodeIndex >= 0) {
		const u32 slot = body.array + count + static_cast<u32>(nodeIndex);
		if (valueTagHasGcEdge(valueTag(value)) || body.slots.tag(slot) == ValueTag::Nil)
			m_heap->writeBarrier(m_address, GC_RECORD_LINK);
		body.slots.set(slot, value);
		return nodeIndex;
	}
	const int inserted = insertHashWithoutGrowth(body, home, keyValue, value);
	if (inserted < 0) return kStoreRequiresGrowth;
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	return inserted;
}

void TableRecord::setStringKeyCached(StringId key, const Value& value, int& predictedSlot) {
	if (!isNil(value) && predictedSlot >= 0) {
		const u32 count = hashSlots();
		if (static_cast<u32>(predictedSlot) < count) {
			const auto body = hashBody(count, arrayCapacity());
			const u32 keySlot = body.array + static_cast<u32>(predictedSlot), valueSlot = keySlot + count;
			if (body.slots.tag(keySlot) == ValueTag::String && body.slots.word(keySlot) == key
				&& body.slots.tag(valueSlot) != ValueTag::Nil) {
				m_heap->writeValueBarrier(m_address, GC_RECORD_LINK, valueTag(value));
				body.slots.set(valueSlot, value);
				return;
			}
		}
	}
	predictedSlot = setStringKey(key, value);
}

i32 TableRecord::length(const TableRecord* table, u32* work) noexcept {
	constexpr u32 maxBoundary = 0x7fffffffu;
	u32 low = table->lengthHint(), high;
	u32 probes = low == 0 ? 0 : 1;
	if (low != 0 && !table->hasIntegerKey(low)) {
		high = low;
		low = 0;
	} else if (low == maxBoundary) {
		if (work) *work = probes;
		return static_cast<i32>(low);
	} else {
		++probes;
		if (!table->hasIntegerKey(low + 1)) {
			if (work) *work = probes;
			return static_cast<i32>(low);
		}
		++low;
		if (low == maxBoundary) {
			if (work) *work = probes;
			return static_cast<i32>(low);
		}
		high = std::min(low * 2, maxBoundary);
		for (;;) {
			++probes;
			if (!table->hasIntegerKey(high)) break;
			low = high;
			if (low == maxBoundary) {
				if (work) *work = probes;
				return static_cast<i32>(low);
			}
			high = std::min(low * 2, maxBoundary);
		}
	}
	while (high - low > 1) {
		const u32 middle = low + ((high - low) >> 1);
		++probes;
		if (table->hasIntegerKey(middle)) low = middle;
		else high = middle;
	}
	if (work) *work = probes;
	return static_cast<i32>(low);
}

void TableRecord::clear() {
	writeHeader(TableHeader::Length, 0);
	freeStorage();
	bindStorage(0, 0, 0);

}

bool TableRecord::loadStoredEntry(size_t slot, Value& key, Value& value) const {
	if (slot < arrayCapacity()) {
		if (isNil(values().get(slot))) return false;
		key = valueInteger(static_cast<i32>(slot + 1));
		value = values().get(slot);
		return true;
	}
	const size_t hashIndex = slot - arrayCapacity();
	if (isNil(values().get(hashKeySlot(hashIndex))) || isNil(values().get(hashValueSlot(hashIndex)))) return false;
	key = values().get(hashKeySlot(hashIndex));
	value = values().get(hashValueSlot(hashIndex));
	return true;
}

size_t TableRecord::nextEntry(const Value& rawAfter, Value& key, Value& value) const {
	if (valueIsNaN(rawAfter)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
	const Value after = canonicalTableKey(rawAfter);
	size_t arrayStart = 0;
	size_t hashStart = 0;
	if (!isNil(after)) {
		const u32 index = arraySlot(after);
		if (index < arrayCapacity()) {
			arrayStart = index + 1u;
		} else {
			const int nodeIndex = findNodeIndex(after, true);
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			arrayStart = arrayCapacity();
			hashStart = static_cast<size_t>(nodeIndex + 1);
		}
	}
	for (size_t i = arrayStart; i < arrayCapacity(); ++i) {
		if (!isNil(values().get(i))) {
			key = valueInteger(static_cast<i32>(i + 1));
			value = values().get(i);
			return i - arrayStart + 1;
		}
	}
	const size_t arraySlots = arrayCapacity() - arrayStart;
	const int hashIndex = findNextLiveHashIndex(hashStart);
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = values().get(hashKeySlot(slot));
		value = values().get(hashValueSlot(slot));
		return arraySlots + 2 * (slot - hashStart + 1);
	}
	key = valueNil();
	return arraySlots + 2 * (hashSlots() - hashStart);
}



size_t TableRecord::trackedHeapBytes() const {
	return trackedHeapBytesForCapacities(arrayCapacity(), hashSlots());
}


} // namespace bmsx
