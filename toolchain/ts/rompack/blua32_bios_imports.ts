import { decodeBinary, encodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import type { RomToolingLayer } from './loader';

export const BLUA32_BIOS_IMPORTS_IMAGE_ID = '__blua32_bios_imports__';
export const BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX = '.blua32-imports';

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

export function encodeBlua32BiosImports(imports: Blua32BiosImports): Uint8Array {
	return encodeBinary(imports);
}

export function decodeBlua32BiosImports(bytes: Uint8Array): Blua32BiosImports {
	return decodeBinary(bytes);
}

export function loadBlua32BiosImports(
	rom: RomToolingLayer<'system'>,
): Blua32BiosImports {
	for (let index = 0; index < rom.index.entries.length; index += 1) {
		const entry = rom.index.entries[index];
		if (entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID) {
			return decodeBlua32BiosImports(rom.bytes.subarray(entry.start!, entry.end!));
		}
	}
	throw new Error('System ROM has no BLua32 BIOS import library.');
}
