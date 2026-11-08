#pragma once

#include <algorithm>
#include <cstddef>
#include <memory>

#include "common/primitives.h"

namespace bmsx {

constexpr u32 MAPPED_PAGE_BYTE_SHIFT = 10u;
constexpr u32 MAPPED_PAGE_BYTE_SIZE = 1u << MAPPED_PAGE_BYTE_SHIFT;
constexpr u32 MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1u;

class MappedPageInvalidator {
public:
	virtual ~MappedPageInvalidator() = default;
	virtual void invalidateMappedWords(u64 key, u32 firstWord, u32 endWord) = 0;
	virtual void invalidateMappedRange(u64 firstKey, u64 endKey) = 0;
};

inline constexpr u32 MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4u * 32u);
static_assert(MAPPED_PAGE_WATCH_GROUP_COUNT <= 8u);

struct MappedPageWriteWatch {
	u8* groups = nullptr;
	u32* words = nullptr;

	void armWord(u32 word) {
		const u32 group = word >> 5u;
		words[group] |= 1u << (word & 31u);
		*groups |= static_cast<u8>(1u << group);
	}

	bool consume(u32 firstWord, u32 endWord) {
		if (endWord == firstWord + 1u) {
			const u32 group = firstWord >> 5u;
			const u32 bit = 1u << (firstWord & 31u);
			const u32 watched = words[group];
			if ((watched & bit) == 0u) return false;
			const u32 remaining = watched & ~bit;
			words[group] = remaining;
			if (remaining == 0u) *groups &= static_cast<u8>(~(1u << group));
			return true;
		}
		const u32 firstGroup = firstWord >> 5u;
		const u32 lastGroup = (endWord - 1u) >> 5u;
		bool affected = false;
		for (u32 group = firstGroup; group <= lastGroup; ++group) {
			const u32 groupBit = 1u << group;
			if ((*groups & groupBit) == 0u) continue;
			const u32 mask = (group == firstGroup ? 0xffffffffu << (firstWord & 31u) : 0xffffffffu)
				& (group == lastGroup ? 0xffffffffu >> (31u - ((endWord - 1u) & 31u)) : 0xffffffffu);
			const u32 watched = words[group];
			affected |= (watched & mask) != 0u;
			const u32 remaining = watched & ~mask;
			words[group] = remaining;
			if (remaining == 0u) *groups &= static_cast<u8>(~groupBit);
		}
		return affected;
	}
};

struct MappedPageBinding {
	u64 key;
	bool cacheable;
	const u8* readBytes;
	MappedPageWriteWatch writeWatch;
};

class MappedPageWriteWatches {
public:
	explicit MappedPageWriteWatches(size_t byteLength) {
		// The byte group bank precedes aligned word masks in one allocation.
		const size_t pageCount = (byteLength + MAPPED_PAGE_BYTE_SIZE - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		const size_t groupWords = (pageCount + sizeof(u32) - 1u) / sizeof(u32);
		m_wordCount = groupWords + pageCount * MAPPED_PAGE_WATCH_GROUP_COUNT;
		m_storage = std::make_unique<u32[]>(m_wordCount);
		m_words = m_storage.get() + groupWords;
	}

	void bind(size_t offset, MappedPageBinding& out) {
		const size_t page = offset >> MAPPED_PAGE_BYTE_SHIFT;
		out.writeWatch = {
			reinterpret_cast<u8*>(m_storage.get()) + page,
			m_words + page * MAPPED_PAGE_WATCH_GROUP_COUNT
		};
	}

	void clear() {
		std::fill_n(m_storage.get(), m_wordCount, 0u);
	}

	void invalidateWrite(
		size_t offset,
		size_t byteLength,
		u64 keyBase,
		MappedPageInvalidator* invalidator
	) {
		if (byteLength == 0u) {
			return;
		}
		const size_t firstPage = offset >> MAPPED_PAGE_BYTE_SHIFT;
		const size_t lastPage = (offset + byteLength - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage == lastPage && reinterpret_cast<const u8*>(m_storage.get())[firstPage] == 0u) return;
		invalidateWatchedWrite(offset, byteLength, keyBase, invalidator, firstPage, lastPage);
	}

private:
	// Keep mask consumption and virtual invalidation out of ordinary RAM stores,
	// including under LTO: most data pages never contain decoded instructions.
#if defined(__GNUC__) || defined(__clang__)
	[[gnu::noinline]]
#endif
	void invalidateWatchedWrite(
		size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
		size_t firstPage, size_t lastPage
	);
	std::unique_ptr<u32[]> m_storage;
	u32* m_words;
	size_t m_wordCount;
};

} // namespace bmsx
