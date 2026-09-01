import type { CartridgeSlotIndex } from '../../../../machine/ts/spec/bmsx/cartridge';
import type { RomToolingMedia } from '../../../../toolchain/ts/rompack/media';
import { STUDIO_BOARD_ID } from './protocol';

export type StudioSocketPair = Readonly<{
	boardSlot: CartridgeSlotIndex;
	gameSlot: CartridgeSlotIndex;
}>;

const STUDIO_BOARD_IN_SLOT_0: StudioSocketPair = Object.freeze({
	boardSlot: 0,
	gameSlot: 1,
});
const STUDIO_BOARD_IN_SLOT_1: StudioSocketPair = Object.freeze({
	boardSlot: 1,
	gameSlot: 0,
});

export function studioSocketPairFromMedia(
	cartridgeSlots: RomToolingMedia['cartridgeSlots'],
): StudioSocketPair | null {
	const slot0 = cartridgeSlots[0];
	if (slot0 !== null && slot0.header.cartridgeBoardId === STUDIO_BOARD_ID) {
		return STUDIO_BOARD_IN_SLOT_0;
	}
	const slot1 = cartridgeSlots[1];
	if (slot1 !== null && slot1.header.cartridgeBoardId === STUDIO_BOARD_ID) {
		return STUDIO_BOARD_IN_SLOT_1;
	}
	return null;
}
