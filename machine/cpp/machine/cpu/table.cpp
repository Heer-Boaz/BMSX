#include "machine/cpu/table.h"

#include <algorithm>
#include <bit>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

#include "machine/cpu/table_hash_lookup.inl"

namespace bmsx {

void TableRecord::setArraySlot(size_t slot, const Value& value) {
	values().set(slot, value);
	updateLengthHint(slot, !isNil(value));
}

u32 TableRecord::arraySlot(const Value& key) {
	i32 integer;
	return valueToInteger(key, integer) ? arraySlot(integer) : NO_ARRAY_SLOT;
}

int TableRecord::findNodeIndex(const Value& key, bool matchDead) const {
	const u32 count = hashSlots();
	return count == 0u ? -1
		: hashBody(count).findNode(key, hashCanonicalTableKey(key) & (count - 1u), matchDead);
}

void TableRecord::removeFromHash(const Value& key, int slot) {
	const int existingIndex = slot == TABLE_HASH_UNPROBED ? findNodeIndex(key) : slot;
	if (existingIndex < 0) return;
	const u32 count = hashSlots();
	const auto tag = hashBody(count).slots.tag(count + static_cast<u32>(existingIndex));
	if (tag == ValueTag::Nil || tag == ValueTag::DeadKey) return;
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void TableRecord::markHashNodeDead(size_t index) {
	const auto body = hashBody(hashSlots());
	const Value key = body.slots.get(index);
	if (body.count > HASH_CENSUS_LIMIT) { body.setLive(body.live() - 1u); body.adjustIntegerBand(key, -1); }
	if (valueIsTable(key) || valueIsThread(key) || valueIsClosure(key)) {
		const uint32_t hashId = valuePayload(key);
		hashBody(hashSlots()).slots.set(index, valueFromTag(ValueTag::Nil, valueHeader(key)));
		hashBody(hashSlots()).slots.set(hashValueSlot(index), valueFromTag(ValueTag::DeadKey, hashId));
	} else {
		hashBody(hashSlots()).slots.set(hashValueSlot(index), valueNil());
		if (valueIsString(key) && valuePayload(key) == m_heap->diagnosticWord(GcDiagnosticField::NewIndex)) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 1u);
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
	const auto body = hashBody(count);
	const int index = body.findNode(key, hashCanonicalTableKey(key) & (count - 1u));
	return index < 0 ? valueNil() : body.slots.get(count + static_cast<u32>(index));
}

bool TableRecord::tryAssignOwn(Value rawKey, Value value, int& position) {
	if (isNil(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	if (valueIsNaN(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
	const Value key = canonicalTableKey(rawKey);
	const u32 index = arraySlot(key);
	const bool reference = valueTagHasGcEdge(valueTag(value));
	if (index < arrayCapacity()) {
		position = ARRAY_STORE_POSITION;
		if (reference) return false;
		setArraySlot(index, value);
		return true;
	}
	const bool present = !isNil(value);
	if (!present) {
		removeFromHash(key, position);
		position = -1;
	} else {
		if (reference && position != TABLE_HASH_UNPROBED) return false;
		const u32 count = hashSlots();
		const auto body = hashBody(count);
		if (position == TABLE_HASH_UNPROBED) {
			position = -1;
			if (count != 0u) {
				const u32 home = hashCanonicalTableKey(key) & (count - 1u);
				position = valueIsString(key) ? body.findString(asStringId(key), home) : body.findNode(key, home, true);
			}
		}
		if (position < 0 || reference) return false;
		const u32 slot = count + static_cast<u32>(position);
		const auto prior = body.slots.tag(slot);
		if (prior == ValueTag::Nil || prior == ValueTag::DeadKey) return false;
		body.slots.set(slot, value);
	}
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
	return true;
}

template <TableRecord::HashStore Policy>
int TableRecord::assignHash(Value key, Value value, int nodeIndex) noexcept {
	if (valueTagHasGcEdge(valueTag(value))) return HASH_STORE_DECLINED;
	const u32 count = hashSlots();
	const auto body = hashBody(count);
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	if (nodeIndex == TABLE_HASH_UNPROBED) {
		nodeIndex = -1;
		if (count != 0u) {
			if constexpr (Policy == HashStore::ReturningIndex) nodeIndex = body.findNode(key, home, true);
			else nodeIndex = body.findString(asStringId(key), home);
		}
	}
	return assignProbedHash(body, nodeIndex, value);
}

int TableRecord::assignProbedHash(const HashBody& body, int nodeIndex, Value value) noexcept {
	const bool erase = valueTag(value) == ValueTag::Nil;
	const u32 count = body.count;
	if (nodeIndex >= 0) {
		const u32 valueSlot = static_cast<u32>(nodeIndex) + count;
		const auto prior = body.slots.tag(valueSlot);
		if (prior != ValueTag::Nil && prior != ValueTag::DeadKey) {
			if (erase) {
				markHashNodeDead(nodeIndex);
				return -1;
			}
			body.slots.set(valueSlot, value);
			return nodeIndex;
		}
	}
	// Only an absent own field can trigger __newindex.
	if (!erase) return HASH_STORE_DECLINED;
	const u32 meta = newIndexMetatable();
	if (meta != 0u && !isNil(TableRecord(*m_heap, meta).getStringKey(m_heap->diagnosticWord(GcDiagnosticField::NewIndex)))) return HASH_STORE_DECLINED;
	return -1;
}

bool TableRecord::tryAssignIdentityHash(Value key, Value value) noexcept {
	return assignHash<HashStore::ReturningIndex>(key, value) != HASH_STORE_DECLINED;
}

bool TableRecord::tryAssignIntegerHash(i32 key, Value value) noexcept {
	if (assignHash<HashStore::ReturningIndex>(valueInteger(key), value) == HASH_STORE_DECLINED) return false;
	const u32 slot = arraySlot(key);
	if (slot != NO_ARRAY_SLOT) updateLengthHint(slot, !isNil(value));
	return true;
}

int TableRecord::tryAssignStringField(StringId key, Value value) noexcept {
	return assignHash<HashStore::ReturningField>(valueString(key), value);
}

int TableRecord::tryAssignCachedStringField(StringId key, Value value, int predicted) noexcept {
	if (valueTagHasGcEdge(valueTag(value))) return HASH_STORE_DECLINED;
	const u32 count = hashSlots();
	const auto body = hashBody(count);
	// The site supplies a hint, never an authoritative assignment slot.
	// A hit needs neither a hash nor a chain walk; on miss keep the same body.
	if (static_cast<u32>(predicted) < count && body.matchesString(predicted, key)) {
		const u32 slot = count + static_cast<u32>(predicted);
		if (!isNil(value) && body.slots.tag(slot) != ValueTag::Nil) {
			body.slots.set(slot, value);
			return predicted;
		}
	} else predicted = TABLE_HASH_UNPROBED;
	const Value string = valueString(key);
	const u32 home = hashCanonicalTableKey(string) & (count - 1u);
	if (predicted == TABLE_HASH_UNPROBED) predicted = count ? body.findString(key, home) : -1;
	return assignProbedHash(body, predicted, value);
}

Value TableRecord::getInteger(int indexValue) const {
	const u32 index = arraySlot(indexValue);
	if (index < arrayCapacity()) return values().get(index);
	return getHash(valueInteger(indexValue));
}

Value TableRecord::getStringKey(StringId key, u32* linkCycles) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count);
	const int nodeIndex = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u), linkCycles);
	return nodeIndex < 0 ? valueNil() : body.slots.get(count + static_cast<u32>(nodeIndex));
}

TableStringProbe TableRecord::beginStringProbe(StringId key) const {
	const u32 count = hashSlots();
	return {count == 0u ? -1 : static_cast<i32>(hashCanonicalTableKey(valueString(key)) & (count - 1u)), count};
}

size_t TableRecord::advanceStringProbe(StringId key, TableStringProbe& probe, size_t limit) const {
	const auto body = hashBody(hashSlots());
	const u32 allowance = static_cast<u32>(std::min<size_t>(probe.remaining, limit));
	u32 left = allowance;
	probe.slot = body.scanStringNodes(key, probe.node, left);
	if (probe.slot >= 0) probe.value = body.slots.get(body.count + static_cast<u32>(probe.slot));
	const u32 inspected = allowance - left;
	probe.remaining -= inspected;
	return inspected;
}

Value TableRecord::findStringField(const HashBody& body, StringId key, int& slot, u32* linkCycles) {
	const int node = body.findString(key, hashCanonicalTableKey(valueString(key)) & (body.count - 1u), linkCycles);
	if (node >= 0) {
		const Value value = body.slots.get(body.count + static_cast<u32>(node));
		if (!isNil(value)) {
			slot = node;
			return value;
		}
	}
	slot = -1;
	return valueNil();
}

Value TableRecord::getStringKeyCached(StringId key, int& predictedSlot, u32* linkCycles) const {
	const u32 count = hashSlots();
	if (count != 0u) {
		const auto body = hashBody(count);
		if (count <= TABLE_STRING_HIT_BASE_NODES && predictedSlot >= 0 && static_cast<u32>(predictedSlot) < count) {
			const Value predicted = body.predictedString(predictedSlot, key);
			if (!isNil(predicted)) return predicted;
		}
		return findStringField(body, key, predictedSlot, linkCycles);
	}
	predictedSlot = -1;
	return valueNil();
}

Value TableRecord::metatableField(GcDiagnosticField field) const {
	const u32 address = metatableAddress();
	return address != 0u ? TableRecord(*m_heap, address).getStringKey(m_heap->diagnosticWord(field)) : valueNil();
}

u32 TableRecord::newIndexMetatable() const {
	const u32 meta = metatableAddress();
	return meta != 0u && m_memory->readRamRecordByte(meta + TABLE_NEW_INDEX_ABSENT_BYTE) == 1u ? 0u : meta;
}

template <bool Assignment, bool OwnMiss, typename Lookup>
void TableRecord::resolveIndexChain(int slot, TableLookupResult& result, Lookup&& lookup,
	u32 visitLimit, u32* linkCycles) const {
	TableRecord current = *this;
	std::optional<StringId> method;
	u32 anchor = 0, anchorDepth = 0, anchorLinks = 0;
	for (u32 depth = 0; depth < visitLimit; ++depth) {
		const u32 receiver = current.address();
		u32 metatable;
		if constexpr (Assignment) {
			metatable = current.newIndexMetatable();
			if (metatable == 0u) {
				result = {valueNil(), TABLE_HASH_UNPROBED, depth, TableLookupStatus::Store, receiver};
				return;
			}
		}
		const auto own = [&] {
			if constexpr (OwnMiss) {
				static_assert(!Assignment);
				if (depth == 0u) return valueNil();
			}
			return lookup(current, slot);
		}();
		if constexpr (Assignment) {
			if (own) {
				result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
				return;
			}
		} else if (!isNil(own)) {
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
		if (!method) method = m_heap->diagnosticWord(Assignment ? GcDiagnosticField::NewIndex : GcDiagnosticField::Index);
		Value parent;
		if constexpr (Assignment) {
			parent = current.getStringKey(*method);
		} else parent = current.getStringKey(*method, linkCycles);
		if (!valueIsTable(parent)) {
			const auto kind = valueTag(parent);
			if (kind == ValueTag::Closure || kind == ValueTag::BuiltinFunction || kind == ValueTag::CodeFunction)
				result = {parent, -1, depth, TableLookupStatus::Invoke, receiver};
			else if (!isNil(parent)) result = {parent, -1, depth, TableLookupStatus::Forward};
			else if constexpr (Assignment) result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
			else result = {valueNil(), -1, depth, TableLookupStatus::Resolved};
			return;
		}
		current.m_address = valuePayload(parent);
		if constexpr (!Assignment) {
			// No guest code runs on Table-to-Table edges. From the same
			// receiver and key, one full period repeats the same probe work.
			// Anchor at inherited depths 1,2,4,..., where there is no initial
			// slot prediction or pre-probed own miss to skew the first period.
			const u32 nextDepth = depth + 1u;
			if (anchorDepth && current.m_address == anchor) {
				if (!linkCycles) break;
				const u32 period = nextDepth - anchorDepth;
				const u32 repeats = (visitLimit - nextDepth) / period;
				*linkCycles += repeats * (*linkCycles - anchorLinks);
				depth += repeats * period;
			} else if (std::has_single_bit(nextDepth)) {
				anchor = current.m_address;
				anchorDepth = nextDepth;
				if (linkCycles) anchorLinks = *linkCycles;
			}
		}
		slot = -1;
	}
	result = {valueNil(), -1, visitLimit - 1, TableLookupStatus::ChainExhausted};
}

u32 TableRecord::resolveIndex(const Value& rawKey, TableLookupResult& result, u32 visitLimit) const {
	if (valueIsString(rawKey)) return resolveStringIndexCached(asStringId(rawKey), -1, result, visitLimit);
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	u32 links = 0;
	resolveIndexChain(-1, result, [key, miss](const TableRecord& table, int&) {
		return miss ? valueNil() : table.getCanonical(key);
	}, visitLimit, &links);
	return links;
}

u32 TableRecord::resolveIntegerIndex(int key, TableLookupResult& result) const {
	u32 links = 0;
	resolveIndexChain(-1, result, [key](const TableRecord& table, int&) { return table.getInteger(key); }, TABLE_INDEX_CHAIN_LIMIT, &links);
	return links;
}

void TableRecord::resolveStringIndex(StringId key, TableLookupResult& result) const {
	resolveIndexChain(-1, result, [key](const TableRecord& table, int&) { return table.getStringKey(key); });
}

u32 TableRecord::resolveMissingStringIndex(StringId key, TableLookupResult& result) const {
	u32 links = 0;
	resolveIndexChain<false, true>(-1, result, [&](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot, &links); }, TABLE_INDEX_CHAIN_LIMIT, &links);
	return links;
}

u32 TableRecord::resolveStringIndexCached(StringId key, int predictedSlot, TableLookupResult& result, u32 visitLimit) const {
	u32 links = 0;
	resolveIndexChain(predictedSlot, result, [&](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot, &links); }, visitLimit, &links);
	return links;
}

bool TableRecord::probeAssignment(const Value& key, int& position) const {
	const u32 index = arraySlot(key);
	if (index < arrayCapacity()) {
		position = TABLE_HASH_UNPROBED;
		return values().tag(index) != ValueTag::Nil;
	}
	const u32 count = hashSlots();
	position = -1;
	if (count == 0u) return false;
	const auto body = hashBody(count);
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	position = valueIsString(key) ? body.findString(asStringId(key), home) : body.findNode(key, home, true);
	if (position < 0) return false;
	const auto tag = body.slots.tag(count + static_cast<u32>(position));
	return tag != ValueTag::Nil && tag != ValueTag::DeadKey;
}

void TableRecord::resolveAssignment(Value rawKey, TableLookupResult& result) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain<true>(-1, result, [key, miss](const TableRecord& table, int& slot) {
		return !miss && table.probeAssignment(key, slot);
	});
}

void TableRecord::resolveIntegerAssignment(int key, TableLookupResult& result) const {
	resolveIndexChain<true>(-1, result, [key](const TableRecord& table, int& slot) {
		return table.probeAssignment(valueInteger(key), slot);
	});
}

void TableRecord::resolveStringAssignment(StringId key, TableLookupResult& result, int predicted) const {
	if (predicted >= 0) {
		const u32 count = hashSlots();
		if (static_cast<u32>(predicted) < count) {
			const auto body = hashBody(count);
			if (body.matchesString(predicted, key) && body.slots.tag(count + static_cast<u32>(predicted)) != ValueTag::Nil) {
				result = {valueNil(), predicted, 0u, TableLookupStatus::Store, m_address};
				return;
			}
		}
	}
	resolveIndexChain<true>(-1, result, [key](const TableRecord& table, int& slot) {
		const u32 count = table.hashSlots();
		if (count == 0u) return false;
		const auto body = table.hashBody(count);
		slot = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
		return slot >= 0 && body.slots.tag(body.count + static_cast<u32>(slot)) != ValueTag::Nil;
	});
}

bool TableRecord::storePredictedStringKey(StringId key, Value value, int predicted) noexcept {
	if (isNil(value) || valueTagHasGcEdge(valueTag(value)) || predicted < 0) return false;
	const u32 count = hashSlots();
	if (static_cast<u32>(predicted) >= count) return false;
	const auto body = hashBody(count);
	const u32 node = static_cast<u32>(predicted), valueSlot = node + count;
	if (!body.matchesString(node, key) || body.slots.tag(valueSlot) == ValueTag::Nil) return false;
	body.slots.set(valueSlot, value);
	return true;
}

i32 TableRecord::length(TableRecord* table) noexcept {
	constexpr u32 maxBoundary = 0x7fffffffu;
	const auto body = table->hashBody(table->hashSlots());
	const auto hasIntegerKey = [&](u32 key) {
		if (key <= table->arrayCapacity()) return table->values().tag(key - 1u) != ValueTag::Nil;
		if (body.count == 0) return false;
		const auto integer = valueInteger(static_cast<i32>(key));
		const int node = body.findNode(integer, hashCanonicalTableKey(integer) & (body.count - 1u));
		return node >= 0 && body.slots.tag(body.count + static_cast<u32>(node)) != ValueTag::Nil;
	};
	u32 low = table->lengthHint(), high;
	if (low != 0 && !hasIntegerKey(low)) {
		high = low;
		low = 0;
	} else if (low == maxBoundary) {
		return static_cast<i32>(low);
	} else {
		if (!hasIntegerKey(low + 1)) {
			return static_cast<i32>(low);
		}
		++low;
		high = std::min(low * 2, maxBoundary);
		while (low != maxBoundary && hasIntegerKey(high)) {
			low = high;
			high = std::min(low * 2, maxBoundary);
		}
	}
	while (high - low > 1) {
		const u32 middle = low + ((high - low) >> 1);
		if (hasIntegerKey(middle)) low = middle;
		else high = middle;
	}
	table->writeHeader(TableHeader::Length, low);
	return static_cast<i32>(low);
}

bool TableRecord::loadHashEntry(const HashBody& body, u32 slot, Value& key, Value& value) {
	if (body.slots.tag(slot) == ValueTag::Nil || body.slots.tag(slot + body.count) == ValueTag::Nil) return false;
	key = body.slots.get(slot);
	value = body.slots.get(slot + body.count);
	return true;
}

bool TableRecord::loadStoredEntry(size_t slot, Value& key, Value& value) const {
	const auto body = hashBody(hashSlots());
	if (slot >= arrayCapacity()) return loadHashEntry(body, slot - arrayCapacity(), key, value);
	if (values().tag(slot) == ValueTag::Nil) return false;
	key = valueInteger(static_cast<i32>(slot + 1));
	value = values().get(slot);
	return true;
}

void TableRecord::nextEntry(const Value& rawAfter, Value& key, Value& value) const {
	if (valueIsNaN(rawAfter)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
	const Value after = canonicalTableKey(rawAfter);
	const auto body = hashBody(hashSlots());
	u32 position = 0;
	if (!isNil(after)) {
		const u32 index = arraySlot(after);
		if (index < arrayCapacity()) {
			position = index + 1u;
		} else {
			const int nodeIndex = body.count ? body.findNode(after, hashCanonicalTableKey(after) & (body.count - 1u), true) : -1;
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			position = arrayCapacity() + static_cast<u32>(nodeIndex) + 1u;
		}
	}
	(void)nextStoredEntry(body, position, key, value);
}

u32 TableRecord::nextStoredEntry(u32 position, Value& key, Value& value) const {
	return nextStoredEntry(hashBody(hashSlots()), position, key, value);
}

u32 TableRecord::nextStoredEntry(const HashBody& body, u32 position, Value& key, Value& value) const {
	const auto elements = values();
	const u32 array = arrayCapacity();
	for (; position < array; ++position) {
		if (elements.tag(position) == ValueTag::Nil) continue;
		key = valueInteger(static_cast<i32>(position + 1u));
		value = elements.get(position);
		return position + 1u;
	}
	for (; position < array + body.count; ++position)
		if (loadHashEntry(body, position - array, key, value)) return position + 1u;
	key = valueNil();
	return 0;
}

} // namespace bmsx
