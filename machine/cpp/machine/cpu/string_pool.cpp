#include "machine/cpu/string_pool.h"

#include "common/utf8.h"
#include "machine/cpu/lua_heap.h"

#include <utility>

namespace bmsx {

StringPool::StringPool(LuaHeap& luaHeap)
	: m_luaHeap(luaHeap) {
}

size_t StringPool::StringKeyHash::operator()(std::string_view key) const noexcept {
	return std::hash<std::string_view>{}(key);
}

size_t StringPool::StringKeyHash::operator()(const std::string& key) const noexcept {
	return std::hash<std::string_view>{}(key);
}

bool StringPool::StringKeyEq::operator()(std::string_view lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
bool StringPool::StringKeyEq::operator()(const std::string& lhs, const std::string& rhs) const noexcept { return lhs == rhs; }
bool StringPool::StringKeyEq::operator()(const std::string& lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
bool StringPool::StringKeyEq::operator()(std::string_view lhs, const std::string& rhs) const noexcept { return lhs == rhs; }

template <typename Text>
StringId StringPool::internText(Text&& value, bool tracked) {
	auto it = m_stringMap.find(value);
	if (it != m_stringMap.end()) {
		const StringId id = it->second;
		InternedString& stringEntry = *m_entries[static_cast<size_t>(id)];
		if (tracked && stringEntry.trackedByteLength == 0) {
			const size_t byteLength = utf8ByteLength(stringEntry.value);
			m_luaHeap.reserve(byteLength, valueString(id));
			trackStringEntry(stringEntry, byteLength);
		}
		if (!m_localRootBases.empty()) m_localRoots.push_back(id);
		return id;
	}
	const size_t byteLength = tracked ? utf8ByteLength(value) : 0;
	if (tracked) {
		m_luaHeap.reserve(byteLength);
	}
	StringId id;
	if (m_freeIds.empty()) {
		id = static_cast<StringId>(m_entries.size());
	} else {
		id = m_freeIds.back();
		m_freeIds.pop_back();
	}
	InternedString& stringEntry = insert(id, std::forward<Text>(value));
	if (tracked) {
		trackStringEntry(stringEntry, byteLength);
	}
	if (!m_localRootBases.empty()) m_localRoots.push_back(stringEntry.id);
	return stringEntry.id;
}

StringId StringPool::intern(std::string_view value) {
	return internText(value, true);
}

StringId StringPool::intern(std::string_view value, bool tracked) {
	return internText(value, tracked);
}

StringId StringPool::internOwned(std::string&& value) {
	return internText(std::move(value), true);
}

std::optional<StringId> StringPool::find(std::string_view value) const {
	const auto it = m_stringMap.find(value);
	return it != m_stringMap.end() ? std::optional<StringId>(it->second) : std::nullopt;
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
	m_freeIds.clear();
	m_trackedBytes = 0;
	for (const StringPoolStateEntry& stateEntry : state.entries) {
		InternedString& stringEntry = insert(stateEntry.id, stateEntry.value);
		if (stateEntry.tracked) {
			stringEntry.trackedByteLength = utf8ByteLength(stringEntry.value);
			m_trackedBytes += stringEntry.trackedByteLength;
		}
	}
	m_luaHeap.adjustForRestore(previousTrackedBytes, m_trackedBytes);
}

void StringPool::beginLocalRoots() {
	m_localRootBases.push_back(m_localRoots.size());
}

void StringPool::endLocalRoots() {
	m_localRoots.resize(m_localRootBases.back());
	m_localRootBases.pop_back();
}

void StringPool::beginReachabilityEpoch() {
	m_reachable.assign(m_entries.size(), false);
	for (const StringId id : m_localRoots) m_reachable[id] = true;
}

void StringPool::markReachable(StringId id) {
	m_reachable[static_cast<size_t>(id)] = true;
}

void StringPool::reclaimUnreachable() {
	size_t reclaimed = 0;
	m_freeIds.clear();
	for (size_t id = 0; id < m_entries.size(); ++id) {
		InternedString* stringEntry = m_entries[id].get();
		if (!stringEntry) {
			m_freeIds.push_back(static_cast<StringId>(id));
			continue;
		}
		if (m_reachable[id]) {
			continue;
		}
		reclaimed += stringEntry->trackedByteLength;
		m_stringMap.erase(std::string_view(stringEntry->value));
		m_entries[id].reset();
		m_freeIds.push_back(static_cast<StringId>(id));
	}
	while (!m_entries.empty() && !m_entries.back()) {
		m_entries.pop_back();
		m_freeIds.pop_back();
	}
	m_trackedBytes -= reclaimed;
	m_luaHeap.release(reclaimed);
}

const StringPool::InternedString& StringPool::entry(StringId id) const {
	const auto* stringEntry = m_entries[static_cast<size_t>(id)].get();
	return *stringEntry;
}

template <typename Text>
StringPool::InternedString& StringPool::insert(StringId id, Text&& value) {
	auto stringEntry = std::make_unique<InternedString>();
	stringEntry->id = id;
	stringEntry->value = std::forward<Text>(value);
	stringEntry->codepointCount = utf8CodepointCount(stringEntry->value);
	InternedString& inserted = *stringEntry;
	insertEntry(std::move(stringEntry));
	return inserted;
}

void StringPool::insertEntry(std::unique_ptr<InternedString> entry) {
	const StringId id = entry->id;
	if (id >= m_entries.size()) {
		for (size_t vacant = m_entries.size(); vacant < id; ++vacant) m_freeIds.push_back(static_cast<StringId>(vacant));
		m_entries.resize(static_cast<size_t>(id) + 1u);
	}
	m_entries[id] = std::move(entry);
	m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
}

void StringPool::trackStringEntry(InternedString& entry, size_t byteLength) {
	entry.trackedByteLength = byteLength;
	m_trackedBytes += byteLength;
}

} // namespace bmsx
