#include "machine/runtime/history/ram_history.h"

#include "machine/memory/memory.h"

#include <cstring>

namespace bmsx {

u32 RamHistory::allocate() {
	if (m_firstFree == 0u) {
		const auto first = static_cast<u32>(m_slabs.size() * slabPages + 1u);
		auto slab = std::unique_ptr<Page[]>(new Page[slabPages]);
		for (size_t i = 0; i + 1 < slabPages; ++i) slab[i].nextFree = first + i + 1;
		slab[slabPages - 1].nextFree = 0u;
		m_slabs.push_back(std::move(slab));
		m_firstFree = first;
	}
	const auto id = m_firstFree;
	auto& entry = page(id);
	m_firstFree = entry.nextFree;
	entry.references = 1u;
	return id;
}

void RamHistory::release(u32 id) {
	if (id == 0u) return;
	auto& entry = page(id);
	if (--entry.references != 0u) return;
	entry.nextFree = m_firstFree;
	m_firstFree = id;
}

void RamHistory::capture(Memory& memory, const PageMap* baseline, PageMap& destination) {
	auto& watches = memory.ramWriteWatches();
	const size_t ramBytes = memory.ramByteCount();
	destination.resize((ramBytes + pageBytes - 1u) / pageBytes);
	for (size_t index = 0; index < destination.size(); ++index) {
		auto& id = destination[index];
		const size_t offset = index * pageBytes;
		const size_t length = std::min(pageBytes, ramBytes - offset);
		if (baseline && !watches.historyPageDirty(offset >> MAPPED_PAGE_BYTE_SHIFT,
			(offset + length + MAPPED_PAGE_BYTE_MASK) >> MAPPED_PAGE_BYTE_SHIFT)) {
			const auto shared = (*baseline)[index];
			if (id != shared) {
				++page(shared).references;
				release(id);
				id = shared;
			}
		} else {
			release(id);
			id = allocate();
			std::memcpy(page(id).bytes.data(), memory.ramData() + offset, length);
		}
	}
	watches.armHistoryWrites();
}

void RamHistory::restore(Memory& memory, const PageMap& baseline, const PageMap& source) const {
	auto& watches = memory.ramWriteWatches();
	const size_t ramBytes = memory.ramByteCount();
	for (size_t index = 0; index < source.size(); ++index) {
		const size_t offset = index * pageBytes;
		const size_t length = std::min(pageBytes, ramBytes - offset);
		if (baseline[index] != source[index] || watches.historyPageDirty(offset >> MAPPED_PAGE_BYTE_SHIFT,
			(offset + length + MAPPED_PAGE_BYTE_MASK) >> MAPPED_PAGE_BYTE_SHIFT))
			std::memcpy(memory.ramData() + offset, page(source[index]).bytes.data(), length);
	}
	watches.armHistoryWrites();
}

void RamHistory::clear() {
	m_slabs.clear();
	m_firstFree = 0;
}

} // namespace bmsx
