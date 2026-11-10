#pragma once

#include <array>
#include <memory>

#include "common/primitives.h"
#include "machine/memory/mapped_page.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

struct DecodedInstructionPage;

// A sparse index into execution-image-owned decoded pages, not another code
// cache. Retiring a body leaves its page and this index intact. Each socket has
// its own cartridge window; system ROM and main RAM are indexed in both banks.
class NativeCodeLookup {
	static constexpr u32 GROUP_PAGE_SHIFT = 12u;
	static constexpr u32 GROUP_PAGES = 1u << GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_SHIFT = MAPPED_PAGE_BYTE_SHIFT + GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_ENTRIES = 1u << (ADDRESS_BITS - ROOT_SHIFT);
	struct Group {
		std::array<DecodedInstructionPage*, GROUP_PAGES> pages{};
	};
	std::array<std::array<std::unique_ptr<Group>, ROOT_ENTRIES>, CARTRIDGE_SLOT_COUNT> m_groups{};

public:
	DecodedInstructionPage* find(u32 pc, u32 slot) const {
		const auto& group = m_groups[slot][pc >> ROOT_SHIFT];
		return group ? group->pages[(pc >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u)] : nullptr;
	}

	void install(u32 pageAddress, u32 slot, DecodedInstructionPage& page) {
		const u32 firstSlot = pageAddress < CART_ROM_BASE ? 0u : slot;
		const u32 endSlot = pageAddress < CART_ROM_BASE ? CARTRIDGE_SLOT_COUNT : slot + 1u;
		const u32 root = pageAddress >> ROOT_SHIFT;
		const u32 index = (pageAddress >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u);
		for (u32 bank = firstSlot; bank < endSlot; ++bank) {
			auto& group = m_groups[bank][root];
			if (!group) group = std::make_unique<Group>();
			group->pages[index] = &page;
		}
	}
};

} // namespace bmsx
