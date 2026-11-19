#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "common/primitives.h"
#include "spec/blua32/execution_domain.h"

namespace bmsx {

using StringId = u32;
class HeapAllocator;
class LuaHeap;
class Memory;

// A String payload is the record's machine address. Cartridge ROM payloads
// carry their socket in bit 31, independently of the current bus selection.
class StringPool {
public:
	StringPool(LuaHeap& heap, Memory& memory, HeapAllocator& arena);
	StringId intern(std::string_view value);
	std::optional<StringId> find(std::string_view value) const;
	int byteLength(StringId id) const;
	u32 byteAt(StringId id, size_t index) const;
	void appendBytes(std::string& target, StringId id) const;
	std::string toString(StringId id) const;
	int compare(StringId left, StringId right) const;

	void clearRomTables();
	void activateRomTable(ExecutionDomainId domain, u32 address, u32 count);
	StringId resolveImageRecord(ExecutionDomainId domain, u32 address);

	void beginLocalRoots();
	void endLocalRoots();
	void beginReachabilityEpoch();
	void markReachable(StringId id);
	void markLocalRoots();
	size_t takeMarkWork();
	void beginSweep();
	size_t sweepStep(size_t allowance);
	bool sweeping() const;

private:
	struct ByteSpan {
		std::string_view first;
		std::string_view wrapped;
		size_t length;
		size_t backedLength() const { return first.size() + wrapped.size(); }
		u8 byteAt(size_t index) const {
			if (index < first.size()) return static_cast<u8>(first[index]);
			index -= first.size();
			return index < wrapped.size() ? static_cast<u8>(wrapped[index]) : 0u;
		}
	};
	Span<const u8> romStorage(u32 address) const;
	u32 readWord(u32 base, u32 displacement = 0) const;
	ByteSpan readBytes(StringId id) const;
	u32 metadata(u32 field) const;
	u32 ramBucketCount() const;
	void writeMetadata(u32 field, u32 word);
	u32 lookup(u32 buckets, u32 count, u32 hash, std::string_view bytes) const;
	u32 lookup(u32 hash, std::string_view bytes) const;
	void grow(u32 count);
	bool mark(StringId id);
	StringId retain(StringId id);

	LuaHeap& m_heap;
	Memory& m_memory;
	HeapAllocator& m_arena;
	const u32 m_metadata;
	std::vector<StringId> m_localRoots;
	std::vector<size_t> m_localRootBases;
	size_t m_markWork = 0; // Collected before a GC step yields.
};

int compareStringIds(const StringPool* pool, StringId left, StringId right, int* remainingCycles);

} // namespace bmsx
