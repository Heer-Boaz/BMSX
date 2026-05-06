#pragma once

#include "machine/memory/string/memory.h"

#include <cstddef>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace bmsx {

using StringId = uint32_t;

struct InternedString {
	StringId id = 0;
	std::string value;
	int codepointCount = 0;
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
	explicit StringPool(StringHandleTable* handleTable = nullptr);

	StringId intern(std::string_view value);
	const std::string& toString(StringId id) const;
	int codepointCount(StringId id) const;
	void reserveHandles(StringId minHandle);
	void rehydrateFromHandleTable(const StringHandleTableState& state);

private:
	const InternedString& entry(StringId id) const;
	static int countCodepoints(std::string_view text);

	StringHandleTable* m_handleTable = nullptr;
	StringId m_nextId = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	std::vector<std::unique_ptr<InternedString>> m_entries;
};

} // namespace bmsx
