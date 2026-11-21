#pragma once

#include "common/primitives.h"
#include "machine/memory/mapped_page.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

struct DecodedInstructionPage;

// Execution-image-owned dispatch cells. Translation descriptors/allocations
// can retire independently; their cells are withdrawn before code is freed.
class NativeCodeLookup {
public:
	static constexpr u32 GROUP_PAGE_SHIFT = 12u;
	static constexpr u32 GROUP_PAGES = 1u << GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_SHIFT = MAPPED_PAGE_BYTE_SHIFT + GROUP_PAGE_SHIFT;
	static constexpr u32 ROOT_ENTRIES = 1u << (ADDRESS_BITS - ROOT_SHIFT);
	static constexpr u32 CART_ROOT = CART_ROM_BASE >> ROOT_SHIFT;
	static_assert((CART_ROM_BASE & ((1u << ROOT_SHIFT) - 1u)) == 0u);
	struct DispatchPage {
		void* code[MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES]{};
		DecodedInstructionPage* decoded = nullptr;
	};
	struct Group {
		DispatchPage* pages[GROUP_PAGES]{};
		~Group() { for (auto* page : pages) delete page; }
	};
	using Root = Group* [ROOT_ENTRIES];

	NativeCodeLookup() = default;
	~NativeCodeLookup() {
		// Shared-memory groups are aliased in every bank, owned by bank zero.
		for (u32 bank = 0; bank < CARTRIDGE_SLOT_COUNT; ++bank)
			for (u32 root = bank == 0 ? 0u : CART_ROOT; root < ROOT_ENTRIES; ++root)
				delete m_groups[bank][root];
	}
	NativeCodeLookup(const NativeCodeLookup&) = delete;
	NativeCodeLookup& operator=(const NativeCodeLookup&) = delete;

	const Root& root(u32 slot) const { return m_groups[slot]; }

	DecodedInstructionPage* find(u32 pc, u32 slot) const {
		return findInRoot(m_groups[slot], pc);
	}

	static DecodedInstructionPage* findInRoot(Group* const* root, u32 pc) {
		const auto* page = pageInRoot(root, pc);
		return page ? page->decoded : nullptr;
	}

	// Borrow an installed cell without allocating or admitting an unaligned
	// instruction fetch. Its contents may be null after code retirement.
	static void* const* findEntryCellInRoot(Group* const* root, u32 pc) {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) return nullptr;
		const auto* page = pageInRoot(root, pc);
		return page ? &page->code[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] : nullptr;
	}

	// A cold continuation can reserve its zero cell without fetching/decoding
	// guest memory. Later publication updates this same image-lifetime address.
	void** entrySlot(u32 pc, u32 slot) {
		return &dispatchPage(pc, slot).code[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	}

	void** install(u32 pageAddress, u32 slot, DecodedInstructionPage& decoded) {
		auto& page = dispatchPage(pageAddress, slot);
		page.decoded = &decoded;
		return page.code;
	}

private:
	static const DispatchPage* pageInRoot(Group* const* root, u32 pc) {
		const auto* group = root[pc >> ROOT_SHIFT];
		return group ? group->pages[(pc >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u)] : nullptr;
	}

	DispatchPage& dispatchPage(u32 pc, u32 slot) {
		const bool shared = pc < CART_ROM_BASE;
		const u32 root = pc >> ROOT_SHIFT;
		auto& group = m_groups[shared ? 0u : slot][root];
		if (!group) {
			group = new Group;
			if (shared) for (u32 bank = 1; bank < CARTRIDGE_SLOT_COUNT; ++bank)
				m_groups[bank][root] = group;
		}
		auto& page = group->pages[(pc >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u)];
		if (!page) page = new DispatchPage;
		return *page;
	}
	Root m_groups[CARTRIDGE_SLOT_COUNT]{};
};

} // namespace bmsx
