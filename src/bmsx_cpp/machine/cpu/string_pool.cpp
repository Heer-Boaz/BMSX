#include "machine/memory/string/pool.h"

#include "common/utf8.h"

#include <stdexcept>

namespace bmsx {

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

StringPool::StringPool(StringHandleTable* handleTable)
	: m_handleTable(handleTable) {
}

StringId StringPool::intern(std::string_view value) {
	auto it = m_stringMap.find(value);
	if (it != m_stringMap.end()) {
		return it->second;
	}
	auto stringEntry = std::make_unique<InternedString>();
	StringId id = m_nextId;
	if (m_handleTable) {
		id = static_cast<StringId>(m_handleTable->allocateHandle(value));
	}
	stringEntry->id = id;
	stringEntry->value.assign(value.data(), value.size());
	stringEntry->codepointCount = countCodepoints(stringEntry->value);
	if (id >= m_entries.size()) {
		m_entries.resize(static_cast<size_t>(id) + 1u);
	}
	m_entries[id] = std::move(stringEntry);
	m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
	if (id >= m_nextId) {
		m_nextId = id + 1u;
	}
	return id;
}

const std::string& StringPool::toString(StringId id) const {
	return entry(id).value;
}

int StringPool::codepointCount(StringId id) const {
	return entry(id).codepointCount;
}

void StringPool::reserveHandles(StringId minHandle) {
	if (m_handleTable) {
		m_handleTable->reserveHandles(minHandle);
	}
	if (minHandle > m_nextId) {
		if (m_entries.size() < static_cast<size_t>(minHandle)) {
			m_entries.resize(static_cast<size_t>(minHandle));
		}
		m_nextId = minHandle;
	}
}

void StringPool::rehydrateFromHandleTable(const StringHandleTableState& state) {
	m_stringMap.clear();
	m_entries.clear();
	m_nextId = 0;
	if (!m_handleTable) {
		throw std::runtime_error("StringPool: missing string handle table.");
	}
	for (StringId id = 0; id < state.nextHandle; ++id) {
		const StringHandleEntry handleEntry = m_handleTable->readEntry(id);
		auto restored = std::make_unique<InternedString>();
		restored->id = id;
		restored->value = m_handleTable->readText(handleEntry);
		restored->codepointCount = countCodepoints(restored->value);
		if (id >= m_entries.size()) {
			m_entries.resize(static_cast<size_t>(id) + 1u);
		}
		m_entries[id] = std::move(restored);
		m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
	}
	reserveHandles(state.nextHandle);
	m_nextId = state.nextHandle;
}

const InternedString& StringPool::entry(StringId id) const {
	const auto* stringEntry = m_entries.at(static_cast<size_t>(id)).get();
	return *stringEntry;
}

int StringPool::countCodepoints(std::string_view text) {
	int count = 0;
	size_t index = 0;
	while (index < text.size()) {
		index = nextUtf8Index(text, index);
		count += 1;
	}
	return count;
}

} // namespace bmsx
