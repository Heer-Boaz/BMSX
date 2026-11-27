#include "machine/memory/mapped_page.h"

#include <bit>

namespace bmsx {

void MappedPageWriteWatches::watchByte(u32 offset) {
	const u32 page = offset >> MAPPED_PAGE_BYTE_SHIFT, byte = offset & MAPPED_PAGE_BYTE_MASK;
	const auto [pageEntry, added] = m_bytePages.try_emplace(page);
	auto& watched = pageEntry->second;
	if (added) {
		if (!m_byteMaskPages) {
			m_byteMaskDirectory = std::make_unique<const u32*[]>(m_pageCount);
			m_byteMaskPages = m_byteMaskDirectory.get();
		}
		// unordered_map rehash changes iterators, not stored mask addresses.
		m_byteMaskPages[page] = watched.masks.data();
	}
	auto& bits = watched.masks[byte >> 5u];
	const u32 bit = 1u << (byte & 31u);
	if (bits & bit) return;
	bits |= bit;
	++watched.count;
	m_groups[page] |= MAPPED_WATCH_PHYSICAL_BYTES;
}

void MappedPageWriteWatches::unwatchByte(u32 offset) {
	const u32 page = offset >> MAPPED_PAGE_BYTE_SHIFT, byte = offset & MAPPED_PAGE_BYTE_MASK;
	auto found = m_bytePages.find(page);
	auto& watched = found->second;
	watched.masks[byte >> 5u] &= ~(1u << (byte & 31u));
	if (--watched.count == 0u) {
		m_groups[page] &= ~MAPPED_WATCH_PHYSICAL_BYTES;
		m_byteMaskPages[page] = nullptr;
		m_bytePages.erase(found);
	}
}

void MappedPageWriteWatches::detachByteWriteObserver() {
	for (const auto& [page, watched] : m_bytePages) {
		m_groups[page] &= ~MAPPED_WATCH_PHYSICAL_BYTES;
		m_byteMaskPages[page] = nullptr;
	}
	m_bytePages.clear();
	m_observer = nullptr;
	m_observerContext = nullptr;
}

void MappedPageWriteWatches::notifyByteWrites(u32 page, u32 firstByte, u32 endByte) {
	const u32 lastByte = endByte - 1u;
	for (u32 group = firstByte >> 5u; group <= lastByte >> 5u; ++group) {
		// The observer may remove the exact watch being notified, including
		// the last watch on this page. Never retain a reference across it.
		if ((m_groups[page] & MAPPED_WATCH_PHYSICAL_BYTES) == 0u) return;
		u32 hits = m_byteMaskPages[page][group] & mappedWatchWordMask(group, firstByte, lastByte);
		while (hits != 0u) {
			const u32 byte = (group << 5u) + std::countr_zero(hits);
			hits &= hits - 1u;
			m_observer(m_observerContext, (page << MAPPED_PAGE_BYTE_SHIFT) + byte);
		}
	}
}

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
		m_groups[page] &= ~MAPPED_WATCH_HISTORY_CLEAN;
	m_historyEpoch &= ~1u;
}

void MappedPageWriteWatches::consumeHistoryWrites(size_t offset, size_t byteLength) {
	if (byteLength == 0) return;
	const size_t lastPage = (offset + byteLength - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
	for (size_t page = offset >> MAPPED_PAGE_BYTE_SHIFT; page <= lastPage; ++page)
		m_groups[page] &= ~MAPPED_WATCH_HISTORY_CLEAN;
}

void MappedPageWriteWatches::invalidateWatchedWrite(
	size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
	size_t firstPage, size_t lastPage, bool codeVisible
) {
	for (size_t page = firstPage; page <= lastPage; ++page) {
		auto& groups = m_groups[page];
		if (groups & MAPPED_WATCH_HISTORY_CLEAN) groups &= ~MAPPED_WATCH_HISTORY_CLEAN;
		const bool codeWatched = codeVisible && (groups & MAPPED_WATCH_GROUP_MASK) != 0u;
		const bool bytesWatched = (groups & MAPPED_WATCH_PHYSICAL_BYTES) != 0u;
		if (!codeWatched && !bytesWatched) continue;
		const u32 firstByte = page == firstPage ? static_cast<u32>(offset & MAPPED_PAGE_BYTE_MASK) : 0u;
		const u32 endByte = page == lastPage
			? static_cast<u32>(((offset + byteLength - 1u) & MAPPED_PAGE_BYTE_MASK) + 1u)
			: MAPPED_PAGE_BYTE_SIZE;
		if (bytesWatched) notifyByteWrites(static_cast<u32>(page), firstByte, endByte);
		if (!codeWatched) continue;
		const auto base = page * MAPPED_PAGE_WATCH_GROUP_COUNT;
		MappedPageWriteWatch watch{&groups, m_words.get() + base, &m_watchedPages};
		const u32 firstWord = firstByte >> 2u;
		const u32 endWord = (endByte + 3u) >> 2u;
		if (watch.consume(firstWord, endWord))
			invalidator->invalidateMappedWords(keyBase + page * MAPPED_PAGE_BYTE_SIZE, firstWord, endWord);
	}
}

} // namespace bmsx
