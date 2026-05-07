#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace bmsx {

using StringId = uint32_t;

struct StringPoolStateEntry {
	StringId id = 0;
	std::string value;
	bool tracked = false;
};

struct StringPoolState {
	std::vector<StringPoolStateEntry> entries;
};

struct InternedString {
	StringId id = 0;
	std::string value;
	int codepointCount = 0;
	size_t trackedByteLength = 0;
};

struct StringKeyHash {
	using is_transparent = void;
	size_t operator()(std::string_view key) const noexcept;
	size_t operator()(const std::string& key) const noexcept;
};

struct StringKeyEq {
	using is_transparent = void;
	bool operator()(std::string_view lhs, std::string_view rhs) const noexcept;
	bool operator()(const std::string& lhs, const std::string& rhs) const noexcept;
	bool operator()(const std::string& lhs, std::string_view rhs) const noexcept;
	bool operator()(std::string_view lhs, const std::string& rhs) const noexcept;
};

class StringPool {
public:
	explicit StringPool(bool trackLuaHeap = false);

	StringId intern(std::string_view value);
	StringId internRom(std::string_view value);
	const std::string& toString(StringId id) const;
	int codepointCount(StringId id) const;
	size_t trackedLuaHeapBytes() const { return m_trackLuaHeap ? m_trackedBytes : 0; }
	StringPoolState captureState() const;
	void restoreState(const StringPoolState& state);

private:
	StringId internWithOwnership(std::string_view value, bool tracked);
	const InternedString& entry(StringId id) const;
	InternedString& insert(StringId id, std::string_view value);
	void insertEntry(std::unique_ptr<InternedString> entry);
	StringId m_nextId = 0;
	bool m_trackLuaHeap = false;
	size_t m_trackedBytes = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	std::vector<std::unique_ptr<InternedString>> m_entries;
};

} // namespace bmsx
