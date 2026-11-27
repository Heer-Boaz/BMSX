import type { Blua32BiosFunctionExport } from './blua32_bios_imports';
import type { Blua32PreparedEntry } from './blua32_image_builder';
import { BIOS_FUNCTION_SLOTS } from '../../../machine/ts/spec/bmsx/bios';

export const SYSTEM_ROM_NAME = 'bmsx-bios';

export const SYSTEM_BLUA32_IMAGE_OFFSET = 0x00000100;
/** Build-time program budget, not a file offset at which assets must begin. */
export const SYSTEM_BLUA32_IMAGE_LIMIT = 0x00400000;
/** Bounded growth headroom keeps system RODATA stable during Hot Resume. */
export const SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT = 0x00004000;

export const BIOS_FUNCTION_EXPORTS: ReadonlyArray<Blua32BiosFunctionExport> =
	BIOS_FUNCTION_SLOTS;

// The firmware creates this initial frame before its regular startup.
export const BIOS_PREPARED_ENTRY: Blua32PreparedEntry = {
	path: 'kernel/managed_reset', exportPathKey: 'enter', valueSlots: 8,
};

export function assertSystemBlua32ImageFits(imageEndOffset: number): void {
	if (imageEndOffset > SYSTEM_BLUA32_IMAGE_LIMIT) {
		throw new Error(
			`System BLua32 image ends at ROM offset 0x${imageEndOffset.toString(16)}, `
			+ `beyond the program budget at 0x${SYSTEM_BLUA32_IMAGE_LIMIT.toString(16)}.`,
		);
	}
}
