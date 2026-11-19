#pragma once

#include "common/primitives.h"

#include <array>
#include <memory>
#include <vector>

namespace bmsx {

class Memory;

// Each checkpoint owns a complete page map, not a chain of byte deltas.
// Immutable versions can be shared across both ring eviction and branches.
class RamHistory {
public:
	using PageMap = std::vector<u32>;
	void capture(Memory& memory, const PageMap* baseline, PageMap& destination);
	void restore(Memory& memory, const PageMap& baseline, const PageMap& source) const;
	void clear();

private:
	static constexpr size_t pageBytes = 4096;
	static constexpr size_t slabPages = 16;
	struct Page {
		std::array<u8, pageBytes> bytes;
		u32 references;
		u32 nextFree;
	};

	Page& page(u32 id) { return m_slabs[(id - 1) / slabPages][(id - 1) % slabPages]; }
	const Page& page(u32 id) const { return m_slabs[(id - 1) / slabPages][(id - 1) % slabPages]; }
	u32 allocate();
	void release(u32 id);

	std::vector<std::unique_ptr<Page[]>> m_slabs;
	u32 m_firstFree = 0;
};

} // namespace bmsx
