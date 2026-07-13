#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/common/number_format.h"
#include "lua/numeric.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/memory.h"
#include "common/utf8.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_set>

#if defined(__GNUC__) || defined(__clang__)
#define BMSX_USE_COMPUTED_GOTO 1
#else
#define BMSX_USE_COMPUTED_GOTO 0
#endif

namespace bmsx {

// start repeated-sequence-acceptable -- CPU interpreter hot paths keep duplicated opcode/register statements inline.

uint32_t valueObjectHashId(Value v) {
	switch (valueTag(v)) {
		case ValueTag::Table:
			return asTable(v)->hashId;
		case ValueTag::Closure:
			return asClosure(v)->hashId;
		case ValueTag::NativeFunction:
			return asNativeFunction(v)->hashId;
		case ValueTag::NativeObject:
			return asNativeObject(v)->hashId;
		case ValueTag::Upvalue:
			return asUpvalue(v)->hashId;
		default:
			return static_cast<uint32_t>(valuePayload(v));
	}
}

uint32_t valueBuiltinFunctionHashId(Value v) {
	return static_cast<uint32_t>(asBuiltinFunction(v)->id) + 1u;
}

namespace {
static constexpr NativeFnCost kNativeCostTier1 { 1, 0, 0 };
static constexpr NativeFnCost kNativeCostTier2 { 2, 0, 0 };
static constexpr NativeFnCost kNativeCostTier4 { 4, 0, 0 };
static constexpr NativeFnCost kDefaultNativeCost = kNativeCostTier1;

constexpr std::array<NativeFnCost, BUILTIN_FUNCTION_COUNT> kBuiltinFunctionCosts {{
	kNativeCostTier1,
	kNativeCostTier1,
	kNativeCostTier2,
	kNativeCostTier2,
	kNativeCostTier1,
	kNativeCostTier1,
	kNativeCostTier1,
	kNativeCostTier2,
	kNativeCostTier2,
	kNativeCostTier2,
	kNativeCostTier4,
	kNativeCostTier4,
}};

constexpr size_t kTableHeapBytes = 32;
constexpr size_t kTableArraySlotHeapBytes = 8;
constexpr size_t kTableHashSlotHeapBytes = 20;
constexpr size_t kClosureHeapBytes = 16;
constexpr size_t kClosureUpvalueSlotHeapBytes = 8;
constexpr ptrdiff_t kNativeFunctionHeapBytes = 16;
constexpr ptrdiff_t kNativeObjectHeapBytes = 24;
constexpr ptrdiff_t kUpvalueHeapBytes = 24;
static inline size_t trackedClosureBytes(const Closure& closure) {
	return closure.trackedHeapBytes;
}

static inline size_t closureAllocationBytes(size_t upvalueCount) {
	return sizeof(Closure) + (upvalueCount * sizeof(Upvalue*));
}

} // namespace

LuaThrownValueError::LuaThrownValueError(Value value, const StringPool& stringPool)
	: value(value)
	, message(valueToString(value, stringPool)) {}

std::string valueToString(const Value& v, const StringPool& stringPool) {
	if (isNil(v)) return "nil";
	if (valueIsTagged(v)) {
		switch (valueTag(v)) {
			case ValueTag::False: return "false";
			case ValueTag::True: return "true";
			case ValueTag::String: return stringPool.toString(asStringId(v));
			case ValueTag::Table: return "table";
			case ValueTag::Closure: return "function";
			case ValueTag::BuiltinFunction: return "function";
			case ValueTag::NativeFunction: return "function";
			case ValueTag::NativeObject: return "native";
			case ValueTag::Upvalue: return "upvalue";
			case ValueTag::Nil: return "nil";
			default: return "unknown";
		}
	}
	double num = asNumber(v);
	if (!std::isfinite(num)) {
		return std::isnan(num) ? "nan" : (num < 0 ? "-inf" : "inf");
	}
	return formatNumber(num);
}

const inline char* valueTypeName(Value v) {
	if (valueIsNumber(v)) return "number";
	if (!valueIsTagged(v)) return "unknown";
	switch (valueTag(v)) {
		case ValueTag::Nil: return "nil";
		case ValueTag::False: return "boolean";
		case ValueTag::True: return "boolean";
		case ValueTag::String: return "string";
		case ValueTag::Table: return "table";
		case ValueTag::Closure: return "closure";
		case ValueTag::BuiltinFunction: return "builtin_function";
		case ValueTag::NativeFunction: return "native_function";
		case ValueTag::NativeObject: return "native_object";
		case ValueTag::Upvalue: return "upvalue";
		default: return "unknown";
	}
}

const inline char* valueTypeNameForLua(Value v) {
	if (isNil(v)) return "nil";
	if (valueIsBool(v)) return "boolean";
	if (valueIsNumber(v)) return "number";
	if (valueIsString(v)) return "string";
	if (valueIsTable(v)) return "table";
	if (valueIsNativeObject(v)) return "native";
	return "function";
}

Table::Table(int arraySize, int hashSize) {
	if (arraySize > 0) {
		m_array.resize(static_cast<size_t>(arraySize), valueNil());
	}
	if (hashSize > 0) {
		size_t size = nextPowerOfTwo(static_cast<size_t>(hashSize));
		allocateHash(size);
		m_hashFree = static_cast<int>(size) - 1;
	}
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedHeapBytes()));
}

bool Table::getArrayIndex(const Value& key, int& outIndex) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	double n = asNumber(key);
	if (!std::isfinite(n)) {
		return false;
	}
	if (n < 1.0) {
		return false;
	}
	if (n > static_cast<double>(std::numeric_limits<int>::max())) {
		return false;
	}
	int index = static_cast<int>(n);
	if (static_cast<double>(index) != n) {
		return false;
	}
	outIndex = index - 1;
	return true;
}

bool Table::hasArrayIndex(size_t index) const {
	if (index < m_array.size()) {
		return !isNil(m_array[index]);
	}
	if (m_hashSize == 0) {
		return false;
	}
	Value key = valueNumber(static_cast<double>(index + 1));
	return findNodeIndex(key) >= 0;
}

void Table::updateArrayLengthFrom(size_t startIndex) {
	size_t newLength = startIndex;
	while (hasArrayIndex(newLength)) {
		++newLength;
	}
	m_arrayLength = newLength;
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{}(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	if (m_hashSize == 0) {
		return -1;
	}
	size_t mask = m_hashSize - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const Value nodeKey = m_hashKeys[static_cast<size_t>(index)];
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			return index;
		}
		index = m_hashNext[static_cast<size_t>(index)];
	}
	return -1;
}

int Table::getFreeIndex() {
	int start = m_hashFree >= 0 ? m_hashFree : static_cast<int>(m_hashSize) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(m_hashKeys[static_cast<size_t>(i)])) {
			m_hashFree = i - 1;
			return i;
		}
	}
	m_hashFree = -1;
	return -1;
}

void Table::rehash(const Value& key) {
	size_t totalKeys = 0;
	std::array<size_t, sizeof(size_t) * 8u> counts{};
	size_t countBins = 0;

	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			++countBins;
		}
		counts[log] += 1;
	};

	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (size_t i = 0; i < m_hashSize; ++i) {
		const Value key = m_hashKeys[i];
		if (!isNil(key)) {
			totalKeys += 1;
			int index = 0;
			if (getArrayIndex(key, index)) {
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
	resize(arraySize, hashSize);
}

void Table::resize(size_t newArraySize, size_t newHashSize) {
	const size_t previousBytes = trackedHeapBytes();
	std::vector<Value> oldArray = std::move(m_array);
	std::unique_ptr<void, HashStorageDeleter> oldHashStorage = std::move(m_hashStorage);
	Value* oldHashKeys = m_hashKeys;
	Value* oldHashValues = m_hashValues;
	const size_t oldHashSize = m_hashSize;

	m_array.assign(newArraySize, valueNil());
	m_arrayLength = 0;
	allocateHash(newHashSize);
	m_hashFree = newHashSize > 0 ? static_cast<int>(newHashSize) - 1 : -1;

	for (size_t i = 0; i < oldArray.size(); ++i) {
		if (!isNil(oldArray[i])) {
			rawSet(valueNumber(static_cast<double>(i + 1)), oldArray[i]);
		}
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value key = oldHashKeys[i];
		if (!isNil(key)) {
			rawSet(key, oldHashValues[i]);
		}
	}
	oldHashStorage.reset();
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedHeapBytes()) - static_cast<ptrdiff_t>(previousBytes));
}

void Table::allocateHash(size_t size) {
	m_hashSize = size;
	if (size == 0) {
		m_hashStorage.reset();
		m_hashKeys = nullptr;
		m_hashValues = nullptr;
		m_hashNext = nullptr;
		return;
	}
	const size_t byteCount = (size * sizeof(Value) * 2) + (size * sizeof(int32_t));
	m_hashStorage.reset(::operator new(byteCount));
	m_hashKeys = static_cast<Value*>(m_hashStorage.get());
	m_hashValues = m_hashKeys + size;
	m_hashNext = reinterpret_cast<int32_t*>(m_hashValues + size);
	std::fill(m_hashKeys, m_hashKeys + size, valueNil());
	std::fill(m_hashValues, m_hashValues + size, valueNil());
	std::fill(m_hashNext, m_hashNext + size, -1);
}

void Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		size_t idx = static_cast<size_t>(index);
		if (idx < m_array.size()) {
			m_array[idx] = value;
			if (isNil(value)) {
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
			} else if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			return;
		}
	}
	insertHash(key, value);
	if (isArrayKey && static_cast<size_t>(index) == m_arrayLength) {
		updateArrayLengthFrom(m_arrayLength);
	}
}

void Table::insertHash(const Value& key, const Value& value) {
	if (m_hashSize == 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	const size_t mainSlot = static_cast<size_t>(mainIndex);
	const Value mainKey = m_hashKeys[mainSlot];
	if (isNil(mainKey)) {
		m_hashKeys[mainSlot] = key;
		m_hashValues[mainSlot] = value;
		m_hashNext[mainSlot] = -1;
		return;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	const size_t freeSlot = static_cast<size_t>(freeIndex);
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainKey) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		m_hashKeys[freeSlot] = mainKey;
		m_hashValues[freeSlot] = m_hashValues[mainSlot];
		m_hashNext[freeSlot] = m_hashNext[mainSlot];
		int prev = mainIndexOfOccupied;
		while (m_hashNext[static_cast<size_t>(prev)] != mainIndex) {
			prev = m_hashNext[static_cast<size_t>(prev)];
		}
		m_hashNext[static_cast<size_t>(prev)] = freeIndex;
		m_hashKeys[mainSlot] = key;
		m_hashValues[mainSlot] = value;
		m_hashNext[mainSlot] = -1;
		return;
	}
	m_hashKeys[freeSlot] = key;
	m_hashValues[freeSlot] = value;
	m_hashNext[freeSlot] = m_hashNext[mainSlot];
	m_hashNext[mainSlot] = freeIndex;
}

void Table::removeFromHash(const Value& key) {
	if (m_hashSize == 0) {
		return;
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_hashKeys[slot];
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			int next = m_hashNext[slot];
			if (prev >= 0) {
				m_hashNext[static_cast<size_t>(prev)] = next;
				m_hashKeys[slot] = valueNil();
				m_hashValues[slot] = valueNil();
				m_hashNext[slot] = -1;
				if (index > m_hashFree) {
					m_hashFree = index;
				}
				return;
			}
			if (next >= 0) {
				const size_t nextSlot = static_cast<size_t>(next);
				m_hashKeys[slot] = m_hashKeys[nextSlot];
				m_hashValues[slot] = m_hashValues[nextSlot];
				m_hashNext[slot] = m_hashNext[nextSlot];
				m_hashKeys[nextSlot] = valueNil();
				m_hashValues[nextSlot] = valueNil();
				m_hashNext[nextSlot] = -1;
				if (next > m_hashFree) {
					m_hashFree = next;
				}
				return;
			}
			m_hashKeys[slot] = valueNil();
			m_hashValues[slot] = valueNil();
			m_hashNext[slot] = -1;
			if (index > m_hashFree) {
				m_hashFree = index;
			}
			return;
		}
		prev = index;
		index = m_hashNext[slot];
	}
}

Value Table::get(const Value& key) const {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	if (getArrayIndex(key, index)) {
		if (index < static_cast<int>(m_array.size())) {
			return m_array[static_cast<size_t>(index)];
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			if (idx < m_array.size()) {
				m_array[idx] = value;
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
				bumpVersion();
				return;
			}
		} else if (idx < m_array.size()) {
			m_array[idx] = value;
			if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			bumpVersion();
			return;
		}
	}

	if (isNil(value)) {
		removeFromHash(key);
		if (isArrayKey && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		bumpVersion();
		return;
	}
	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		bumpVersion();
		return;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(key);
	}
	rawSet(key, value);
	bumpVersion();
}

Value Table::getInteger(int indexValue) const {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		return m_array[static_cast<size_t>(index)];
	}
	const int nodeIndex = findNodeIndex(valueNumber(static_cast<double>(indexValue)));
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

void Table::setInteger(int indexValue, const Value& value) {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			m_array[idx] = value;
			if (idx < m_arrayLength) {
				m_arrayLength = idx;
			}
			bumpVersion();
			return;
		}
		m_array[idx] = value;
		if (idx == m_arrayLength) {
			updateArrayLengthFrom(m_arrayLength);
		}
		bumpVersion();
		return;
	}
	const Value key = valueNumber(static_cast<double>(indexValue));
	if (isNil(value)) {
		removeFromHash(key);
		if (index >= 0 && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		bumpVersion();
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		bumpVersion();
		return;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(key);
	}
	rawSet(key, value);
	bumpVersion();
}

Value Table::getStringKey(StringId key) const {
	const int nodeIndex = findNodeIndex(valueString(key));
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

void Table::setStringKey(StringId key, const Value& value) {
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		removeFromHash(keyValue);
		bumpVersion();
		return;
	}
	const int nodeIndex = findNodeIndex(keyValue);
	if (nodeIndex >= 0) {
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		bumpVersion();
		return;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(keyValue);
	}
	rawSet(keyValue, value);
	bumpVersion();
}

int Table::length() const {
	return static_cast<int>(m_arrayLength);
}

void Table::clear() {
	const size_t previousBytes = trackedHeapBytes();
	m_array.clear();
	m_arrayLength = 0;
	allocateHash(0);
	m_hashFree = -1;
	bumpVersion();
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedHeapBytes()) - static_cast<ptrdiff_t>(previousBytes));
}

std::optional<std::pair<Value, Value>> Table::nextEntry(const Value& after) const {
	if (isNil(after)) {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[i]);
			}
		}
		for (size_t i = 0; i < m_hashSize; ++i) {
			if (!isNil(m_hashKeys[i])) {
				return std::make_pair(m_hashKeys[i], m_hashValues[i]);
			}
		}
		return std::nullopt;
	}
	int index = 0;
	if (getArrayIndex(after, index)) {
		if (index < static_cast<int>(m_array.size())) {
			if (isNil(m_array[static_cast<size_t>(index)])) {
				return std::nullopt;
			}
			int startIndex = index + 1;
			for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
				if (!isNil(m_array[static_cast<size_t>(i)])) {
					return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[static_cast<size_t>(i)]);
				}
			}
			for (size_t i = 0; i < m_hashSize; ++i) {
				if (!isNil(m_hashKeys[i])) {
					return std::make_pair(m_hashKeys[i], m_hashValues[i]);
				}
			}
			return std::nullopt;
		}
	}
	int nodeIndex = findNodeIndex(after);
	if (nodeIndex < 0) {
		return std::nullopt;
	}
	for (size_t i = static_cast<size_t>(nodeIndex + 1); i < m_hashSize; ++i) {
		if (!isNil(m_hashKeys[i])) {
			return std::make_pair(m_hashKeys[i], m_hashValues[i]);
		}
	}
	return std::nullopt;
}

std::optional<std::tuple<size_t, size_t, Value, Value>> Table::nextEntryFromCursor(size_t arrayCursor, size_t hashCursor, const Value& previousHashKey) const {
	for (size_t index = arrayCursor; index < m_array.size(); ++index) {
		const Value value = m_array[index];
		if (!isNil(value)) {
			return std::make_tuple(index + 1, 0, valueNumber(static_cast<double>(index + 1)), value);
		}
	}
	const size_t hashStart = hashCursor > 0 ? hashCursor - 1 : 0;
	for (size_t index = hashStart; index < m_hashSize; ++index) {
		const Value key = m_hashKeys[index];
		if (!isNil(key)) {
			if (hashCursor > 0 && index == hashCursor - 1 && !isNil(previousHashKey) && keyEquals(key, previousHashKey)) {
				continue;
			}
			return std::make_tuple(m_array.size(), index + 1, key, m_hashValues[index]);
		}
	}
	return std::nullopt;
}

TableRuntimeState Table::captureRuntimeState() const {
	TableRuntimeState state;
	state.array = m_array;
	state.arrayLength = m_arrayLength;
	state.hash.reserve(m_hashSize);
	for (size_t index = 0; index < m_hashSize; ++index) {
		state.hash.push_back(TableHashNodeState{ m_hashKeys[index], m_hashValues[index], m_hashNext[index] });
	}
	state.hashFree = m_hashFree;
	state.metatable = metatable;
	return state;
}

void Table::restoreRuntimeState(const TableRuntimeState& state) {
	const size_t previousBytes = trackedHeapBytes();
	m_array = state.array;
	m_arrayLength = state.arrayLength;
	allocateHash(state.hash.size());
	for (size_t index = 0; index < state.hash.size(); ++index) {
		const TableHashNodeState& node = state.hash[index];
		m_hashKeys[index] = node.key;
		m_hashValues[index] = node.value;
		m_hashNext[index] = node.next;
	}
	m_hashFree = state.hashFree;
	metatable = state.metatable;
	bumpVersion();
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedHeapBytes()) - static_cast<ptrdiff_t>(previousBytes));
}

size_t Table::trackedHeapBytes() const {
	return kTableHeapBytes
		+ (m_array.size() * kTableArraySlotHeapBytes)
		+ (m_hashSize * kTableHashSlotHeapBytes);
}

void GcHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return;
	}
	switch (valueTag(v)) {
		case ValueTag::Table:
			markObject(asTable(v));
			break;
		case ValueTag::Closure:
			markClosure(asClosure(v));
			break;
		case ValueTag::BuiltinFunction:
			break;
		case ValueTag::NativeFunction:
			markObject(asNativeFunction(v));
			break;
		case ValueTag::NativeObject:
			markObject(asNativeObject(v));
			break;
		case ValueTag::Upvalue:
			markObject(asUpvalue(v));
			break;
		case ValueTag::String:
			m_stringPool.markReachable(asStringId(v));
			break;
		default:
			break;
	}
}

void GcHeap::markClosure(Closure* closure) {
	if (closure->trackedHeapBytes == 0) {
		return;
	}
	markObject(closure);
}

Closure* GcHeap::allocateClosure(size_t upvalueCount) {
	const size_t byteCount = closureAllocationBytes(upvalueCount);
	void* storage = ::operator new(byteCount);
	auto* closure = new (storage) Closure();
	closure->type = ObjType::Closure;
	closure->marked = false;
	closure->hashId = allocateHashId();
	closure->next = m_objects;
	closure->upvalueCount = upvalueCount;
	closure->upvalues = reinterpret_cast<Upvalue**>(static_cast<uint8_t*>(storage) + sizeof(Closure));
	for (size_t index = 0; index < upvalueCount; ++index) {
		closure->upvalues[index] = nullptr;
	}
	m_objects = closure;
	m_bytesAllocated += byteCount;
	if (m_bytesAllocated > m_nextGC) {
		m_collectRequested = true;
	}
	return closure;
}

void GcHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
}

void GcHeap::trace() {
	while (!m_grayStack.empty()) {
		GCObject* obj = m_grayStack.back();
		m_grayStack.pop_back();
		switch (obj->type) {
			case ObjType::Table: {
				auto* table = static_cast<Table*>(obj);
				if (table->metatable) {
					markObject(table->metatable);
				}
				table->forEachEntry([this](Value key, Value value) {
					markValue(key);
					markValue(value);
				});
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				for (size_t index = 0; index < closure->upvalueCount; ++index) {
					markObject(closure->upvalues[index]);
				}
				break;
			}
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject: {
				auto* native = static_cast<NativeObject*>(obj);
				if (native->metatable) {
					markObject(native->metatable);
				}
				break;
			}
			case ObjType::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(obj);
				if (!upvalue->open) {
					markValue(upvalue->value);
				}
				break;
			}
		}
	}
}

void GcHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* obj = *current;
		if (obj->marked) {
			obj->marked = false;
			current = &obj->next;
			continue;
		}
		GCObject* next = obj->next;
		switch (obj->type) {
			case ObjType::Table:
				m_bytesAllocated -= sizeof(Table);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(static_cast<Table*>(obj)->trackedHeapBytes()));
				delete static_cast<Table*>(obj);
				break;
			case ObjType::Closure:
				m_bytesAllocated -= closureAllocationBytes(static_cast<Closure*>(obj)->upvalueCount);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(trackedClosureBytes(*static_cast<Closure*>(obj))));
				static_cast<Closure*>(obj)->~Closure();
				::operator delete(obj);
				break;
			case ObjType::NativeFunction:
				m_bytesAllocated -= sizeof(NativeFunction);
				addTrackedLuaHeapBytes(-kNativeFunctionHeapBytes);
				delete static_cast<NativeFunction*>(obj);
				break;
			case ObjType::NativeObject:
				m_bytesAllocated -= sizeof(NativeObject);
				addTrackedLuaHeapBytes(-kNativeObjectHeapBytes);
				delete static_cast<NativeObject*>(obj);
				break;
			case ObjType::Upvalue:
				m_bytesAllocated -= sizeof(Upvalue);
				addTrackedLuaHeapBytes(-kUpvalueHeapBytes);
				delete static_cast<Upvalue*>(obj);
				break;
		}
		*current = next;
	}
}

void GcHeap::collect() {
	if (m_collectionSuspendDepth > 0) {
		m_collectRequested = true;
		return;
	}
	if (!m_collectRequested) {
		return;
	}
	m_collectRequested = false;
	m_stringPool.beginReachabilityEpoch();
	if (m_rootMarker) {
		m_rootMarker(*this);
	}
	trace();
	sweep();
	m_stringPool.reclaimUnreachableTracked();
	m_nextGC = m_bytesAllocated * 2;
}

NativeResultsScratchScope::NativeResultsScratchScope(CPU& cpu, NativeResults& out) noexcept
	: m_cpu(&cpu)
	, m_out(&out) {
}

NativeResultsScratchScope::NativeResultsScratchScope(NativeResultsScratchScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_out(other.m_out) {
	other.m_cpu = nullptr;
	other.m_out = nullptr;
}

NativeResultsScratchScope::~NativeResultsScratchScope() {
	if (m_cpu) {
		m_cpu->releaseNativeReturnScratch(*m_out);
	}
}

CPU::NativeLocalRootsScope::NativeLocalRootsScope(CPU& cpu) noexcept
	: m_cpu(&cpu)
	, m_base(cpu.m_nativeLocalRoots.size()) {
	cpu.m_nativeLocalRootScopeDepth += 1;
}

CPU::NativeLocalRootsScope::NativeLocalRootsScope(NativeLocalRootsScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_base(other.m_base) {
	other.m_cpu = nullptr;
	other.m_base = 0;
}

CPU::NativeLocalRootsScope::~NativeLocalRootsScope() {
	if (m_cpu) {
		m_cpu->releaseNativeLocalRoots(m_base);
	}
}

CPU::CPU(Memory& memory)
	: m_memory(memory)
	, m_stringPool(true)
	, m_heap(m_stringPool) {
	for (size_t index = 0; index < m_builtinFunctions.size(); ++index) {
		BuiltinFunction& builtin = m_builtinFunctions[index];
		const NativeFnCost cost = kBuiltinFunctionCosts[index];
		builtin.id = static_cast<BuiltinFunctionId>(index);
		builtin.cycleBase = cost.base;
		builtin.cyclePerArg = cost.perArg;
		builtin.cyclePerRet = cost.perRet;
	}
	m_heap.setRootMarker([this](GcHeap& heap) { markRoots(heap); });
	m_externalRootMarker = [](GcHeap&) {};
	globals = m_heap.allocate<Table>(ObjType::Table, 0, 0);
	m_stringIndexTable = createTable();
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value CPU::createBuiltinFunction(BuiltinFunctionId id) {
	return valueBuiltinFunction(&m_builtinFunctions[static_cast<size_t>(id)]);
}

Value CPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const NativeFnCost resolvedCost = cost ? *cost : kDefaultNativeCost;
	auto* native = m_heap.allocate<NativeFunction>(ObjType::NativeFunction);
	addTrackedLuaHeapBytes(kNativeFunctionHeapBytes);
	native->name = std::string(name);
	native->cycleBase = resolvedCost.base;
	native->cyclePerArg = resolvedCost.perArg;
	native->cyclePerRet = resolvedCost.perRet;
	native->invoke = [this, invoke = std::move(fn)](NativeArgsView args, NativeResults& out) {
		auto localRoots = acquireNativeLocalRoots();
		out.clear();
		invoke(args, out);
	};
	const Value value = valueNativeFunction(native);
	trackNativeLocalRoot(value);
	return value;
}

Value CPU::createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry
) {
	auto* native = m_heap.allocate<NativeObject>(ObjType::NativeObject);
	addTrackedLuaHeapBytes(kNativeObjectHeapBytes);
	native->raw = raw;
	native->get = std::move(get);
	native->set = std::move(set);
	native->len = std::move(len);
	native->nextEntry = std::move(nextEntry);
	const Value value = valueNativeObject(native);
	trackNativeLocalRoot(value);
	return value;
}

Table* CPU::createTable(int arraySize, int hashSize) {
	Table* table = m_heap.allocate<Table>(ObjType::Table, arraySize, hashSize);
	trackNativeLocalRoot(valueTable(table));
	return table;
}

void CPU::materializeStaticClosures() {
	const size_t protoCount = m_program->protos.size();
	const size_t existingCount = m_staticClosures.size();
	m_staticClosures.resize(protoCount);
	for (size_t index = 0; index < protoCount; ++index) {
		Closure& closure = m_staticClosures[index];
		closure.type = ObjType::Closure;
		closure.marked = false;
		if (index >= existingCount) {
			closure.hashId = m_heap.allocateHashId();
		}
		closure.next = nullptr;
		closure.protoIndex = static_cast<int>(index);
		closure.upvalueCount = 0;
		closure.upvalues = nullptr;
		closure.trackedHeapBytes = 0;
	}
}

Closure* CPU::createTrackedClosure(int protoIndex, size_t upvalueCount) {
	auto* closure = m_heap.allocateClosure(upvalueCount);
	closure->protoIndex = protoIndex;
	closure->trackedHeapBytes = kClosureHeapBytes + (upvalueCount * kClosureUpvalueSlotHeapBytes);
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedClosureBytes(*closure)));
	return closure;
}

void CPU::setProgram(Program* program, const ProgramRuntimeSymbols& runtimeSymbols, ProgramMetadata* metadata) {
	// Keep slot-backed globals materialized in the globals table before swapping programs.
	// SETGL/SETSYS write into the slot arrays directly, and append/reload paths rebuild the next
	// slot layout from `globals`, so without this sync flattened module exports can fall back to nil.
	syncGlobalSlotsToTable();
	m_program = program;
	m_hardHalted = false;
	if (m_program) {
		m_memory.setProgramRom(m_program->programRom.data(), m_program->programRom.size(), m_program->programRomTextByteLength);
	} else {
		m_memory.setProgramRom(nullptr, 0, 0);
	}
	m_metadata = metadata;
	if (!m_program) {
		m_staticClosures.clear();
		clearGlobalSlots();
		m_decodedPages.clear();
		m_decodedWordCount = 0;
		m_tableLoadCaches.clear();
		return;
	}
	if (!m_program->constPoolCanonicalized) {
		const StringPool& programPool = *m_program->constPoolStringPool;
		auto& constPool = m_program->constPool;
		for (size_t index = 0; index < constPool.size(); ++index) {
			Value value = constPool[index];
			if (valueIsString(value)) {
				StringId oldId = asStringId(value);
				StringId newId = m_stringPool.intern(programPool.toString(oldId), false);
				constPool[index] = valueString(newId);
			}
		}
		m_program->constPoolCanonicalized = true;
		m_program->constPoolStringPool = &m_stringPool;
	} else if (m_program->constPoolStringPool != &m_stringPool) {
		throw BMSX_RUNTIME_ERROR("[CPU] Program const pool is canonicalized for a different string pool.");
	}
	m_indexKey = valueString(m_stringPool.intern("__index"));
	materializeStaticClosures();
	initializeGlobalSlots(runtimeSymbols);
	decodeProgram();
}

void CPU::initializeGlobalSlots(const ProgramRuntimeSymbols& runtimeSymbols) {
	clearGlobalSlots();
	initializeGlobalSlotList(m_systemGlobalNames, m_systemGlobalValues, m_systemGlobalSlotByKey, runtimeSymbols.systemGlobalNames);
	initializeGlobalSlotList(m_globalNames, m_globalValues, m_globalSlotByKey, runtimeSymbols.globalNames);
}

void CPU::initializeGlobalSlotList(std::vector<StringId>& names, std::vector<Value>& values, std::unordered_map<StringId, size_t>& slotByKey, const std::vector<std::string>& source) {
	names.resize(source.size());
	values.resize(source.size());
	slotByKey.clear();
	for (size_t index = 0; index < source.size(); ++index) {
		const StringId key = m_stringPool.intern(source[index], false);
		names[index] = key;
		slotByKey.emplace(key, index);
		values[index] = globals->get(valueString(key));
	}
}

void CPU::clearGlobalSlots() {
	m_systemGlobalNames.clear();
	m_systemGlobalValues.clear();
	m_systemGlobalSlotByKey.clear();
	m_globalNames.clear();
	m_globalValues.clear();
	m_globalSlotByKey.clear();
}

void CPU::setGlobalByKey(const Value& key, const Value& value) {
	globals->set(key, value);
	const StringId keyId = asStringId(key);
	const auto systemIt = m_systemGlobalSlotByKey.find(keyId);
	if (systemIt != m_systemGlobalSlotByKey.end()) {
		m_systemGlobalValues[systemIt->second] = value;
		return;
	}
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		m_globalValues[globalIt->second] = value;
	}
}

Value CPU::getGlobalByKey(const Value& key) const {
	const StringId keyId = asStringId(key);
	const auto systemIt = m_systemGlobalSlotByKey.find(keyId);
	if (systemIt != m_systemGlobalSlotByKey.end()) {
		return m_systemGlobalValues[systemIt->second];
	}
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		return m_globalValues[globalIt->second];
	}
	return globals->get(key);
}

void CPU::syncGlobalSlotsToTable() {
	for (size_t index = 0; index < m_systemGlobalNames.size(); ++index) {
		globals->set(valueString(m_systemGlobalNames[index]), m_systemGlobalValues[index]);
	}
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		globals->set(valueString(m_globalNames[index]), m_globalValues[index]);
	}
}


void CPU::decodeProgram() {
	m_decodedPages.clear();
	m_tableLoadCaches.clear();
	if (!m_program) {
		m_decodedWordCount = 0;
		return;
	}
	std::span<const uint8_t> code = m_program->code();
	m_decodedWordCount = code.size() / INSTRUCTION_BYTES;
	const size_t pageCount = (m_decodedWordCount + DECODED_PAGE_WORDS - 1u) >> DECODED_PAGE_SHIFT;
	m_decodedPages.resize(pageCount);
	for (DecodedInstructionPage& page : m_decodedPages) {
		for (DecodedInstruction& decoded : page.words) {
			decoded.op = static_cast<uint8_t>(OpCode::RESERVED0);
			decoded.width = 1;
		}
	}
	for (size_t wordIndex = 0; wordIndex < m_decodedWordCount;) {
		int width = 1;
		uint8_t wideA = 0;
		uint8_t wideB = 0;
		uint8_t wideC = 0;
		uint32_t instr = readInstructionWord(code, static_cast<int>(wordIndex));
		uint8_t op = static_cast<uint8_t>((instr >> 18) & 0x3f);
		uint8_t ext = static_cast<uint8_t>(instr >> 24);
		if (static_cast<OpCode>(op) == OpCode::WIDE && wordIndex + 1u < m_decodedWordCount) {
			width = 2;
			wideA = static_cast<uint8_t>((instr >> 12) & 0x3f);
			wideB = static_cast<uint8_t>((instr >> 6) & 0x3f);
			wideC = static_cast<uint8_t>(instr & 0x3f);
			instr = readInstructionWord(code, static_cast<int>(wordIndex + 1));
			op = static_cast<uint8_t>((instr >> 18) & 0x3f);
			ext = static_cast<uint8_t>(instr >> 24);
		}
		const uint8_t aLow = static_cast<uint8_t>((instr >> 12) & 0x3f);
		const uint8_t bLow = static_cast<uint8_t>((instr >> 6) & 0x3f);
		const uint8_t cLow = static_cast<uint8_t>(instr & 0x3f);
		const bool usesDisp = OPCODE_USES_DISP[op] != 0u;
		const bool usesBx = !usesDisp && OPCODE_USES_BX[op] != 0u;
		const uint8_t extA = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>((ext >> 6) & 0x3);
		const uint8_t extB = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>((ext >> 3) & 0x7);
		const uint8_t extC = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>(ext & 0x7);
		const int aShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const int bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
		const int cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
		const uint32_t bxLow = (static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | static_cast<uint32_t>(cLow);
		const uint32_t rkRawB = (static_cast<uint32_t>(wideB) << bShift)
			| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
			| static_cast<uint32_t>(bLow);
		const uint32_t rkRawC = (static_cast<uint32_t>(wideC) << cShift)
			| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
			| static_cast<uint32_t>(cLow);
		DecodedInstruction decoded;
		decoded.word = instr;
		decoded.op = op;
		decoded.width = static_cast<uint8_t>(width);
		decoded.a = static_cast<uint16_t>((static_cast<int>(wideA) << aShift) | (static_cast<int>(extA) << MAX_OPERAND_BITS) | aLow);
		decoded.b = static_cast<uint16_t>((static_cast<int>(wideB) << bShift) | (static_cast<int>(extB) << MAX_OPERAND_BITS) | bLow);
		decoded.c = static_cast<uint16_t>((static_cast<int>(wideC) << cShift) | (static_cast<int>(extC) << MAX_OPERAND_BITS) | cLow);
		decoded.bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
			| bxLow;
		decoded.sbx = signExtend(decoded.bx, MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.rkB = signExtend(rkRawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.rkC = signExtend(rkRawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.disp = ext;
		if (static_cast<OpCode>(op) == OpCode::GETI
			|| static_cast<OpCode>(op) == OpCode::GETFIELD
			|| static_cast<OpCode>(op) == OpCode::SELF) {
			decoded.tableCacheIndex = static_cast<uint32_t>(m_tableLoadCaches.size());
			m_tableLoadCaches.push_back(TableLoadInlineCache{});
		}
		decodedSlotForWrite(wordIndex) = decoded;
		wordIndex += static_cast<size_t>(width);
	}
}

DecodedInstruction& CPU::decodedSlotForWrite(size_t wordIndex) {
	return m_decodedPages[wordIndex >> DECODED_PAGE_SHIFT].words[wordIndex & DECODED_PAGE_MASK];
}

const DecodedInstruction& CPU::decodedAtWordIndex(int wordIndex) const {
	return m_decodedPages[static_cast<size_t>(wordIndex) >> DECODED_PAGE_SHIFT].words[static_cast<size_t>(wordIndex) & DECODED_PAGE_MASK];
}

void CPU::skipNextInstruction(CallFrame& frame) {
	const int wordIndex = frame.pc / INSTRUCTION_BYTES;
	if (static_cast<uint32_t>(wordIndex) >= m_decodedWordCount) {
		hardHalt();
		return;
	}
	const DecodedInstruction& decoded = decodedAtWordIndex(wordIndex);
	frame.pc += static_cast<int>(decoded.width) * INSTRUCTION_BYTES;
}

void CPU::start(int entryProtoIndex, NativeArgsView args) {
	lastReturnValues.clear();
	clearCallStack();
	m_haltedUntilIrq = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0;
	m_hardHalted = false;
	m_maskableInterruptsEnabled = true;
	m_maskableInterruptsRestoreEnabled = true;
	m_nonMaskableInterruptPending = false;
	m_yieldRequested = false;
	m_hostExternalCallDepth = 0;
	Closure* closure = &rootClosure(entryProtoIndex);
	pushFrame(closure, args.data(), args.size(), 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
	runHousekeeping();
}

void CPU::call(Closure& closure, NativeArgsView args, int returnCount) {
	lastReturnValues.clear();
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, returnCount, false, m_program->protos[closure.protoIndex].entryPC);
}

void CPU::callExternal(Closure& closure, NativeArgsView args) {
	lastReturnValues.clear();
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, 0, true, m_program->protos[closure.protoIndex].entryPC);
}

NativeResults* CPU::swapExternalReturnSink(NativeResults* sink) {
	NativeResults* previous = m_externalReturnSink;
	m_externalReturnSink = sink;
	return previous;
}

CpuRuntimeState CPU::captureRuntimeState(const std::unordered_map<std::string, Value>& moduleCache) const {
	const_cast<CPU&>(*this).syncGlobalSlotsToTable();
	std::unordered_map<const void*, int> objectIds;
	std::vector<CpuObjectState> objects;
	std::function<CpuObjectState(GCObject*)> captureObjectState;
	std::function<int(GCObject*)> ensureObjectId;
	std::function<CpuValueState(Value)> captureValueState;

	ensureObjectId = [&](GCObject* object) -> int {
		const void* key = static_cast<const void*>(object);
		const auto it = objectIds.find(key);
		if (it != objectIds.end()) {
			return it->second;
		}
		const int id = static_cast<int>(objects.size());
		objectIds.emplace(key, id);
		objects.emplace_back();
		objects[static_cast<size_t>(id)] = captureObjectState(object);
		return id;
	};

	captureValueState = [&](Value value) -> CpuValueState {
		CpuValueState state;
		if (isNil(value)) {
			return state;
		}
		if (value == valueBool(false)) {
			state.tag = CpuValueStateTag::False;
			return state;
		}
		if (value == valueBool(true)) {
			state.tag = CpuValueStateTag::True;
			return state;
		}
		if (valueIsNumber(value)) {
			state.tag = CpuValueStateTag::Number;
			state.numberValue = asNumber(value);
			return state;
		}
		if (valueIsString(value)) {
			state.tag = CpuValueStateTag::String;
			state.stringId = asStringId(value);
			return state;
		}
		if (valueIsBuiltinFunction(value)) {
			state.tag = CpuValueStateTag::Builtin;
			state.builtinId = asBuiltinFunction(value)->id;
			return state;
		}
		state.tag = CpuValueStateTag::Ref;
		if (valueIsTable(value)) {
			state.refId = ensureObjectId(asTable(value));
			return state;
		}
		if (valueIsClosure(value)) {
			state.refId = ensureObjectId(asClosure(value));
			return state;
		}
		if (valueTag(value) == ValueTag::Upvalue) {
			state.refId = ensureObjectId(asUpvalue(value));
			return state;
		}
		throw BMSX_RUNTIME_ERROR("[CPU] Runtime snapshot cannot preserve " + std::string(valueTypeName(value)) + " value.");
	};

	captureObjectState = [&](GCObject* object) -> CpuObjectState {
		CpuObjectState state;
		state.hashId = object->hashId;
		switch (object->type) {
			case ObjType::Table: {
				state.kind = CpuObjectState::Kind::Table;
				const TableRuntimeState tableState = static_cast<Table*>(object)->captureRuntimeState();
				state.arrayLength = tableState.arrayLength;
				state.metatable = captureValueState(tableState.metatable ? valueTable(tableState.metatable) : valueNil());
				state.array.reserve(tableState.array.size());
				for (const Value& value : tableState.array) {
					state.array.push_back(captureValueState(value));
				}
				state.hash.reserve(tableState.hash.size());
				for (const TableHashNodeState& node : tableState.hash) {
					state.hash.push_back(CpuTableHashNodeSnapshot{
						captureValueState(node.key),
						captureValueState(node.value),
						node.next,
					});
				}
				state.hashFree = tableState.hashFree;
				return state;
			}
			case ObjType::Closure: {
				state.kind = CpuObjectState::Kind::Closure;
				Closure* closure = static_cast<Closure*>(object);
				state.protoIndex = closure->protoIndex;
				state.upvalues.reserve(closure->upvalueCount);
				for (size_t upvalueIndex = 0; upvalueIndex < closure->upvalueCount; ++upvalueIndex) {
					state.upvalues.push_back(ensureObjectId(closure->upvalues[upvalueIndex]));
				}
				return state;
			}
			case ObjType::Upvalue: {
				state.kind = CpuObjectState::Kind::Upvalue;
				Upvalue* upvalue = static_cast<Upvalue*>(object);
				state.upvalueOpen = upvalue->open;
				state.upvalueIndex = upvalue->index;
				if (upvalue->open) {
					int frameIndex = 0;
					while (m_frames[static_cast<size_t>(frameIndex)].get() != upvalue->frame) {
						frameIndex += 1;
					}
					state.frameIndex = frameIndex;
					state.upvalueValue = captureValueState(upvalue->frame->registers[static_cast<size_t>(upvalue->index)]);
				} else {
					state.frameIndex = -1;
					state.upvalueValue = captureValueState(upvalue->value);
				}
				return state;
			}
			default:
				throw std::runtime_error("[CPU] Unsupported runtime snapshot object.");
		}
	};

	CpuRuntimeState state;
	globals->forEachEntry([&](Value key, Value value) {
		if (!valueIsString(key)) {
			return;
		}
		if (valueIsNativeFunction(value) || valueIsNativeObject(value)) {
			return;
		}
		state.globals.push_back(CpuRootValueState{
			m_stringPool.toString(asStringId(key)),
			captureValueState(value),
		});
	});
	for (const auto& [name, value] : moduleCache) {
		if (valueIsNativeFunction(value) || valueIsNativeObject(value)) {
			continue;
		}
		state.moduleCache.push_back(CpuRootValueState{ name, captureValueState(value) });
	}
	state.frames.reserve(m_frames.size());
	for (const auto& framePtr : m_frames) {
		const CallFrame& frame = *framePtr;
		CpuFrameState frameState;
		frameState.protoIndex = frame.protoIndex;
		frameState.pc = frame.pc;
		frameState.closureRef = ensureObjectId(frame.closure);
		frameState.returnBase = frame.returnBase;
		frameState.returnCount = frame.returnCount;
		frameState.top = frame.top;
		frameState.captureReturns = frame.captureReturns;
		frameState.callSitePc = frame.callSitePc;
		frameState.isInterruptFrame = frame.isInterruptFrame;
		frameState.savedMaskableEnabled = frame.savedMaskableEnabled;
		frameState.registers.reserve(static_cast<size_t>(frame.top));
		for (int index = 0; index < frame.top; ++index) {
			frameState.registers.push_back(captureValueState(frame.registers[static_cast<size_t>(index)]));
		}
		frameState.varargs.reserve(static_cast<size_t>(frame.varargCount));
		for (int index = 0; index < frame.varargCount; ++index) {
			frameState.varargs.push_back(captureValueState(m_stack[static_cast<size_t>(frame.varargBase + index)]));
		}
		state.frames.push_back(std::move(frameState));
	}
	state.lastReturnValues.reserve(lastReturnValues.size());
	for (const Value& value : lastReturnValues) {
		state.lastReturnValues.push_back(captureValueState(value));
	}
	state.openUpvalues.reserve(m_openUpvalues.size());
	for (const OpenUpvalueSlot& entry : m_openUpvalues) {
		state.openUpvalues.push_back(ensureObjectId(entry.upvalue));
	}
	state.objects = std::move(objects);
	state.lastPc = lastPc;
	state.lastInstruction = lastInstruction;
	state.instructionBudgetRemaining = instructionBudgetRemaining;
	state.haltedUntilIrq = m_haltedUntilIrq;
	state.memoryWriteBlocked = m_memoryWriteBlocked;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.maskableInterruptsEnabled = m_maskableInterruptsEnabled;
	state.maskableInterruptsRestoreEnabled = m_maskableInterruptsRestoreEnabled;
	state.nonMaskableInterruptPending = m_nonMaskableInterruptPending;
	state.yieldRequested = m_yieldRequested;
	return state;
}

void CPU::restoreRuntimeState(const CpuRuntimeState& state, std::unordered_map<std::string, Value>& moduleCache) {
	struct RestoredObject {
		Table* table = nullptr;
		Closure* closure = nullptr;
		Upvalue* upvalue = nullptr;
	};

	std::vector<RestoredObject> restoredObjects(state.objects.size());
	for (size_t index = 0; index < state.objects.size(); ++index) {
		const CpuObjectState& objectState = state.objects[index];
		switch (objectState.kind) {
			case CpuObjectState::Kind::Table:
				restoredObjects[index].table = createTable(0, 0);
				restoredObjects[index].table->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			case CpuObjectState::Kind::Closure: {
				const size_t upvalueCount = objectState.upvalues.size();
				restoredObjects[index].closure = m_program->protos[static_cast<size_t>(objectState.protoIndex)].staticClosure && objectState.upvalues.empty()
					? &rootClosure(objectState.protoIndex)
					: createTrackedClosure(objectState.protoIndex, upvalueCount);
				restoredObjects[index].closure->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			}
			case CpuObjectState::Kind::Upvalue: {
				auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				upvalue->open = false;
				upvalue->index = objectState.upvalueIndex;
				upvalue->frame = nullptr;
				upvalue->value = valueNil();
				upvalue->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				addTrackedLuaHeapBytes(kUpvalueHeapBytes);
				restoredObjects[index].upvalue = upvalue;
				break;
			}
		}
	}

	std::function<Value(const CpuValueState&)> restoreValue = [&](const CpuValueState& valueState) -> Value {
		switch (valueState.tag) {
			case CpuValueStateTag::Nil:
				return valueNil();
			case CpuValueStateTag::False:
				return valueBool(false);
			case CpuValueStateTag::True:
				return valueBool(true);
			case CpuValueStateTag::Number:
				return valueNumber(valueState.numberValue);
			case CpuValueStateTag::String:
				return valueString(valueState.stringId);
			case CpuValueStateTag::Builtin:
				return createBuiltinFunction(valueState.builtinId);
			case CpuValueStateTag::Ref: {
				const size_t refId = static_cast<size_t>(valueState.refId);
				const RestoredObject& restored = restoredObjects[refId];
				switch (state.objects[refId].kind) {
					case CpuObjectState::Kind::Table:
						return valueTable(restored.table);
					case CpuObjectState::Kind::Closure:
						return valueClosure(restored.closure);
					case CpuObjectState::Kind::Upvalue:
						return valueUpvalue(restored.upvalue);
				}
				__builtin_unreachable();
			}
		}
		__builtin_unreachable();
	};

	for (size_t index = 0; index < state.objects.size(); ++index) {
		const CpuObjectState& objectState = state.objects[index];
		switch (objectState.kind) {
			case CpuObjectState::Kind::Table: {
				TableRuntimeState tableState;
				tableState.array.reserve(objectState.array.size());
				for (const CpuValueState& valueState : objectState.array) {
					tableState.array.push_back(restoreValue(valueState));
				}
				tableState.arrayLength = objectState.arrayLength;
				tableState.hash.reserve(objectState.hash.size());
				for (const CpuTableHashNodeSnapshot& node : objectState.hash) {
					tableState.hash.push_back(TableHashNodeState{
						restoreValue(node.key),
						restoreValue(node.value),
						node.next,
					});
				}
				tableState.hashFree = objectState.hashFree;
				const Value metatable = restoreValue(objectState.metatable);
				if (!isNil(metatable)) {
					tableState.metatable = asTable(metatable);
				}
				restoredObjects[index].table->restoreRuntimeState(tableState);
				break;
			}
			case CpuObjectState::Kind::Closure: {
				Closure* closure = restoredObjects[index].closure;
				closure->protoIndex = objectState.protoIndex;
				for (size_t upvalueIndex = 0; upvalueIndex < objectState.upvalues.size(); ++upvalueIndex) {
					closure->upvalues[upvalueIndex] = restoredObjects[static_cast<size_t>(objectState.upvalues[upvalueIndex])].upvalue;
				}
				break;
			}
			case CpuObjectState::Kind::Upvalue: {
				Upvalue* upvalue = restoredObjects[index].upvalue;
				upvalue->open = objectState.upvalueOpen;
				upvalue->index = objectState.upvalueIndex;
				upvalue->frame = nullptr;
				upvalue->value = objectState.upvalueOpen ? valueNil() : restoreValue(objectState.upvalueValue);
				break;
			}
		}
	}

	lastReturnValues.clear();
	clearCallStack();
	m_externalReturnSink = nullptr;
	globals->clear();
	for (Value& value : m_systemGlobalValues) {
		value = valueNil();
	}
	for (Value& value : m_globalValues) {
		value = valueNil();
	}
	moduleCache.clear();

	for (const CpuFrameState& frameState : state.frames) {
		const Proto& proto = m_program->protos[frameState.protoIndex];
		auto frame = acquireFrame();
		frame->protoIndex = frameState.protoIndex;
		frame->pc = frameState.pc;
		frame->closure = restoredObjects[static_cast<size_t>(frameState.closureRef)].closure;
		frame->returnBase = frameState.returnBase;
		frame->returnCount = frameState.returnCount;
		frame->captureReturns = frameState.captureReturns;
		frame->callSitePc = frameState.callSitePc;
		frame->isInterruptFrame = frameState.isInterruptFrame;
		frame->savedMaskableEnabled = frameState.savedMaskableEnabled;
		frame->varargBase = m_stackTop;
		frame->varargCount = static_cast<int>(frameState.varargs.size());
		frame->stackBase = frame->varargBase + frame->varargCount;
		size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(proto.maxStack, 1)));
		if (targetCapacity < 8) {
			targetCapacity = 8;
		}
		frame->stackCapacity = static_cast<int>(targetCapacity);
		m_stackTop = frame->stackBase + frame->stackCapacity;
		ensureStackSize(static_cast<size_t>(m_stackTop));
		frame->registers = m_stack.data() + frame->stackBase;
		for (int slot = 0; slot < frame->stackCapacity; ++slot) {
			frame->registers[static_cast<size_t>(slot)] = valueNil();
		}
		for (size_t registerIndex = 0; registerIndex < frameState.registers.size(); ++registerIndex) {
			frame->registers[registerIndex] = restoreValue(frameState.registers[registerIndex]);
		}
		for (size_t varargIndex = 0; varargIndex < frameState.varargs.size(); ++varargIndex) {
			m_stack[static_cast<size_t>(frame->varargBase) + varargIndex] = restoreValue(frameState.varargs[varargIndex]);
		}
		frame->top = frameState.top;
		m_frames.push_back(std::move(frame));
	}

	for (int upvalueRef : state.openUpvalues) {
		const CpuObjectState& objectState = state.objects[static_cast<size_t>(upvalueRef)];
		Upvalue* upvalue = restoredObjects[static_cast<size_t>(upvalueRef)].upvalue;
		CallFrame* frame = m_frames[static_cast<size_t>(objectState.frameIndex)].get();
		upvalue->open = true;
		upvalue->index = objectState.upvalueIndex;
		upvalue->frame = frame;
		upvalue->value = valueNil();
		m_openUpvalues.push_back(OpenUpvalueSlot{ frame, upvalue->index, upvalue });
	}

	for (const CpuRootValueState& entry : state.globals) {
		setGlobalByKey(valueString(m_stringPool.intern(entry.name)), restoreValue(entry.value));
	}
	for (const CpuRootValueState& entry : state.moduleCache) {
		moduleCache[entry.name] = restoreValue(entry.value);
	}
	lastReturnValues.reserve(state.lastReturnValues.size());
	for (const CpuValueState& valueState : state.lastReturnValues) {
		lastReturnValues.push_back(restoreValue(valueState));
	}
	lastPc = state.lastPc;
	lastInstruction = state.lastInstruction;
	instructionBudgetRemaining = state.instructionBudgetRemaining;
	m_haltedUntilIrq = state.haltedUntilIrq;
	m_memoryWriteBlocked = state.memoryWriteBlocked;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_maskableInterruptsEnabled = state.maskableInterruptsEnabled;
	m_maskableInterruptsRestoreEnabled = state.maskableInterruptsRestoreEnabled;
	m_nonMaskableInterruptPending = state.nonMaskableInterruptPending;
	m_yieldRequested = state.yieldRequested;
	collectHeap();
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::haltUntilIrq() {
	m_haltedUntilIrq = true;
	m_yieldRequested = false;
}

void CPU::hardHalt() {
	m_hardHalted = true;
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}


void CPU::callBuiltinFunction(BuiltinFunction& fn, NativeArgsView args, NativeResults& out) {
	out.clear();
	switch (fn.id) {
		case BuiltinFunctionId::Next:
			runBuiltinNextValue(args[0], args[1], out);
			break;
		case BuiltinFunctionId::Type:
			out.push_back(valueString(m_stringPool.intern(valueTypeNameForLua(args[0]))));
			break;
		case BuiltinFunctionId::SetMetatable:
			runBuiltinSetMetatable(args, out);
			break;
		case BuiltinFunctionId::GetMetatable:
			runBuiltinGetMetatable(args, out);
			break;
		case BuiltinFunctionId::RawGet:
			runBuiltinRawGet(args, out);
			break;
		case BuiltinFunctionId::RawSet:
			runBuiltinRawSet(args, out);
			break;
		case BuiltinFunctionId::Select:
			runBuiltinSelect(args, out);
			break;
		case BuiltinFunctionId::StringByte:
			runBuiltinStringByte(args, out);
			break;
		case BuiltinFunctionId::StringChar:
			runBuiltinStringChar(args, out);
			break;
		case BuiltinFunctionId::Error:
			runBuiltinError(args);
			break;
		case BuiltinFunctionId::PCall:
			runBuiltinPCall(args, out);
			break;
		case BuiltinFunctionId::XPCall:
			runBuiltinXPCall(args, out);
			break;
	}
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, int callBase, int returnCount, int argCount) {
	instructionBudgetRemaining -= static_cast<int>(fn.cycleBase);
	auto outScratch = acquireNativeReturnScratch();
	NativeResults& out = outScratch.get();
	const NativeArgsView args(frame.registers + static_cast<size_t>(callBase + 1), static_cast<size_t>(argCount));
	callBuiltinFunction(fn, args, out);
	if (!m_frames.empty() && m_frames.back().get() == &frame) {
		writeReturnValues(frame, callBase, returnCount, out.data(), static_cast<int>(out.size()));
	}
}

void CPU::runBuiltinNextValue(Value target, Value key, NativeResults& out) {
	out.clear();
	if (valueIsTable(target)) {
		auto entry = asTable(target)->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	auto* obj = asNativeObject(target);
	auto entry = obj->nextEntry(key);
	if (!entry.has_value()) {
		out.push_back(valueNil());
		return;
	}
	out.push_back(entry->first);
	out.push_back(entry->second);
}

void CPU::runBuiltinSetMetatable(NativeArgsView args, NativeResults& out) {
	Table* metatable = asTable(args[1]);
	const Value target = args[0];
	if (valueIsTable(target)) {
		Table* table = asTable(target);
		table->metatable = metatable;
		table->bumpVersion();
		out.push_back(target);
		return;
	}
	asNativeObject(target)->metatable = metatable;
	out.push_back(target);
}

void CPU::runBuiltinGetMetatable(NativeArgsView args, NativeResults& out) {
	const Value target = args[0];
	if (valueIsTable(target)) {
		Table* metatable = asTable(target)->metatable;
		out.push_back(metatable ? valueTable(metatable) : valueNil());
		return;
	}
	Table* metatable = asNativeObject(target)->metatable;
	out.push_back(metatable ? valueTable(metatable) : valueNil());
}

void CPU::runBuiltinRawGet(NativeArgsView args, NativeResults& out) {
	Table* table = asTable(args[0]);
	out.push_back(table->get(args[1]));
}

void CPU::runBuiltinRawSet(NativeArgsView args, NativeResults& out) {
	Table* table = asTable(args[0]);
	table->set(args[1], args[2]);
	out.push_back(valueTable(table));
}

void CPU::runBuiltinSelect(NativeArgsView args, NativeResults& out) {
	const Value selector = args[0];
	if (valueIsString(selector) && m_stringPool.toString(asStringId(selector)) == "#") {
		out.push_back(valueNumber(static_cast<double>(args.size() - 1)));
		return;
	}
	const int count = static_cast<int>(args.size()) - 1;
	int start = static_cast<int>(asNumber(selector));
	if (start < 0) {
		start = count + start + 1;
	}
	for (int index = start; index <= count; ++index) {
		if (index >= 1 && static_cast<size_t>(index) < args.size()) {
			out.push_back(args[static_cast<size_t>(index)]);
		}
	}
}

void CPU::runBuiltinStringByte(NativeArgsView args, NativeResults& out) {
	const std::string& source = m_stringPool.toString(asStringId(args[0]));
	int position = 1;
	if (args.size() > 1) {
		const Value positionValue = args[1];
		if (!isNil(positionValue)) {
			position = static_cast<int>(std::trunc(asNumber(positionValue)));
		}
	}
	if (position < 1) {
		out.push_back(valueNil());
		return;
	}
	size_t byteIndex = 0;
	int current = 1;
	while (byteIndex < source.size()) {
		if (current == position) {
			out.push_back(valueNumber(static_cast<double>(readUtf8Codepoint(source, byteIndex))));
			return;
		}
		byteIndex = nextUtf8Index(source, byteIndex);
		current += 1;
	}
	out.push_back(valueNil());
}

void CPU::runBuiltinStringChar(NativeArgsView args, NativeResults& out) {
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		appendUtf8Codepoint(result, static_cast<uint32_t>(std::trunc(asNumber(arg))));
	}
	out.push_back(valueString(m_stringPool.intern(result)));
}

void CPU::runBuiltinError(NativeArgsView args) {
	const Value value = args[0];
	throw LuaThrownValueError(value, m_stringPool);
}

bool CPU::callValueInto(Value callee, NativeArgsView args, NativeResults& out) {
	out.clear();
	if (valueIsBuiltinFunction(callee)) {
		callBuiltinFunction(*asBuiltinFunction(callee), args, out);
		return !m_hardHalted && !m_haltedUntilIrq;
	}
	if (valueIsNativeFunction(callee)) {
		asNativeFunction(callee)->invoke(args, out);
		return !m_hardHalted && !m_haltedUntilIrq;
	}
	Closure* closure = asClosure(callee);
	const int depthBefore = static_cast<int>(m_frames.size());
	const int previousBudget = instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = swapExternalReturnSink(&out);
	int spentBudget = 0;
	int activeBudget = 0;
	bool completed = true;
	try {
		pushFrame(closure, args.data(), args.size(), 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
		while (static_cast<int>(m_frames.size()) > depthBefore) {
			activeBudget = budgetSentinel;
			RunResult result = runUntilDepth(depthBefore, budgetSentinel);
			spentBudget += activeBudget - instructionBudgetRemaining;
			activeBudget = 0;
			if (static_cast<int>(m_frames.size()) > depthBefore && result == RunResult::Halted) {
				completed = false;
				break;
			}
		}
	} catch (...) {
		if (activeBudget > 0) {
			spentBudget += activeBudget - instructionBudgetRemaining;
		}
		unwindToDepth(depthBefore);
		instructionBudgetRemaining = previousBudget - spentBudget;
		swapExternalReturnSink(previousSink);
		throw;
	}
	instructionBudgetRemaining = previousBudget - spentBudget;
	swapExternalReturnSink(previousSink);
	return completed;
}

void CPU::runBuiltinPCall(NativeArgsView args, NativeResults& out) {
	auto resultsScratch = acquireNativeReturnScratch();
	NativeResults& results = resultsScratch.get();
	try {
		if (!callValueInto(args[0], args.tailFrom(1), results)) {
			return;
		}
		out.clear();
		out.push_back(valueBool(true));
		out.append(results.data(), results.size());
	} catch (const LuaThrownValueError& e) {
		out.clear();
		out.push_back(valueBool(false));
		out.push_back(e.value);
	} catch (const std::exception& e) {
		out.clear();
		out.push_back(valueBool(false));
		out.push_back(valueString(m_stringPool.intern(e.what())));
	} catch (...) {
		out.clear();
		out.push_back(valueBool(false));
		out.push_back(valueString(m_stringPool.intern("error")));
	}
}

void CPU::runBuiltinXPCall(NativeArgsView args, NativeResults& out) {
	auto resultsScratch = acquireNativeReturnScratch();
	auto handlerArgsScratch = acquireNativeReturnScratch();
	NativeResults& results = resultsScratch.get();
	NativeResults& handlerArgs = handlerArgsScratch.get();
	try {
		if (!callValueInto(args[0], args.tailFrom(2), results)) {
			return;
		}
		out.clear();
		out.push_back(valueBool(true));
		out.append(results.data(), results.size());
		return;
	} catch (const LuaThrownValueError& e) {
		handlerArgs.push_back(e.value);
	} catch (const std::exception& e) {
		handlerArgs.push_back(valueString(m_stringPool.intern(e.what())));
	} catch (...) {
		handlerArgs.push_back(valueString(m_stringPool.intern("error")));
	}
	if (!callValueInto(args[1], NativeArgsView(handlerArgs.data(), handlerArgs.size()), results)) {
		return;
	}
	out.clear();
	out.push_back(valueBool(false));
	out.append(results.data(), results.size());
}

void CPU::clearHaltUntilIrq() {
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}

void CPU::enableMaskableInterrupts() {
	m_maskableInterruptsEnabled = true;
	m_maskableInterruptsRestoreEnabled = true;
}

void CPU::disableMaskableInterrupts() {
	m_maskableInterruptsEnabled = false;
	m_maskableInterruptsRestoreEnabled = false;
}

void CPU::requestNonMaskableInterrupt() {
	m_nonMaskableInterruptPending = true;
}

void CPU::restoreMaskableInterruptsAfterNonMaskableInterrupt() {
	m_maskableInterruptsEnabled = m_maskableInterruptsRestoreEnabled;
}

bool CPU::canAcceptMaskableInterruptLine(const IrqController& irqController) const {
	return m_maskableInterruptsEnabled
		&& irqController.hasAssertedMaskableInterruptLine();
}

AcceptedInterruptKind CPU::peekPendingInterrupt(const IrqController& irqController) const {
	if (m_nonMaskableInterruptPending) {
		return AcceptedInterruptKind::NonMaskable;
	}
	if (canAcceptMaskableInterruptLine(irqController)) {
		return AcceptedInterruptKind::Maskable;
	}
	return AcceptedInterruptKind::None;
}

bool CPU::enterPendingInterrupt(const IrqController& irqController, int irqProtoIndex) {
	if (!canAcceptMaskableInterruptLine(irqController)) {
		return false;
	}
	m_maskableInterruptsEnabled = false;
	clearHaltAfterAcceptedInterrupt();
	CallFrame* frame = pushFrame(&rootClosure(irqProtoIndex), nullptr, 0, 0, 0, false, m_program->protos[irqProtoIndex].entryPC);
	frame->isInterruptFrame = true;
	frame->savedMaskableEnabled = true;
	return true;
}

void CPU::enterHostExternalCall() {
	++m_hostExternalCallDepth;
}

void CPU::leaveHostExternalCall() {
	--m_hostExternalCallDepth;
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}

void CPU::blockMappedWrite(CallFrame& frame, uint32_t address) {
	frame.pc = m_currentInstructionPc;
	m_memoryWriteBlocked = true;
	m_memoryWriteBlockedAddress = address;
}

void CPU::resumeMemoryWrite(uint32_t address) {
	// A device-ready edge releases only the instruction stalled on that raw MMIO target.
	if (m_memoryWriteBlocked && m_memoryWriteBlockedAddress == address) {
		m_memoryWriteBlocked = false;
	}
}

RunResult CPU::run(int instructionBudget, const IrqController* irqController, int irqProtoIndex) {
	instructionBudgetRemaining = instructionBudget;
	auto& frames = m_frames;
	CallFrame* frame = nullptr;
	const DecodedInstruction* decoded;
	int pc = 0;
	int wordIndex = 0;
	int a = 0;
	int b = 0;
	int c = 0;
	uint32_t bx = 0;
	int sbx = 0;
	int rkB = 0;
	int rkC = 0;
	int disp = 0;
	Value* registers = nullptr;
#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	static void* const kDispatchTargets[OPCODE_COUNT] = {
#define OP(name) &&dispatch_##name,
#include "machine/cpu/cpu_opcode_list.inl"
#undef OP
	};
#pragma GCC diagnostic pop
#endif
	runHousekeeping();
dispatch_loop_check:
	if (frames.empty()) {
		return RunResult::Halted;
	}
	if (m_hardHalted || m_haltedUntilIrq || m_memoryWriteBlocked) {
		return RunResult::Halted;
	}
	if (m_yieldRequested) {
		m_yieldRequested = false;
		return RunResult::Yielded;
	}
	if (instructionBudgetRemaining <= 0) {
		return RunResult::Yielded;
	}
	if (irqController != nullptr
		&& m_hostExternalCallDepth == 0
		&& m_maskableInterruptsEnabled
		&& irqController->hasAssertedMaskableInterruptLine()
	) {
		enterPendingInterrupt(*irqController, irqProtoIndex);
		goto dispatch_loop_check;
	}
	frame = frames.back().get();
	registers = frame->registers;
	pc = frame->pc;
	wordIndex = pc / INSTRUCTION_BYTES;
	if (static_cast<uint32_t>(wordIndex) >= m_decodedWordCount) {
		hardHalt();
		return RunResult::Halted;
	}
	decoded = &decodedAtWordIndex(wordIndex);
	m_currentInstructionPc = pc;
	frame->pc = pc + (static_cast<int>(decoded->width) * INSTRUCTION_BYTES);
	lastPc = pc + ((static_cast<int>(decoded->width) - 1) * INSTRUCTION_BYTES);
	lastInstruction = decoded->word;
	instructionBudgetRemaining -= static_cast<int>(BASE_CYCLES[decoded->op]);
	a = decoded->a;
	b = decoded->b;
	c = decoded->c;
	bx = decoded->bx;
	sbx = decoded->sbx;
	rkB = decoded->rkB;
	rkC = decoded->rkC;
	disp = decoded->disp;

#define FRAME (*frame)
#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)

#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	goto *kDispatchTargets[decoded->op];
#pragma GCC diagnostic pop
#else
	switch (static_cast<OpCode>(decoded->op)) {
#define DISPATCH_LABEL(name) case OpCode::name:
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_LABEL
	}
#endif

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef FRAME
	tickHotLoopHousekeeping();
	goto dispatch_loop_check;

#if BMSX_USE_COMPUTED_GOTO
#define FRAME (*frame)
#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_LABEL(name) dispatch_##name:
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef DISPATCH_LABEL
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef FRAME
#endif
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget, const IrqController* irqController, int irqProtoIndex) {
	instructionBudgetRemaining = instructionBudget;
	auto& frames = m_frames;
	CallFrame* frame = nullptr;
	const DecodedInstruction* decoded;
	int pc = 0;
	int wordIndex = 0;
	int a = 0;
	int b = 0;
	int c = 0;
	uint32_t bx = 0;
	int sbx = 0;
	int rkB = 0;
	int rkC = 0;
	int disp = 0;
	Value* registers = nullptr;
#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	static void* const kDispatchTargets[OPCODE_COUNT] = {
#define OP(name) &&dispatch_##name,
#include "machine/cpu/cpu_opcode_list.inl"
#undef OP
	};
#pragma GCC diagnostic pop
#endif
	runHousekeeping();
dispatch_loop_check:
	if (static_cast<int>(frames.size()) <= targetDepth) {
		return RunResult::Halted;
	}
	if (m_hardHalted || m_haltedUntilIrq || m_memoryWriteBlocked) {
		return RunResult::Halted;
	}
	if (m_yieldRequested) {
		m_yieldRequested = false;
		return RunResult::Yielded;
	}
	if (instructionBudgetRemaining <= 0) {
		return RunResult::Yielded;
	}
	if (irqController != nullptr
		&& m_hostExternalCallDepth == 0
		&& m_maskableInterruptsEnabled
		&& irqController->hasAssertedMaskableInterruptLine()
	) {
		enterPendingInterrupt(*irqController, irqProtoIndex);
		goto dispatch_loop_check;
	}
	frame = frames.back().get();
	registers = frame->registers;
	pc = frame->pc;
	wordIndex = pc / INSTRUCTION_BYTES;
	if (static_cast<uint32_t>(wordIndex) >= m_decodedWordCount) {
		hardHalt();
		return RunResult::Halted;
	}
	decoded = &decodedAtWordIndex(wordIndex);
	m_currentInstructionPc = pc;
	frame->pc = pc + (static_cast<int>(decoded->width) * INSTRUCTION_BYTES);
	lastPc = pc + ((static_cast<int>(decoded->width) - 1) * INSTRUCTION_BYTES);
	lastInstruction = decoded->word;
	instructionBudgetRemaining -= static_cast<int>(BASE_CYCLES[decoded->op]);
	a = decoded->a;
	b = decoded->b;
	c = decoded->c;
	bx = decoded->bx;
	sbx = decoded->sbx;
	rkB = decoded->rkB;
	rkC = decoded->rkC;
	disp = decoded->disp;

#define FRAME (*frame)
#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)

#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	goto *kDispatchTargets[decoded->op];
#pragma GCC diagnostic pop
#else
	switch (static_cast<OpCode>(decoded->op)) {
#define DISPATCH_LABEL(name) case OpCode::name:
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_LABEL
	}
#endif

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef FRAME
	tickHotLoopHousekeeping();
	goto dispatch_loop_check;

#if BMSX_USE_COMPUTED_GOTO
#define FRAME (*frame)
#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_LABEL(name) dispatch_##name:
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef DISPATCH_LABEL
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef FRAME
#endif
}

void CPU::unwindToDepth(int targetDepth) {
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		closeUpvalues(*finished);
		m_stackTop = finished->varargBase;
		m_stack.resize(static_cast<size_t>(m_stackTop));
		releaseFrame(std::move(finished));
	}
}

void CPU::collectHeap() {
	m_heap.requestCollection();
	m_heap.collect();
}

void CPU::runHousekeeping() {
	enforceLuaHeapBudget();
	if (m_heap.needsCollection()) {
		m_heap.collect();
	}
	m_hotLoopHousekeepingCountdown = HOT_LOOP_HOUSEKEEPING_STRIDE;
}

void CPU::tickHotLoopHousekeeping() {
	m_hotLoopHousekeepingCountdown -= 1;
	if (m_hotLoopHousekeepingCountdown <= 0) {
		runHousekeeping();
	}
}

void CPU::step() {
	if (m_frames.empty()) return;
	if (m_hardHalted || m_haltedUntilIrq || m_memoryWriteBlocked) return;
	runHousekeeping();
	CallFrame& frame = *m_frames.back();
	int pc = frame.pc;
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (static_cast<uint32_t>(wordIndex) >= m_decodedWordCount) {
		hardHalt();
		return;
	}
	const DecodedInstruction& decoded = decodedAtWordIndex(wordIndex);
	m_currentInstructionPc = pc;
	frame.pc = pc + (static_cast<int>(decoded.width) * INSTRUCTION_BYTES);
	lastPc = pc + ((static_cast<int>(decoded.width) - 1) * INSTRUCTION_BYTES);
	lastInstruction = decoded.word;
	instructionBudgetRemaining -= static_cast<int>(BASE_CYCLES[decoded.op]);
	executeInstruction(frame, decoded);
}

std::optional<SourceRange> CPU::getDebugRange(int pc) const {
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (!m_metadata || wordIndex < 0 || wordIndex >= static_cast<int>(m_metadata->debugRanges.size())) {
		return std::nullopt;
	}
	return m_metadata->debugRanges[static_cast<size_t>(wordIndex)];
}

std::vector<std::pair<int, int>> CPU::getCallStack() const {
	std::vector<std::pair<int, int>> stack;
	int topIndex = static_cast<int>(m_frames.size()) - 1;
	for (int i = 0; i < static_cast<int>(m_frames.size()); ++i) {
		const auto& frame = m_frames[i];
		int pc = (i == topIndex) ? lastPc : frame->callSitePc;
		stack.emplace_back(frame->protoIndex, pc);
	}
	return stack;
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->top;
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return frame.registers[static_cast<size_t>(registerIndex)];
}

bool CPU::hasFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return upvalueIndex >= 0 && upvalueIndex < static_cast<int>(frame.closure->upvalueCount);
}

Value CPU::readFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return const_cast<CPU*>(this)->readUpvalue(frame.closure->upvalues[static_cast<size_t>(upvalueIndex)]);
}

void CPU::executeInstruction(CallFrame& frame, const DecodedInstruction& decoded) {
	const int a = decoded.a;
	const int b = decoded.b;
	const int c = decoded.c;
	const uint32_t bx = decoded.bx;
	const int sbx = decoded.sbx;
	const int rkB = decoded.rkB;
	const int rkC = decoded.rkC;
	const int disp = decoded.disp;
	Value* registers = frame.registers;

#define FRAME frame
#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded.tableCacheIndex)
#define DISPATCH_LABEL(name) case OpCode::name:
#define DISPATCH_CONTINUE() do { return; } while (0)
#define DISPATCH_BLOCKED() do { return; } while (0)
	switch (static_cast<OpCode>(decoded.op)) {
#include "machine/cpu/cpu_dispatch.inl"
	}
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef DISPATCH_LABEL
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef FRAME
}

Upvalue* CPU::findOpenUpvalue(const CallFrame& frame, int index) const {
	for (const OpenUpvalueSlot& entry : m_openUpvalues) {
		if (entry.frame == &frame && entry.index == index) {
			return entry.upvalue;
		}
	}
	return nullptr;
}

Closure* CPU::createClosure(CallFrame& frame, int protoIndex) {
	const Proto& proto = m_program->protos[protoIndex];
	if (proto.staticClosure && proto.upvalues.empty()) {
		return &rootClosure(protoIndex);
	}
	auto* closure = createTrackedClosure(protoIndex, proto.upvalues.size());
	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& uv = proto.upvalues[i];
		if (uv.isLocal) {
			Upvalue* upvalue = findOpenUpvalue(frame, uv.index);
			if (!upvalue) {
				upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				addTrackedLuaHeapBytes(kUpvalueHeapBytes);
				upvalue->open = true;
				upvalue->index = uv.index;
				upvalue->frame = &frame;
				m_openUpvalues.push_back(OpenUpvalueSlot{ &frame, uv.index, upvalue });
			}
			closure->upvalues[i] = upvalue;
		} else {
			closure->upvalues[i] = frame.closure->upvalues[uv.index];
		}
	}
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	size_t write = 0;
	for (size_t index = 0; index < m_openUpvalues.size(); ++index) {
		OpenUpvalueSlot entry = m_openUpvalues[index];
		if (entry.frame == &frame) {
			Upvalue* upvalue = entry.upvalue;
			upvalue->value = frame.registers[static_cast<size_t>(upvalue->index)];
			upvalue->open = false;
			upvalue->frame = nullptr;
			continue;
		}
		m_openUpvalues[write++] = entry;
	}
	m_openUpvalues.resize(write);
}

const Value& CPU::readUpvalue(Upvalue* upvalue) {
	if (upvalue->open) {
		return upvalue->frame->registers[upvalue->index];
	}
	return upvalue->value;
}

void CPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (upvalue->open) {
		upvalue->frame->registers[upvalue->index] = value;
		return;
	}
	upvalue->value = value;
}

CallFrame* CPU::pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	const int callerArgBase = caller.stackBase + argBase;
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->captureReturns = captureReturns;
	frame->callSitePc = callSitePc;
	frame->varargBase = m_stackTop;
	frame->varargCount = proto.isVararg ? std::max(argCount - proto.numParams, 0) : 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(proto.maxStack, 1)));
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = proto.numParams;

	for (int i = 0; i < proto.numParams; ++i) {
		if (i < argCount) {
			frame->registers[static_cast<size_t>(i)] = m_stack[static_cast<size_t>(callerArgBase + i)];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (proto.isVararg) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = m_stack[static_cast<size_t>(callerArgBase + proto.numParams + i)];
		}
	}
	CallFrame* pushed = frame.get();
	m_frames.push_back(std::move(frame));
	return pushed;
}

CallFrame* CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	const uintptr_t stackBegin = reinterpret_cast<uintptr_t>(m_stack.data());
	const uintptr_t stackEnd = stackBegin + m_stack.size() * sizeof(Value);
	const uintptr_t argsBegin = reinterpret_cast<uintptr_t>(args);
	const uintptr_t argsEnd = argsBegin + argCount * sizeof(Value);
	const bool argsInStack = argCount > 0 && stackBegin != 0 && argsBegin >= stackBegin && argsEnd <= stackEnd;
	const ptrdiff_t argsOffset = argsInStack ? static_cast<ptrdiff_t>((argsBegin - stackBegin) / sizeof(Value)) : 0;
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->captureReturns = captureReturns;
	frame->callSitePc = callSitePc;
	frame->varargBase = m_stackTop;
	frame->varargCount = proto.isVararg ? std::max(static_cast<int>(argCount) - proto.numParams, 0) : 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(proto.maxStack, 1)));
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = proto.numParams;
	const Value* sourceArgs = argsInStack ? m_stack.data() + argsOffset : args;

	for (int i = 0; i < proto.numParams; ++i) {
		if (i < static_cast<int>(argCount)) {
			frame->registers[static_cast<size_t>(i)] = sourceArgs[i];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (proto.isVararg) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = sourceArgs[static_cast<size_t>(proto.numParams + i)];
		}
	}
	CallFrame* pushed = frame.get();
	m_frames.push_back(std::move(frame));
	return pushed;
}

void CPU::writeReturnValues(CallFrame& frame, int base, int count, const Value* values, int valueCount) {
	if (count == 0) {
		for (int i = 0; i < valueCount; ++i) {
			setRegister(frame, base + i, values[i]);
		}
		frame.top = base + valueCount;
		return;
	}
	for (int i = 0; i < count; ++i) {
		const Value value = i < valueCount ? values[i] : valueNil();
		setRegister(frame, base + i, value);
	}
	frame.top = base + count;
}

void CPU::setRegister(CallFrame& frame, int index, Value value) {
	Value* registers = ensureRegisterCapacity(frame, index);
	registers[static_cast<size_t>(index)] = value;
	const int nextTop = index + 1;
	if (nextTop > frame.top) {
		frame.top = nextTop;
	}
}

Value* CPU::ensureRegisterCapacity(CallFrame& frame, int index) {
	if (index < frame.stackCapacity) {
		return frame.registers;
	}
	int frameIndex = -1;
	for (size_t i = 0; i < m_frames.size(); ++i) {
		if (m_frames[i].get() == &frame) {
			frameIndex = static_cast<int>(i);
			break;
		}
	}
	if (frameIndex < 0) {
		throw BMSX_RUNTIME_ERROR("[CPU] Attempted to grow registers for a non-top frame.");
	}
	const size_t needed = static_cast<size_t>(index) + 1;
	size_t bucket = nextPowerOfTwo(needed);
	if (bucket < 8) {
		bucket = 8;
	}
	const int previousCapacity = frame.stackCapacity;
	frame.stackCapacity = static_cast<int>(bucket);
	const int delta = frame.stackCapacity - previousCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop + delta));
	if (delta > 0) {
		for (int i = static_cast<int>(m_frames.size()) - 1; i > frameIndex; --i) {
			CallFrame* shifted = m_frames[static_cast<size_t>(i)].get();
			const int rangeBase = shifted->varargBase;
			const int rangeCount = shifted->varargCount + shifted->stackCapacity;
			for (int slot = rangeCount - 1; slot >= 0; --slot) {
				m_stack[static_cast<size_t>(rangeBase + delta + slot)] = m_stack[static_cast<size_t>(rangeBase + slot)];
			}
			shifted->varargBase += delta;
			shifted->stackBase += delta;
		}
	}
	m_stackTop += delta;
	refreshFrameRegisterPointers();
	for (int i = previousCapacity; i < frame.stackCapacity; ++i) {
		frame.registers[static_cast<size_t>(i)] = valueNil();
	}
	return frame.registers;
}

void CPU::writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount) {
	uint32_t writeAddr = addr;
	for (int offset = 0; offset < valueCount; ++offset) {
		m_memory.writeMappedValue(writeAddr, frame.registers[static_cast<size_t>(valueBase + offset)]);
		writeAddr += 4;
	}
}

const Value& CPU::readRK(CallFrame& frame, int rk) {
	if (rk < 0) {
		int index = -1 - rk;
		return m_program->constPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
}

template <typename Getter>
Value CPU::resolveTableIndexChain(Table* table, Getter get) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		const Value value = get(current);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->metatable;
		if (!metatable) {
			return valueNil();
		}
		const Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw BMSX_RUNTIME_ERROR("Metatable __index loop detected.");
}

Value CPU::resolveTableIndex(Table* table, const Value& key) {
	return resolveTableIndexChain(table, [&](Table* current) {
		return current->get(key);
	});
}

Value CPU::resolveTableIntegerIndex(Table* table, int index) {
	return resolveTableIndexChain(table, [index](Table* current) {
		return current->getInteger(index);
	});
}

Value CPU::resolveTableFieldIndex(Table* table, StringId key) {
	return resolveTableIndexChain(table, [key](Table* current) {
		return current->getStringKey(key);
	});
}

Value CPU::loadTableIndex(const Value& base, const Value& key) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->get(key);
		}
		return resolveTableIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->get(key);
		}
		return resolveTableIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(key);
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableIntegerIndexCached(int cacheIndex, const Value& base, int index) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = m_tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == table && cache.version == table->version()) {
				return cache.value;
			}
			const Value value = table->getInteger(index);
			cache.table = table;
			cache.version = table->version();
			cache.value = value;
			return value;
		}
		return resolveTableIntegerIndex(table, index);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			TableLoadInlineCache& cache = m_tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == m_stringIndexTable && cache.version == m_stringIndexTable->version()) {
				return cache.value;
			}
			const Value value = m_stringIndexTable->getInteger(index);
			cache.table = m_stringIndexTable;
			cache.version = m_stringIndexTable->version();
			cache.value = value;
			return value;
		}
		return resolveTableIntegerIndex(m_stringIndexTable, index);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueNumber(static_cast<double>(index)));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIntegerIndex(asTable(indexerValue), index);
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableIntegerIndex(const Value& base, int index) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->getInteger(index);
		}
		return resolveTableIntegerIndex(table, index);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->getInteger(index);
		}
		return resolveTableIntegerIndex(m_stringIndexTable, index);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueNumber(static_cast<double>(index)));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIntegerIndex(asTable(indexerValue), index);
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableFieldIndexCached(int cacheIndex, const Value& base, StringId key) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = m_tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == table && cache.version == table->version()) {
				return cache.value;
			}
			const Value value = table->getStringKey(key);
			cache.table = table;
			cache.version = table->version();
			cache.value = value;
			return value;
		}
		return resolveTableFieldIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			TableLoadInlineCache& cache = m_tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == m_stringIndexTable && cache.version == m_stringIndexTable->version()) {
				return cache.value;
			}
			const Value value = m_stringIndexTable->getStringKey(key);
			cache.table = m_stringIndexTable;
			cache.version = m_stringIndexTable->version();
			cache.value = value;
			return value;
		}
		return resolveTableFieldIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueString(key));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableFieldIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableFieldIndex(const Value& base, StringId key) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->getStringKey(key);
		}
		return resolveTableFieldIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->getStringKey(key);
		}
		return resolveTableFieldIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueString(key));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableFieldIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

void CPU::storeTableIndex(const Value& base, const Value& key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->set(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(key, value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

void CPU::storeTableIntegerIndex(const Value& base, int index, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setInteger(index, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueNumber(static_cast<double>(index)), value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

void CPU::storeTableFieldIndex(const Value& base, StringId key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setStringKey(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueString(key), value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

std::unique_ptr<CallFrame> CPU::acquireFrame() {
	if (!m_framePool.empty()) {
		auto frame = std::move(m_framePool.back());
		m_framePool.pop_back();
		return frame;
	}
	return std::make_unique<CallFrame>();
}

void CPU::releaseFrame(std::unique_ptr<CallFrame> frame) {
	frame->varargBase = 0;
	frame->varargCount = 0;
	frame->registers = nullptr;
	frame->stackBase = 0;
	frame->stackCapacity = 0;
	frame->isInterruptFrame = false;
	frame->savedMaskableEnabled = true;
	if (m_framePool.size() < static_cast<size_t>(MAX_POOLED_FRAMES)) {
		m_framePool.push_back(std::move(frame));
	}
}

void CPU::clearCallStack() {
	while (!m_frames.empty()) {
		CallFrame* frame = m_frames.back().get();
		closeUpvalues(*frame);
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		releaseFrame(std::move(finished));
	}
	m_openUpvalues.clear();
	m_stack.clear();
	m_stackTop = 0;
}

void CPU::ensureStackSize(size_t size) {
	Value* previousBase = m_stack.data();
	if (size > m_stack.size()) {
		m_stack.resize(size, valueNil());
	}
	if (m_stack.data() != previousBase) {
		refreshFrameRegisterPointers();
	}
}

void CPU::refreshFrameRegisterPointers() {
	Value* base = m_stack.data();
	for (const auto& framePtr : m_frames) {
		framePtr->registers = base + framePtr->stackBase;
	}
}

NativeResultsScratchScope CPU::acquireNativeReturnScratch() {
	NativeResults& out = m_nativeReturnScratch.get(m_nativeReturnScratchIndex);
	m_nativeReturnScratchIndex += 1;
	out.clear();
	return NativeResultsScratchScope(*this, out);
}

void CPU::releaseNativeReturnScratch(NativeResults& out) {
	out.clear();
	m_nativeReturnScratchIndex -= 1;
}

CPU::NativeLocalRootsScope CPU::acquireNativeLocalRoots() {
	return NativeLocalRootsScope(*this);
}

void CPU::releaseNativeLocalRoots(size_t base) {
	m_nativeLocalRoots.resize(base);
	m_nativeLocalRootScopeDepth -= 1;
}

void CPU::trackNativeLocalRoot(Value value) {
	if (m_nativeLocalRootScopeDepth > 0) {
		m_nativeLocalRoots.push_back(value);
	}
}

void CPU::markRoots(GcHeap& heap) {
	heap.markObject(globals);
	// Keep the interned "__index" key tracked even while no live metatable uses it.
	heap.markValue(m_indexKey);
	heap.markObject(m_stringIndexTable);
	m_memory.markRoots(heap);
	for (const auto& value : lastReturnValues) {
		heap.markValue(value);
	}
	if (m_externalReturnSink) {
		for (size_t i = 0; i < m_externalReturnSink->size(); ++i) {
			heap.markValue((*m_externalReturnSink)[i]);
		}
	}
	for (size_t scratchIndex = 0; scratchIndex < m_nativeReturnScratchIndex; ++scratchIndex) {
		NativeResults& scratch = m_nativeReturnScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			heap.markValue(scratch[valueIndex]);
		}
	}
	for (const Value value : m_nativeLocalRoots) {
		heap.markValue(value);
	}
	for (const auto& cache : m_tableLoadCaches) {
		if (cache.table) {
			heap.markObject(cache.table);
		}
		heap.markValue(cache.value);
	}
	for (const auto& value : m_systemGlobalValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_globalValues) {
		heap.markValue(value);
	}
	if (m_program) {
		for (const auto& value : m_program->constPool) {
			heap.markValue(value);
		}
	}
	for (const auto& framePtr : m_frames) {
		CallFrame* frame = framePtr.get();
		heap.markClosure(frame->closure);
		for (int i = 0; i < frame->top; ++i) {
			heap.markValue(frame->registers[static_cast<size_t>(i)]);
		}
		for (int i = 0; i < frame->varargCount; ++i) {
			heap.markValue(m_stack[static_cast<size_t>(frame->varargBase + i)]);
		}
	}
	for (const auto& entry : m_openUpvalues) {
		heap.markObject(entry.upvalue);
		heap.markValue(entry.frame->registers[static_cast<size_t>(entry.index)]);
	}
	m_externalRootMarker(heap);
}

// end repeated-sequence-acceptable

} // namespace bmsx
