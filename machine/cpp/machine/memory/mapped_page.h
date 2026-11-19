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
	virtual void invalidateMappedViews(u64, u32, u32) {}
};

inline constexpr u32 MAPPED_WATCH_GROUP_BYTE_SHIFT = 7u;
inline constexpr u32 MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE >> MAPPED_WATCH_GROUP_BYTE_SHIFT;
static_assert(MAPPED_PAGE_WATCH_GROUP_COUNT <= 8u);

constexpr u32 mappedWatchWordMask(u32 group, u32 firstWord, u32 lastWord) {
	return (group == (firstWord >> 5u) ? 0xffffffffu << (firstWord & 31u) : 0xffffffffu)
		& (group == (lastWord >> 5u) ? 0xffffffffu >> (31u - (lastWord & 31u)) : 0xffffffffu);
}

constexpr u8 MAPPED_WATCH_CODE = 1;
constexpr u8 MAPPED_WATCH_VIEW = 2;

struct MappedPageWriteWatch {
	u8* groups = nullptr;
	u32* words = nullptr;
	u32* watchedPages = nullptr;
	u32* viewWords = nullptr;

	void armWord(u32 word) { arm(words, word); }
	void armViewWord(u32 word) { arm(viewWords, word); }

	u8 consume(u32 firstWord, u32 endWord, bool reportViews = true) {
		const u32 lastWord = endWord - 1u;
		u8 affected = 0;
		for (u32 group = firstWord >> 5u; group <= lastWord >> 5u; ++group) {
			const u32 bit = 1u << group;
			if ((*groups & bit) == 0u) continue;
			const u32 mask = mappedWatchWordMask(group, firstWord, lastWord);
			const u32 code = words[group];
			u32 views = viewWords ? viewWords[group] : 0u;
			if (code & mask) affected |= MAPPED_WATCH_CODE;
			words[group] = code & ~mask;
			if (reportViews && (views & mask)) {
				affected |= MAPPED_WATCH_VIEW;
				views &= ~mask;
				viewWords[group] = views;
			}
			if ((words[group] | views) == 0u) *groups &= static_cast<u8>(~bit);
		}
		if (affected && *groups == 0u) --*watchedPages;
		return affected;
	}

private:
	void arm(u32* bank, u32 word) {
		const u32 group = word >> 5u;
		bank[group] |= 1u << (word & 31u);
		if (*groups == 0u) ++*watchedPages;
		*groups |= static_cast<u8>(1u << group);
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
	bool anyWatched(size_t first, size_t length, bool includeViews = true) const {
		if (length == 0u) return false;
		const u8* groups = groupData();
		const size_t last = first + length - 1u;
		const size_t firstPage = first >> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >> MAPPED_PAGE_BYTE_SHIFT;
		for (size_t page = firstPage; page <= lastPage; ++page) {
			const u32 watchedGroups = groups[page];
			if (watchedGroups == 0u) continue;
			if (includeViews && page > firstPage && page < lastPage) return true;
			const u32 firstWord = page == firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >> 2u : 0u;
			const u32 lastWord = page == lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >> 2u : MAPPED_PAGE_BYTE_MASK >> 2u;
			const u32* words = m_words + page * MAPPED_PAGE_WATCH_GROUP_COUNT;
			for (u32 group = firstWord >> 5u; group <= lastWord >> 5u; ++group) {
				if ((watchedGroups & (1u << group)) == 0u) continue;
				u32 bits = words[group];
				if (includeViews && m_viewWords) bits |= m_viewWords[page * MAPPED_PAGE_WATCH_GROUP_COUNT + group];
				if (bits & mappedWatchWordMask(group, firstWord, lastWord)) return true;
			}
		}
		return false;
	}
	const u8* groupData() const { return reinterpret_cast<const u8*>(m_storage.get()); }
	const u32* codeWordMasks() const { return m_words; }
	const u32* viewWordMasks() const { return m_viewWords; }

	explicit MappedPageWriteWatches(size_t byteLength, bool watchViews = false) {
		// The byte group bank precedes aligned word masks in one allocation.
		const size_t pageCount = (byteLength + MAPPED_PAGE_BYTE_SIZE - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		const size_t groupWords = (pageCount + sizeof(u32) - 1u) / sizeof(u32);
		const size_t watchWords = pageCount * MAPPED_PAGE_WATCH_GROUP_COUNT;
		m_wordCount = groupWords + watchWords * (watchViews ? 2u : 1u);
		m_storage = std::make_unique<u32[]>(m_wordCount);
		m_words = m_storage.get() + groupWords;
		m_viewWords = watchViews ? m_words + watchWords : nullptr;
	}

	void bind(size_t offset, MappedPageBinding& out) {
		const size_t page = offset >> MAPPED_PAGE_BYTE_SHIFT;
		out.writeWatch = {
			reinterpret_cast<u8*>(m_storage.get()) + page,
			m_words + page * MAPPED_PAGE_WATCH_GROUP_COUNT,
			&m_watchedPages,
			m_viewWords ? m_viewWords + page * MAPPED_PAGE_WATCH_GROUP_COUNT : nullptr
		};
	}

	void armCodeRange(size_t first, size_t length);

	void clear() {
		std::fill_n(m_storage.get(), m_wordCount, 0u);
		m_watchedPages = 0;
	}

	void invalidateWrite(
		size_t offset,
		size_t byteLength,
		u64 keyBase,
		MappedPageInvalidator* invalidator,
		bool reportViews = true
	) {
		if (byteLength == 0u) {
			return;
		}
		const size_t firstPage = offset >> MAPPED_PAGE_BYTE_SHIFT;
		const size_t lastPage = (offset + byteLength - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage == lastPage && reinterpret_cast<const u8*>(m_storage.get())[firstPage] == 0u) return;
		invalidateWatchedWrite(offset, byteLength, keyBase, invalidator, firstPage, lastPage, reportViews);
	}

private:
	// Keep mask consumption and virtual invalidation out of ordinary RAM stores,
	// including under LTO: most data pages never contain decoded instructions.
	BMSX_NOINLINE
	void invalidateWatchedWrite(
		size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
		size_t firstPage, size_t lastPage, bool reportViews
	);
	std::unique_ptr<u32[]> m_storage;
	u32* m_words;
	u32* m_viewWords;
	size_t m_wordCount;
	u32 m_watchedPages = 0;
};

} // namespace bmsx
