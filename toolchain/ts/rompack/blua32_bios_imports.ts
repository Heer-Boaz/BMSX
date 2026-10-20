import { readLE32 } from '../../../machine/ts/common/endian';
import { BIOS_FUNCTION_MODULE_PATHS } from '../../../machine/ts/spec/bmsx/bios';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import {
	BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET,
	BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
} from '../../../machine/ts/spec/blua32/image_format';

export type Blua32BiosFunctionExport = {
	readonly path: string;
	readonly exportPathKey: string;
};

export type Blua32BiosFunctionImport = {
	readonly path: string;
	readonly exportPathKey: string;
	readonly functionAddress: number;
};

export type Blua32BiosImports = {
	readonly cartridgeStaticRamBase: number;
	readonly functions: ReadonlyArray<Blua32BiosFunctionImport>;
};

/** Resolve the public BIOS slots and RAM footprint from the mapped ROM bytes. */
export function readBlua32BiosImports(rom: Uint8Array): Blua32BiosImports {
	const imageOffset = readLE32(rom, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
	const functionTableAddress = readLE32(rom, imageOffset + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET);
	const bssAddress = readLE32(rom, imageOffset + BLUA32_IMAGE_BSS_ADDRESS_OFFSET);
	const bssByteCount = readLE32(rom, imageOffset + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET);
	return {
		cartridgeStaticRamBase: bssAddress + bssByteCount,
		functions: BIOS_FUNCTION_MODULE_PATHS.map((path, slot) => ({
			path,
			exportPathKey: '',
			functionAddress: functionTableAddress + slot * BLUA32_FUNCTION_RECORD_SIZE,
		})),
	};
}
