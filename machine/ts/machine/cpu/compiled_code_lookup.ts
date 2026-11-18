import { CARTRIDGE_SLOT_COUNT } from '../../spec/bmsx/cartridge';
import { ADDRESS_BITS, CART_ROM_BASE } from '../../spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';
import type { DecodedInstructionPage } from './execution_image';

const GROUP_PAGE_SHIFT = 12;
const GROUP_PAGES = 1 << GROUP_PAGE_SHIFT;
const ROOT_SHIFT = MAPPED_PAGE_BYTE_SHIFT + GROUP_PAGE_SHIFT;
const ROOT_ENTRIES = 1 << (ADDRESS_BITS - ROOT_SHIFT);

type Group = (DecodedInstructionPage | null)[];

// Index the existing decoded pages, whose lifetime is the execution image's.
// Bodies may be retired independently; the page remains the cache-miss owner.
export class CompiledCodeLookup {
	private readonly groups = Array.from({ length: CARTRIDGE_SLOT_COUNT },
		() => new Array<Group | null>(ROOT_ENTRIES).fill(null));

	public find(pc: number, slot: number): DecodedInstructionPage | null {
		const group = this.groups[slot][pc >>> ROOT_SHIFT];
		return group === null ? null : group[(pc >>> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1)];
	}

	public install(pageAddress: number, slot: number, page: DecodedInstructionPage): void {
		const firstSlot = pageAddress < CART_ROM_BASE ? 0 : slot;
		const endSlot = pageAddress < CART_ROM_BASE ? CARTRIDGE_SLOT_COUNT : slot + 1;
		const root = pageAddress >>> ROOT_SHIFT;
		const index = (pageAddress >>> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1);
		for (let bank = firstSlot; bank < endSlot; ++bank) {
			let group = this.groups[bank][root];
			if (group === null) {
				group = new Array<DecodedInstructionPage | null>(GROUP_PAGES).fill(null);
				this.groups[bank][root] = group;
			}
			group[index] = page;
		}
	}
}
