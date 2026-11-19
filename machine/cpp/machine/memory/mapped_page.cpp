#include "machine/memory/mapped_page.h"

namespace bmsx {

void MappedPageWriteWatches::armCodeRange(size_t first, size_t length) {
	const size_t last = first + length - 1u;
	const size_t firstPage = first >> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >> MAPPED_PAGE_BYTE_SHIFT;
	for (size_t page = firstPage; page <= lastPage; ++page) {
		const u32 begin = page == firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >> 2u : 0u;
		const u32 end = page == lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >> 2u : MAPPED_PAGE_BYTE_MASK >> 2u;
		if ((m_groups[page] & MAPPED_WATCH_GROUP_MASK) == 0u) ++m_watchedPages;
		for (u32 group = begin >> 5u; group <= end >> 5u; ++group) {
			m_groups[page] |= 1u << group;
			m_words[page * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= mappedWatchWordMask(group, begin, end);
		}
	}
}

void MappedPageWriteWatches::clearCodeRange(size_t first, size_t length) {
	const size_t last = first + length - 1u;
	const size_t firstPage = first >> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >> MAPPED_PAGE_BYTE_SHIFT;
	for (size_t page = firstPage; page <= lastPage; ++page) {
		const u32 begin = page == firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >> 2u : 0u;
		const u32 end = page == lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >> 2u : MAPPED_PAGE_BYTE_MASK >> 2u;
		const size_t base = page * MAPPED_PAGE_WATCH_GROUP_COUNT;
		MappedPageWriteWatch watch{m_groups.get() + page, m_words.get() + base, &m_watchedPages};
		watch.consume(begin, end + 1u);
	}
}

bool MappedPageWriteWatches::historyPageDirty(size_t firstPage, size_t endPage) const {
	for (size_t page = firstPage; page < endPage; ++page)
		if ((m_groups[page] & MAPPED_WATCH_HISTORY_CLEAN) == 0u) return true;
	return false;
}

void MappedPageWriteWatches::armHistoryWrites() {
	for (size_t page = 0; page < m_pageCount; ++page)
		m_groups[page] |= MAPPED_WATCH_HISTORY_CLEAN;
	m_historyEpoch = (m_historyEpoch + 2u) | 1u;
}

void MappedPageWriteWatches::disarmHistoryWrites() {
	for (size_t page = 0; page < m_pageCount; ++page)
		m_groups[page] &= MAPPED_WATCH_GROUP_MASK;
	m_historyEpoch &= ~1u;
}

void MappedPageWriteWatches::consumeHistoryWrites(size_t offset, size_t byteLength) {
	if (byteLength == 0) return;
	const size_t lastPage = (offset + byteLength - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
	for (size_t page = offset >> MAPPED_PAGE_BYTE_SHIFT; page <= lastPage; ++page)
		m_groups[page] &= MAPPED_WATCH_GROUP_MASK;
}

void MappedPageWriteWatches::invalidateWatchedWrite(
	size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
	size_t firstPage, size_t lastPage
) {
	for (size_t page = firstPage; page <= lastPage; ++page) {
		auto& groups = m_groups[page];
		if (groups & MAPPED_WATCH_HISTORY_CLEAN) groups &= MAPPED_WATCH_GROUP_MASK;
		if ((groups & MAPPED_WATCH_GROUP_MASK) == 0u) continue;
		const auto base = page * MAPPED_PAGE_WATCH_GROUP_COUNT;
		MappedPageWriteWatch watch{&groups, m_words.get() + base, &m_watchedPages};
		const u32 firstByte = page == firstPage ? static_cast<u32>(offset & MAPPED_PAGE_BYTE_MASK) : 0u;
		const u32 endByte = page == lastPage
			? static_cast<u32>(((offset + byteLength - 1u) & MAPPED_PAGE_BYTE_MASK) + 1u)
			: MAPPED_PAGE_BYTE_SIZE;
		const u32 firstWord = firstByte >> 2u;
		const u32 endWord = (endByte + 3u) >> 2u;
		if (watch.consume(firstWord, endWord))
			invalidator->invalidateMappedWords(keyBase + page * MAPPED_PAGE_BYTE_SIZE, firstWord, endWord);
	}
}

} // namespace bmsx
