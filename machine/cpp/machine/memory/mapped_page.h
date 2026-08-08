#pragma once

#include <cstddef>
#include <vector>

#include "common/primitives.h"

namespace bmsx {

constexpr u32 MAPPED_PAGE_BYTE_SHIFT = 10u;
constexpr u32 MAPPED_PAGE_BYTE_SIZE = 1u << MAPPED_PAGE_BYTE_SHIFT;
constexpr u32 MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1u;

class MappedPageInvalidator {
public:
	virtual ~MappedPageInvalidator() = default;
	virtual void invalidateMappedPage(u64 key) = 0;
	virtual void invalidateMappedRange(u64 firstKey, u64 endKey) = 0;
};

struct MappedPageBinding {
	u64 key;
	bool cacheable;
	u8* writeWatch;
};

class MappedPageWriteWatches {
public:
	explicit MappedPageWriteWatches(size_t byteLength)
		: m_values((byteLength + MAPPED_PAGE_BYTE_SIZE - 1u) >> MAPPED_PAGE_BYTE_SHIFT) {}

	void bind(size_t offset, MappedPageBinding& out) {
		out.writeWatch = &m_values[offset >> MAPPED_PAGE_BYTE_SHIFT];
	}

	void clear() {
		for (u8& value : m_values) {
			value = 0u;
		}
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
		if (firstPage == lastPage) {
			if (m_values[firstPage] != 0u) {
				m_values[firstPage] = 0u;
				invalidator->invalidateMappedPage(
					keyBase + firstPage * MAPPED_PAGE_BYTE_SIZE
				);
			}
			return;
		}
		for (size_t page = firstPage; page <= lastPage; ++page) {
			if (m_values[page] != 0u) {
				m_values[page] = 0u;
				invalidator->invalidateMappedPage(
					keyBase + page * MAPPED_PAGE_BYTE_SIZE
				);
			}
		}
	}

private:
	std::vector<u8> m_values;
};

} // namespace bmsx
