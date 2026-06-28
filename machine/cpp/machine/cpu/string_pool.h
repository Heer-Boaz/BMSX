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

class StringPool {
public:
	explicit StringPool(bool trackLuaHeap = false);

	StringId intern(std::string_view value);
	StringId intern(std::string_view value, bool tracked);
	const std::string& toString(StringId id) const;
	int codepointCount(StringId id) const;
	size_t trackedLuaHeapBytes() const { return m_trackLuaHeap ? m_trackedBytes : 0; }
	StringPoolState captureState() const;
	void restoreState(const StringPoolState& state);

	// Garbage-collection support. The pool is otherwise append-only, so without
	// reclamation the heap collector counts every runtime string ever interned
	// and churning unique strings (e.g. repeated hot-resume) leaks the tracked
	// Lua heap until OOM. Usage during a GC cycle: beginReachabilityEpoch() before
	// marking, markReachable(id) for every string reached from a live root, then
	// reclaimUnreachableTracked() after the sweep. Interned values/ids are kept
	// intact so ids stay valid and identical text re-interns to the same id; only
	// the tracked-heap accounting is reclaimed.
	void beginReachabilityEpoch();
	void markReachable(StringId id);
	void reclaimUnreachableTracked();

private:
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
	InternedString& insert(StringId id, std::string_view value);
	void insertEntry(std::unique_ptr<InternedString> entry);
	void trackStringEntry(InternedString& entry);
	StringId m_nextId = 0;
	bool m_trackLuaHeap = false;
	size_t m_trackedBytes = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	std::vector<std::unique_ptr<InternedString>> m_entries;
	std::vector<bool> m_reachable;
};

} // namespace bmsx
