#include "machine/cpu/string_pool.h"

#include "common/utf8.h"
#include "machine/memory/lua_heap_usage.h"

namespace bmsx {

StringPool::StringPool(bool trackLuaHeap)
	: m_trackLuaHeap(trackLuaHeap) {
}

size_t StringKeyHash::operator()(std::string_view key) const noexcept {
	return std::hash<std::string_view>{}(key);
}

size_t StringKeyHash::operator()(const std::string& key) const noexcept {
	return std::hash<std::string_view>{}(key);
}

bool StringKeyEq::operator()(std::string_view lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
bool StringKeyEq::operator()(const std::string& lhs, const std::string& rhs) const noexcept { return lhs == rhs; }
bool StringKeyEq::operator()(const std::string& lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
bool StringKeyEq::operator()(std::string_view lhs, const std::string& rhs) const noexcept { return lhs == rhs; }

StringId StringPool::intern(std::string_view value) {
	return internWithOwnership(value, m_trackLuaHeap);
}

StringId StringPool::internRom(std::string_view value) {
	return internWithOwnership(value, false);
}

StringId StringPool::internWithOwnership(std::string_view value, bool tracked) {
	auto it = m_stringMap.find(value);
	if (it != m_stringMap.end()) {
		const StringId id = it->second;
		InternedString& stringEntry = *m_entries[static_cast<size_t>(id)];
		if (tracked && stringEntry.trackedByteLength == 0) {
			const size_t byteLength = utf8ByteLength(stringEntry.value);
			stringEntry.trackedByteLength = byteLength;
			m_trackedBytes += byteLength;
			addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(byteLength));
			enforceLuaHeapBudget();
		}
		return id;
	}
	InternedString& stringEntry = insert(m_nextId, value);
	if (tracked) {
		const size_t byteLength = utf8ByteLength(stringEntry.value);
		stringEntry.trackedByteLength = byteLength;
		m_trackedBytes += byteLength;
		addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(byteLength));
		enforceLuaHeapBudget();
	}
	return stringEntry.id;
}

const std::string& StringPool::toString(StringId id) const {
	return entry(id).value;
}

int StringPool::codepointCount(StringId id) const {
	return entry(id).codepointCount;
}

StringPoolState StringPool::captureState() const {
	StringPoolState state;
	for (const auto& entry : m_entries) {
		if (entry) {
			state.entries.push_back(StringPoolStateEntry{ entry->id, entry->value, entry->trackedByteLength > 0 });
		}
	}
	return state;
}

void StringPool::restoreState(const StringPoolState& state) {
	const size_t previousTrackedBytes = m_trackedBytes;
	m_stringMap.clear();
	m_entries.clear();
	m_nextId = 0;
	m_trackedBytes = 0;
	for (const StringPoolStateEntry& stateEntry : state.entries) {
		InternedString& stringEntry = insert(stateEntry.id, stateEntry.value);
		if (stateEntry.tracked) {
			stringEntry.trackedByteLength = utf8ByteLength(stringEntry.value);
			m_trackedBytes += stringEntry.trackedByteLength;
		}
	}
	if (m_trackLuaHeap) {
		replaceTrackedLuaHeapBytes(previousTrackedBytes, m_trackedBytes);
		enforceLuaHeapBudget();
	}
}

const InternedString& StringPool::entry(StringId id) const {
	const auto* stringEntry = m_entries.at(static_cast<size_t>(id)).get();
	return *stringEntry;
}

InternedString& StringPool::insert(StringId id, std::string_view value) {
	auto stringEntry = std::make_unique<InternedString>();
	stringEntry->id = id;
	stringEntry->value.assign(value.data(), value.size());
	stringEntry->codepointCount = utf8CodepointCount(stringEntry->value);
	InternedString& inserted = *stringEntry;
	insertEntry(std::move(stringEntry));
	return inserted;
}

void StringPool::insertEntry(std::unique_ptr<InternedString> entry) {
	const StringId id = entry->id;
	if (id >= m_entries.size()) {
		m_entries.resize(static_cast<size_t>(id) + 1u);
	}
	m_entries[id] = std::move(entry);
	m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
	if (id >= m_nextId) {
		m_nextId = id + 1u;
	}
}

} // namespace bmsx
