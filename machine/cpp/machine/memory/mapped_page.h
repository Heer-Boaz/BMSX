#pragma once

#include "common/compiler.h"

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

inline constexpr u32 MAPPED_WATCH_GROUP_BYTE_SHIFT = 7u;
inline constexpr u32 MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE >> MAPPED_WATCH_GROUP_BYTE_SHIFT;
static_assert(MAPPED_PAGE_WATCH_GROUP_COUNT <= 8u);

constexpr u32 mappedWatchWordMask(u32 group, u32 firstWord, u32 lastWord) {
	return (group == (firstWord >> 5u) ? 0xffffffffu << (firstWord & 31u) : 0xffffffffu)
		& (group == (lastWord >> 5u) ? 0xffffffffu >> (31u - (lastWord & 31u)) : 0xffffffffu);
}

constexpr u32 MAPPED_WATCH_GROUP_MASK = (1u << MAPPED_PAGE_WATCH_GROUP_COUNT) - 1u;
// The first physical write consumes this bit, independently of code watches.
constexpr u32 MAPPED_WATCH_HISTORY_CLEAN = 1u << MAPPED_PAGE_WATCH_GROUP_COUNT;

constexpr u32 mappedWatchGroupRange(u32 first, u32 last) {
	return (2u << last) - (1u << first);
}

struct MappedPageWriteWatch {
	u32* groups = nullptr;
	u32* words = nullptr;
	u32* watchedPages = nullptr;

	void armWord(u32 word) {
		const u32 group = word >> 5u;
		words[group] |= 1u << (word & 31u);
		if ((*groups & MAPPED_WATCH_GROUP_MASK) == 0u) ++*watchedPages;
		*groups |= 1u << group;
	}

	bool consume(u32 firstWord, u32 endWord) {
		const u32 lastWord = endWord - 1u;
		bool affected = false;
		for (u32 group = firstWord >> 5u; group <= lastWord >> 5u; ++group) {
			const u32 bit = 1u << group;
			if ((*groups & bit) == 0u) continue;
			const u32 hit = words[group] & mappedWatchWordMask(group, firstWord, lastWord);
			if (hit == 0u) continue;
			affected = true;
			words[group] ^= hit;
			if (words[group] == 0u) *groups &= ~bit;
		}
		if (affected && (*groups & MAPPED_WATCH_GROUP_MASK) == 0u) --*watchedPages;
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
	bool anyWatched() const { return m_watchedPages != 0u; }
	bool anyWatched(size_t first, size_t length) const {
		if (length == 0u) return false;
		const size_t last = first + length - 1u;
		const size_t firstPage = first >> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >> MAPPED_PAGE_BYTE_SHIFT;
		for (size_t page = firstPage; page <= lastPage; ++page) {
			const u32 flags = m_groups[page];
			const u32 watchedGroups = flags & MAPPED_WATCH_GROUP_MASK;
			if (watchedGroups == 0u) continue;
			if (page > firstPage && page < lastPage) return true;
			const u32 firstWord = page == firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >> 2u : 0u;
			const u32 lastWord = page == lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >> 2u : MAPPED_PAGE_BYTE_MASK >> 2u;
			for (u32 group = firstWord >> 5u; group <= lastWord >> 5u; ++group) {
				if ((watchedGroups & (1u << group)) == 0u) continue;
				const u32 bits = m_words[page * MAPPED_PAGE_WATCH_GROUP_COUNT + group];
				if (bits & mappedWatchWordMask(group, firstWord, lastWord)) return true;
			}
		}
		return false;
	}
	const u32* groupData() const { return m_groups.get(); }
	const u32* codeWordMasks() const { return m_words.get(); }

	explicit MappedPageWriteWatches(size_t byteLength) {
		m_pageCount = (byteLength + MAPPED_PAGE_BYTE_SIZE - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		m_wordCount = m_pageCount * MAPPED_PAGE_WATCH_GROUP_COUNT;
		m_groups = std::make_unique<u32[]>(m_pageCount);
		m_words = std::make_unique<u32[]>(m_wordCount);
	}

	void bind(size_t offset, MappedPageBinding& out) {
		const size_t page = offset >> MAPPED_PAGE_BYTE_SHIFT;
		out.writeWatch = {
			m_groups.get() + page,
			m_words.get() + page * MAPPED_PAGE_WATCH_GROUP_COUNT,
			&m_watchedPages
		};
	}

	void armCodeRange(size_t first, size_t length);
	void clearCodeRange(size_t first, size_t length);

	void clear() {
		for (size_t page = 0; page < m_pageCount; ++page)
			m_groups[page] &= MAPPED_WATCH_HISTORY_CLEAN;
		std::fill_n(m_words.get(), m_wordCount, 0u);
		m_watchedPages = 0;
	}

	bool historyPageDirty(size_t firstPage, size_t endPage) const;
	void armHistoryWrites();
	void disarmHistoryWrites();
	void consumeHistoryWrites(size_t offset, size_t byteLength);
	// The low bit enables tracking. A new epoch re-arms native register windows.
	u32 historyEpoch() const { return m_historyEpoch; }

	void invalidateWrite(
		size_t offset,
		size_t byteLength,
		u64 keyBase,
		MappedPageInvalidator* invalidator
	) {
		if (byteLength == 0u) {
			return;
		}
		const size_t last = offset + byteLength - 1u;
		const size_t firstPage = offset >> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage == lastPage) {
			const u32 flags = m_groups[firstPage];
			if (flags == 0u) return;
			if ((flags & MAPPED_WATCH_HISTORY_CLEAN) == 0u) {
				const u32 firstWord = (offset & MAPPED_PAGE_BYTE_MASK) >> 2u, lastWord = (last & MAPPED_PAGE_BYTE_MASK) >> 2u;
				const u32 firstGroup = firstWord >> 5u, lastGroup = lastWord >> 5u;
				if (firstGroup == lastGroup) {
					const u32 mask = mappedWatchWordMask(firstGroup, firstWord, lastWord);
					if ((m_words[firstPage * MAPPED_PAGE_WATCH_GROUP_COUNT + firstGroup] & mask) == 0u) return;
				} else if (((flags & MAPPED_WATCH_GROUP_MASK) & mappedWatchGroupRange(firstGroup, lastGroup)) == 0u) {
					return;
				}
			}
		}
		invalidateWatchedWrite(offset, byteLength, keyBase, invalidator, firstPage, lastPage);
	}

private:
	// Keep mask consumption and virtual invalidation out of ordinary RAM stores,
	// including under LTO: most data pages never contain decoded instructions.
	BMSX_NOINLINE
	void invalidateWatchedWrite(
		size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
		size_t firstPage, size_t lastPage
	);
	std::unique_ptr<u32[]> m_groups;
	std::unique_ptr<u32[]> m_words;
	size_t m_wordCount;
	size_t m_pageCount;
	u32 m_watchedPages = 0;
	u32 m_historyEpoch = 0;
};

} // namespace bmsx
