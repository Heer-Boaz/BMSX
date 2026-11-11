#pragma once

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
public:
	static constexpr u32 GROUP_PAGE_SHIFT = 12u;
	static constexpr u32 GROUP_PAGES = 1u << GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_SHIFT = MAPPED_PAGE_BYTE_SHIFT + GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_ENTRIES = 1u << (ADDRESS_BITS - ROOT_SHIFT);
	struct Group {
		DecodedInstructionPage* pages[GROUP_PAGES]{};
	};
	using Root = Group* [ROOT_ENTRIES];

	NativeCodeLookup() = default;
	~NativeCodeLookup() { for (auto& bank : m_groups) for (auto* group : bank) delete group; }
	NativeCodeLookup(const NativeCodeLookup&) = delete;
	NativeCodeLookup& operator=(const NativeCodeLookup&) = delete;

	// Generated dispatch consumes this owner-defined raw index, not a host
	// container's private layout. A grant binds the physically selected bank.
	const Root& root(u32 slot) const { return m_groups[slot]; }

	DecodedInstructionPage* find(u32 pc, u32 slot) const {
		const auto& group = m_groups[slot][pc >> ROOT_SHIFT];
		return group ? group->pages[(pc >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u)] : nullptr;
	}

	// A continuation retains this owner slot, never a NativeBlockPage/code
	// allocation. Groups live until the execution image is destroyed. Installing
	// a previously absent page or replacing its translations updates this slot.
	DecodedInstructionPage* const* pageSlot(u32 pc, u32 slot) {
		auto& group = m_groups[slot][pc >> ROOT_SHIFT];
		if (!group) group = new Group;
		return &group->pages[(pc >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u)];
	}

	void install(u32 pageAddress, u32 slot, DecodedInstructionPage& page) {
		const u32 firstSlot = pageAddress < CART_ROM_BASE ? 0u : slot;
		const u32 endSlot = pageAddress < CART_ROM_BASE ? CARTRIDGE_SLOT_COUNT : slot + 1u;
		const u32 root = pageAddress >> ROOT_SHIFT;
		const u32 index = (pageAddress >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u);
		for (u32 bank = firstSlot; bank < endSlot; ++bank) {
			auto& group = m_groups[bank][root];
			if (!group) group = new Group;
			group->pages[index] = &page;
		}
	}

private:
	Root m_groups[CARTRIDGE_SLOT_COUNT]{};
};

} // namespace bmsx
