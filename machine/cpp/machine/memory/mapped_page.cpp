#include "machine/memory/mapped_page.h"

namespace bmsx {

void MappedPageWriteWatches::invalidateWatchedWrite(
	size_t offset, size_t byteLength, u64 keyBase, MappedPageInvalidator* invalidator,
	size_t firstPage, size_t lastPage
) {
	u8* groups = reinterpret_cast<u8*>(m_storage.get());
	for (size_t page = firstPage; page <= lastPage; ++page) {
		if (groups[page] == 0u) continue;
		MappedPageWriteWatch watch{groups + page, m_words + page * MAPPED_PAGE_WATCH_GROUP_COUNT};
		const u32 firstByte = page == firstPage ? static_cast<u32>(offset & MAPPED_PAGE_BYTE_MASK) : 0u;
		const u32 endByte = page == lastPage
			? static_cast<u32>(((offset + byteLength - 1u) & MAPPED_PAGE_BYTE_MASK) + 1u)
			: MAPPED_PAGE_BYTE_SIZE;
		const u32 firstWord = firstByte >> 2u;
		const u32 endWord = (endByte + 3u) >> 2u;
		if (watch.consume(firstWord, endWord)) {
			invalidator->invalidateMappedWords(
				keyBase + page * MAPPED_PAGE_BYTE_SIZE, firstWord, endWord
			);
		}
	}
}

} // namespace bmsx
