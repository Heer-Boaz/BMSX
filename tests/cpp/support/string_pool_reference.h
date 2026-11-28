#pragma once

#include <optional>
#include <span>
#include <vector>

#include "machine/cpu/string_pool.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/image_format.h"
#include "heap_allocator_reference.h"
#include "lua_heap_reference.h"

namespace bmsx {
class CPU;
}

namespace bmsx::test {

struct LocalStringRoots {
	std::vector<StringId> ids;
	std::vector<size_t> bases;
};

// The native reference observes and mutates the stock firmware's String
// directory. The inherited physical record reads never need the directory.
class StringPoolReference : public StringPool {
public:
	explicit StringPoolReference(CPU& cpu, LocalStringRoots* roots = nullptr);
	StringPoolReference(const StringPoolReference&) = delete;
	StringPoolReference& operator=(const StringPoolReference&) = delete;
	LocalStringRoots& localRoots() { return m_externalRoots ? *m_externalRoots : m_ownedRoots; }
	StringId intern(std::string_view value);
	StringId intern(std::string_view value, u32 hash);
	std::optional<StringId> find(std::string_view value) const;
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
	friend struct StringSliceReference;
	static constexpr u32 BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08, EPOCH = 0x0c;
	static constexpr u32 FIRST_CART = 0x14, ROM_TABLES = 0x18;
	static constexpr u32 REHASH_BASE = 0x38, REHASH_READY = 0x3c;
	static constexpr u32 MAX_RAM_RECORDS = MAIN_RAM_SIZE / BLUA32_STRING_RECORD_HEADER_SIZE;
	// The bucket extent field includes the bit for the maximum RAM string count.
	static constexpr u32 RAM_BUCKET_EXTENT_MASK = 2u * MAX_RAM_RECORDS - 1u;
	static constexpr u32 RAM_BUCKET_REHASH = 0x80000000u, RAM_BUCKET_SHRINK = 0x40000000u;
	static constexpr u32 romStringId(u32 address, u32 cartridgeSlot) {
		return address >= CART_ROM_BASE ? address | (cartridgeSlot << BLUA32_STRING_ROM_SOCKET_SHIFT) : address;
	}

	struct InternKey {
		std::string_view head;
		std::span<const std::string_view> tail;
		size_t length;
		bool matches(ByteSpan candidate) const;
		static bool consumeEqual(ByteSpan& candidate, std::string_view prefix);
	};
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

	LocalStringRoots m_ownedRoots;
	LocalStringRoots* const m_externalRoots;
	HeapAllocator m_arena;
	LuaHeap m_heap;
	const u32 m_metadata, m_markWorkOffset;
};

} // namespace bmsx::test
