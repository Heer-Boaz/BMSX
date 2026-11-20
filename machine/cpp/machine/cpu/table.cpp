#include "machine/cpu/table.h"

#include <algorithm>
#include <array>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

namespace bmsx {

namespace {
constexpr int32_t kTableHashNextEnd = -1;
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
	writeBarrier();
	writeHeader(TableHeader::Metatable, address);
}

void TableRecord::writeBarrier() {
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
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

bool TableRecord::getArrayIndex(const Value& key, int& outIndex) const {
	i32 integer;
	if (!valueToInteger(key, integer) || integer <= 0) return false;
	outIndex = integer - 1;
	return true;
}

Value TableRecord::metatableIndexValue(StringId indexKey) const {
	const u32 meta = metatableAddress();
	return meta ? TableRecord(*m_heap, meta).getStringKey(indexKey) : valueNil();
}

bool TableRecord::hasIntegerKey(u32 key) const {
	if (key <= arrayCapacity()) {
		return !isNil(values().get(static_cast<size_t>(key - 1)));
	}
	const int nodeIndex = findNodeIndex(valueInteger(static_cast<i32>(key)));
	return nodeIndex >= 0 && !isNil(values().get(hashValueSlot(static_cast<size_t>(nodeIndex))));
}

size_t TableRecord::hashValue(const Value& key) const {
	return m_heap->hash(key);
}

int TableRecord::findNodeIndex(const Value& key, bool matchDead) const {
	const u32 hash = hashSlots();
	if (hash == 0u) return -1;
	const u32 array = arrayCapacity(), words = storageAddress();
	const u32 links = words + (array + 2u * hash) * 4u, tags = links + hash * 4u;
	const auto tag = valueTag(key);
	const u32 payload = valuePayload(key);
	const bool collectableKey = matchDead && (tag == ValueTag::Table || tag == ValueTag::Closure || tag == ValueTag::Thread);
	int index = static_cast<int>(hashValue(key) & (hash - 1u));
	for (u32 remaining = hash; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		const u32 keySlot = array + slot;
		const auto nodeTag = static_cast<ValueTag>(m_memory->readRamRecordByte(tags + keySlot));
		if (nodeTag == tag) {
			if (m_memory->readRamRecordWord(words + keySlot * 4u) == payload) return index;
		} else if (collectableKey && nodeTag == ValueTag::Nil
			&& m_memory->readRamRecordWord(words + keySlot * 4u) == valueTagHeader(tag)) {
			const u32 valueSlot = keySlot + hash;
			if (m_memory->readRamRecordByte(tags + valueSlot) == static_cast<u8>(ValueTag::DeadKey)
				&& m_memory->readRamRecordWord(words + valueSlot * 4u) == payload) return index;
		}
		index = static_cast<i32>(m_memory->readRamRecordWord(links + slot * 4u));
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

inline int TableRecord::HashBody::findString(StringId key) const {
	int index = static_cast<int>(scalarValueHash(valueString(key)) & (count - 1u));
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		const u32 keySlot = array + slot;
		if (slots.tag(keySlot) == ValueTag::String && slots.word(keySlot) == key) return index;
		index = next(slot);
	}
	return -1;
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
	const auto body = hashBody(hashSlots());
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
			int index = 0;
			if ((tag == ValueTag::Integer || tag == ValueTag::Float)
				&& getArrayIndex(valueFromTag(tag, slots.word(slot)), index)) {
				countIntegerKey(static_cast<size_t>(index) + 1);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		int index = 0;
		if (getArrayIndex(key, index)) {
			countIntegerKey(static_cast<size_t>(index) + 1);
		}
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

// Storage redistribution must not change the logical boundary hint.
int TableRecord::rawSet(const Value& key, const Value& value) {
	writeBarrier();
	int index = 0;
	if (getArrayIndex(key, index) && static_cast<size_t>(index) < arrayCapacity()) {
		values().set(static_cast<size_t>(index), value);
		return -1;
	}
	return insertHash(key, value);
}

int TableRecord::insertHash(const Value& key, const Value& value) {
	const u32 count = hashSlots();
	if (count != 0u) {
		const int nodeIndex = insertHashWithoutGrowth(hashBody(count), key, value);
		if (nodeIndex >= 0) return nodeIndex;
	}
	// Growth may collect and relocate a source Thread's register storage.
	const Value pendingKey = key, pendingValue = value;
	rehash(pendingKey, pendingValue);
	return rawSet(pendingKey, pendingValue);
}

int TableRecord::insertHashWithoutGrowth(const HashBody& body, const Value& key, const Value& value) noexcept {
	const auto& slots = body.slots;
	const u32 count = body.count, mask = count - 1u;
	const int mainIndex = static_cast<int>(hashValue(key) & mask);
	const u32 mainSlot = static_cast<u32>(mainIndex);
	const u32 keySlot = body.array + mainSlot, valueSlot = keySlot + count;
	const auto tag = slots.tag(keySlot);
	if (tag == ValueTag::Nil || slots.tag(valueSlot) == ValueTag::Nil) {
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		return mainIndex;
	}
	const Value mainKey = valueFromTag(tag, slots.word(keySlot));
	const int freeIndex = getFreeIndex(body);
	if (freeIndex < 0) return -1;
	const u32 freeSlot = static_cast<u32>(freeIndex), freeKey = body.array + freeSlot;
	const int mainIndexOfOccupied = static_cast<int>(hashValue(mainKey) & mask);
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
	const Value key = canonicalTableKey(rawKey);
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	int index = 0;
	if (getArrayIndex(key, index)) {
		if (index < static_cast<int>(arrayCapacity())) {
			return values().get(static_cast<size_t>(index));
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return values().get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	return valueNil();
}

void TableRecord::set(const Value& rawKey, const Value& value) {
	const Value key = canonicalTableKey(rawKey);
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	writeBarrier();
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (idx < arrayCapacity()) {
			setArraySlot(idx, value);
			return;
		}
	}

	if (isNil(value)) {
		removeFromHash(key);
		if (isArrayKey) updateLengthHint(static_cast<size_t>(index), false);
		return;
	}
	int nodeIndex = findNodeIndex(key, true);
	if (nodeIndex >= 0) {
		const size_t slot = static_cast<size_t>(nodeIndex);
		if (isNil(values().get(hashKeySlot(slot)))) {
			values().set(hashKeySlot(slot), key);
		}
		values().set(hashValueSlot(slot), value);
		if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
}

Value TableRecord::getInteger(int indexValue) const {
	const u32 index = static_cast<u32>(indexValue) - 1u;
	if (index < arrayCapacity()) {
		return values().get(static_cast<size_t>(index));
	}
	const int nodeIndex = findNodeIndex(valueInteger(indexValue));
	if (nodeIndex >= 0) {
		return values().get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	return valueNil();
}

void TableRecord::setInteger(int indexValue, const Value& value) {
	writeBarrier();
	const u32 index = static_cast<u32>(indexValue) - 1u;
	if (index < arrayCapacity()) {
		setArraySlot(static_cast<size_t>(index), value);
		return;
	}
	const Value key = valueInteger(indexValue);
	if (isNil(value)) {
		removeFromHash(key);
		if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), false);
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		values().set(hashValueSlot(static_cast<size_t>(nodeIndex)), value);
		if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), true);
}

Value TableRecord::getStringKey(StringId key) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count);
	const int nodeIndex = body.findString(key);
	return nodeIndex < 0 ? valueNil() : body.slots.get(body.array + count + static_cast<u32>(nodeIndex));
}

Value TableRecord::getStringKeyCached(StringId key, int& predictedSlot) const {
	const u32 count = hashSlots();
	if (count != 0u) {
		const auto body = hashBody(count);
		const auto& slots = body.slots;
		if (predictedSlot >= 0 && static_cast<u32>(predictedSlot) < count) {
			const u32 keySlot = body.array + static_cast<u32>(predictedSlot);
			if (slots.tag(keySlot) == ValueTag::String && slots.word(keySlot) == key) {
				const u32 valueSlot = keySlot + count;
				const auto tag = slots.tag(valueSlot);
				if (tag != ValueTag::Nil) return valueFromTag(tag, slots.word(valueSlot));
			}
		}
		const int nodeIndex = body.findString(key);
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

void TableRecord::loadStringIndex(const TableRecord* table, StringId indexKey, StringId key, TableLookupResult& result) noexcept {
	table->resolveStringIndexCached(indexKey, key, -1, result);
}

void TableRecord::loadStringIndexInNative(GcHeap* heap, const TableReadRequest& request, TableLookupResult& result) noexcept {
	TableRecord(*heap, request.address).resolveStringIndexCached(request.indexKey, request.keyWord, -1, result);
}

void TableRecord::loadIndexInNative(GcHeap* heap, const TableReadRequest& request, TableLookupResult& result) noexcept {
	const auto tag = static_cast<ValueTag>(request.keyTag);
	if (tag == ValueTag::Nil) {
		result.status = TableLookupStatus::NilKey;
		return;
	}
	const Value key = valueFromTag(tag, request.keyWord);
	const TableRecord table(*heap, request.address);
	if (table.metatableAddress())
		table.resolveIndex(request.indexKey, key, result);
	else
		result = {table.get(key), -1, 0u, TableLookupStatus::Resolved};
}

int TableRecord::setStringKey(StringId key, const Value& value) {
	const int nodeIndex = storeStringKeyWithoutGrowth(this, key, value);
	if (nodeIndex != TABLE_STORE_REQUIRES_GROWTH) return nodeIndex;
	const Value keyValue = valueString(key);
	const Value pendingValue = value;
	rehash(keyValue, pendingValue);
	return rawSet(keyValue, pendingValue);
}

int TableRecord::storeStringKeyInNative(GcHeap* heap, u32 address, StringId key, const Value& value) noexcept {
	// Hash maintenance can write any linked record word. Never invalidate code
	// from a returning native leaf: the dispatcher owns that instruction then.
	TableRecord table(*heap, address);
	const auto& watches = heap->memory.ramWriteWatches();
	if (watches.anyWatched()) {
		const u32 header = address & RAM_RECORD_WORD_MASK;
		const u32 storage = table.storageAddress() & RAM_RECORD_WORD_MASK;
		const u64 bytes = 5ull * table.arrayCapacity() + 14ull * table.hashSlots();
		if (header > MAIN_RAM_SIZE - HEADER_BYTES || watches.anyWatched(header, HEADER_BYTES)
			|| bytes > MAIN_RAM_SIZE - storage || (bytes && watches.anyWatched(storage, static_cast<size_t>(bytes)))
			|| ((heap->memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u && watches.anyWatched(heap->changedHeadOffset(), sizeof(u32))))
			return TABLE_STORE_REQUIRES_GROWTH;
	}
	return storeStringKeyWithoutGrowth(&table, key, value);
}

int TableRecord::storeStringKeyWithoutGrowth(TableRecord* table, StringId key, const Value& value) noexcept {
	table->writeBarrier();
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		table->removeFromHash(keyValue);
		return -1;
	}
	const u32 count = table->hashSlots();
	if (count == 0u) return TABLE_STORE_REQUIRES_GROWTH;
	const auto body = table->hashBody(count);
	const int nodeIndex = body.findString(key);
	if (nodeIndex >= 0) {
		body.slots.set(body.array + count + static_cast<u32>(nodeIndex), value);
		return nodeIndex;
	}
	const int inserted = table->insertHashWithoutGrowth(body, keyValue, value);
	return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
}

void TableRecord::setStringKeyCached(StringId key, const Value& value, int& predictedSlot) {
	writeBarrier();
	if (!isNil(value) && predictedSlot >= 0) {
		const u32 count = hashSlots();
		if (static_cast<u32>(predictedSlot) < count) {
			const auto body = hashBody(count);
			const u32 keySlot = body.array + static_cast<u32>(predictedSlot), valueSlot = keySlot + count;
			if (body.slots.tag(keySlot) == ValueTag::String && body.slots.word(keySlot) == key
				&& body.slots.tag(valueSlot) != ValueTag::Nil) {
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
	const Value after = canonicalTableKey(rawAfter);
	size_t arrayStart = 0;
	size_t hashStart = 0;
	if (!isNil(after)) {
		int index = 0;
		if (getArrayIndex(after, index)
			&& index < static_cast<int>(arrayCapacity())) {
			arrayStart = static_cast<size_t>(index + 1);
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
