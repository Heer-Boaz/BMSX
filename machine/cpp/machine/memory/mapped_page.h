#pragma once

#include <algorithm>
#include <cstddef>
#include <vector>

#include "common/primitives.h"

namespace bmsx {

constexpr u32 MAPPED_PAGE_BYTE_SHIFT = 10u;
constexpr u32 MAPPED_PAGE_BYTE_SIZE = 1u << MAPPED_PAGE_BYTE_SHIFT;
constexpr u32 MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1u;

struct MappedPageBinding {
	u64 key;
	const u64* revision;
};

class MappedPageRevisions {
public:
	explicit MappedPageRevisions(size_t byteLength)
		: values((byteLength + MAPPED_PAGE_BYTE_SIZE - 1u) >> MAPPED_PAGE_BYTE_SHIFT) {}

	void touch(size_t offset, size_t byteLength) {
		if (byteLength == 0u) {
			return;
		}
		const size_t firstPage = offset >> MAPPED_PAGE_BYTE_SHIFT;
		const size_t lastPage = (offset + byteLength - 1u) >> MAPPED_PAGE_BYTE_SHIFT;
		const u64 revision = m_nextRevision++;
		if (firstPage == lastPage) {
			values[firstPage] = revision;
		} else {
			std::fill(
				values.begin() + static_cast<std::ptrdiff_t>(firstPage),
				values.begin() + static_cast<std::ptrdiff_t>(lastPage + 1u),
				revision
			);
		}
	}

	std::vector<u64> values;

private:
	u64 m_nextRevision = 1;
};

} // namespace bmsx
