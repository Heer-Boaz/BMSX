import {
	decodeBlua32RomImage,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	decodeBlua32BiosImports,
	type Blua32BiosImports,
} from './blua32_bios_imports';
import type { ExecutionDomainId } from '../../../machine/ts/spec/blua32/execution_domain';
import { decodeRomToc } from '../../../machine/ts/rompack/toc';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { RomToolingLayer } from './loader';

export type Blua32ToolingImage = {
	readonly layout: Blua32ImageLayout;
	readonly symbols: Blua32SymbolsImage | null;
};

export type Blua32SystemToolingImage = Blua32ToolingImage & {
	readonly biosImports: Blua32BiosImports;
};

export type Blua32ToolingMedia = {
	readonly system: Blua32SystemToolingImage | null;
	readonly cartridgeSlots: readonly [
		Blua32ToolingImage | null,
		Blua32ToolingImage | null,
	];
};

export function loadBlua32ToolingImage(
	rom: RomToolingLayer<'system'>,
): Blua32SystemToolingImage | null;
export function loadBlua32ToolingImage(
	rom: RomToolingLayer<'cart'>,
): Blua32ToolingImage | null;
export function loadBlua32ToolingImage(
	rom: RomToolingLayer,
): Blua32ToolingImage | Blua32SystemToolingImage | null {
	const romBaseAddress = rom.id === 'system' ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const layout = decodeBlua32RomImage(rom.bytes, romBaseAddress);
	if (!layout) {
		return null;
	}
	const toc = decodeRomToc(rom.bytes.subarray(
		rom.header.tocOffset,
		rom.header.tocOffset + rom.header.tocLength,
	));
	let symbols: Blua32SymbolsImage | null = null;
	if (rom.id === 'system') {
		let biosImports: Blua32BiosImports | undefined;
		for (let index = 0; index < toc.entries.length; index += 1) {
			const entry = toc.entries[index];
			if (entry.resid === BLUA32_SYMBOLS_IMAGE_ID) {
				symbols = decodeBlua32SymbolsImage(rom.bytes.subarray(entry.start!, entry.end!));
			} else if (entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID) {
				biosImports = decodeBlua32BiosImports(rom.bytes.subarray(entry.start!, entry.end!));
			}
		}
		if (biosImports === undefined) {
			throw new Error('System ROM has no BLua32 BIOS import library.');
		}
		return { layout, symbols, biosImports };
	}
	for (let index = 0; index < toc.entries.length; index += 1) {
		const entry = toc.entries[index];
		if (entry.resid === BLUA32_SYMBOLS_IMAGE_ID) {
			symbols = decodeBlua32SymbolsImage(rom.bytes.subarray(entry.start!, entry.end!));
		}
	}
	return { layout, symbols };
}

export function blua32ToolingImageForDomain(
	media: Blua32ToolingMedia,
	executionDomainId: ExecutionDomainId,
): Blua32ToolingImage | null {
	switch (executionDomainId) {
		case -1:
			return media.system;
		case 0:
			return media.cartridgeSlots[0];
		case 1:
			return media.cartridgeSlots[1];
	}
}
