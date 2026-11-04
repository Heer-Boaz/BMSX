#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace bmsx {

using StringId = uint32_t;
class CPU;
class LuaHeap;

struct StringPoolStateEntry {
	StringId id = 0;
	std::string value;
	bool tracked = false;
};

struct StringPoolState {
	// Occupied slots in ascending ID order.
	std::vector<StringPoolStateEntry> entries;
};

class StringPool {
public:
	explicit StringPool(LuaHeap& luaHeap);

	StringId intern(std::string_view value);
	StringId intern(std::string_view value, bool tracked);
	std::optional<StringId> find(std::string_view value) const;
	const std::string& toString(StringId id) const;
	int codepointCount(StringId id) const;
	size_t trackedLuaHeapBytes() const { return m_trackedBytes; }
	StringPoolState captureState() const;
	void restoreState(const StringPoolState& state);
	void beginLocalRoots();
	void endLocalRoots();

	// The intern index is weak. Live VM/image roots retain their StringIds;
	// sweep removes unreachable text and reuses vacant IDs. RAM accounting is
	// independent of reachability: resident image literals remain ROM-backed.
	void beginReachabilityEpoch();
	void markReachable(StringId id);
	void reclaimUnreachable();

private:
	friend class CPU;
	StringId internOwned(std::string&& value);

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

	const InternedString& entry(StringId id) const;
	template <typename Text>
	StringId internText(Text&& value, bool tracked);
	template <typename Text>
	InternedString& insert(StringId id, Text&& value);
	void insertEntry(std::unique_ptr<InternedString> entry);
	void trackStringEntry(InternedString& entry, size_t byteLength);
	LuaHeap& m_luaHeap;
	std::vector<StringId> m_freeIds;
	std::vector<StringId> m_localRoots;
	std::vector<size_t> m_localRootBases;
	size_t m_trackedBytes = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	std::vector<std::unique_ptr<InternedString>> m_entries;
	std::vector<bool> m_reachable;
};

} // namespace bmsx
