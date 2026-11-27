#pragma once

#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "common/primitives.h"
#include "spec/blua32/execution_domain.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

using StringId = u32;
inline constexpr bool isRamStringId(StringId address) { return address >= RAM_BASE && address < CART_ROM_BASE; }
inline constexpr u8 STRING_GC_EPOCH_MASK = 1u;
class HeapAllocator;
class LuaHeap;
class Memory;
namespace test { struct StringSliceReference; }

// A String payload is the record's machine address. Cartridge ROM payloads
// carry their socket in bit 31, independently of the current bus selection.
class StringPool {
public:
	StringPool(LuaHeap& heap, Memory& memory, HeapAllocator& arena);
	StringId intern(std::string_view value);
	StringId intern(std::string_view value, u32 hash);
	std::optional<StringId> find(std::string_view value) const;
	int byteLength(StringId id) const;
	u32 byteAt(StringId id, size_t index) const;
	void appendBytes(std::string& target, StringId id) const;
	void appendBytes(std::string& target, StringId id, size_t offset, size_t count) const;
	std::string toString(StringId id) const;
	int compareBytes(StringId left, StringId right, size_t offset, size_t count) const;

	void clearRomTables();
	void activateRomTable(ExecutionDomainId domain, u32 address, u32 count);
	StringId resolveImageRecord(ExecutionDomainId domain, u32 address);

	void beginLocalRoots();
	void endLocalRoots();
	void beginReachabilityEpoch();
	void markReachable(StringId id);
	void markLocalRoots();
	size_t takeMarkWork();
	void resumeMarkWork(u32 work);
	void beginSweep();
	u32 estimateSweepWork() const;
	size_t sweepStep(size_t allowance);
	bool sweeping() const;

private:
	friend struct test::StringSliceReference;
	struct ByteSpan {
		std::string_view first;
		std::string_view wrapped;
		size_t size() const { return first.size() + wrapped.size(); }
		// Compare and advance over a prefix of this two-extent payload.
		bool consumeEqual(std::string_view prefix);
	};
	struct InternKey {
		std::string_view head;
		std::span<const std::string_view> tail;
		size_t length;
		bool matches(ByteSpan candidate) const;
	};
	Span<const u8> romStorage(u32 address) const;
	u32 readWord(u32 base, u32 displacement = 0) const;
	ByteSpan readBytes(StringId id, size_t offset, size_t count) const;
	u32 metadata(u32 field) const;
	void writeMetadata(u32 field, u32 word);
	Span<const u8> bindRomStringHeader(u32 address, u32 cartridgeSlot) const;
	std::string_view bindRomStringBytes(u32 address, u32 cartridgeSlot, u32 length) const;
	u32 lookupRamChain(u32 bucket, u32 hash, const InternKey& bytes) const;
	u32 lookupRam(u32 hash, const InternKey& bytes) const;
	u32 lookupRom(u32 directory, u32 hash, const InternKey& bytes) const;
	u32 lookup(u32 hash, const InternKey& bytes) const;
	StringId insert(const ByteSpan& bytes, u32 hash, StringId source);
	size_t rehashStep(u32 oldCount, u32 nextBase, size_t allowance);
	size_t shrinkStep(u32 oldCount, size_t allowance);
	bool mark(StringId id);
	StringId retain(StringId id);

	LuaHeap& m_heap;
	Memory& m_memory;
	HeapAllocator& m_arena;
	const u32 m_metadata, m_markWorkOffset;
	std::vector<StringId> m_localRoots;
	std::vector<size_t> m_localRootBases;
};

} // namespace bmsx
