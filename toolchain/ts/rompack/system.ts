import type { Blua32BiosFunctionExport } from './blua32_bios_imports';
import { BIOS_FUNCTION_MODULE_PATHS } from '../../../machine/ts/spec/bmsx/bios';

export const SYSTEM_ROM_NAME = 'bmsx-bios';

export const SYSTEM_BLUA32_IMAGE_OFFSET = 0x00000100;
export const SYSTEM_ROM_ASSET_OFFSET = 0x00400000;
export const SYSTEM_BLUA32_FUNCTION_RECORD_CAPACITY = 4096;

export const BIOS_FUNCTION_EXPORTS: ReadonlyArray<Blua32BiosFunctionExport> =
	BIOS_FUNCTION_MODULE_PATHS.map(path => ({ path, exportPathKey: '' }));

export function assertSystemBlua32ImageFits(imageEndOffset: number): void {
	if (imageEndOffset > SYSTEM_ROM_ASSET_OFFSET) {
		throw new Error(
			`System BLua32 image ends at ROM offset 0x${imageEndOffset.toString(16)}, `
			+ `beyond the asset partition at 0x${SYSTEM_ROM_ASSET_OFFSET.toString(16)}.`,
		);
	}
}
