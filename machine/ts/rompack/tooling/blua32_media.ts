import {
	decodeBlua32RomImage,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import type { RomToolingLayer } from './loader';
import type { RawRomSource } from './source';

export type Blua32ToolingImage = {
	readonly layout: Blua32ImageLayout;
	readonly symbols: Blua32SymbolsImage | null;
};

export type Blua32ToolingMedia = {
	readonly system: Blua32ToolingImage | null;
	readonly cartridgeSlots: readonly [
		Blua32ToolingImage | null,
		Blua32ToolingImage | null,
	];
};

export function loadBlua32ToolingImage(
	rom: RomToolingLayer,
	romSource: RawRomSource,
	romBaseAddress: number,
): Blua32ToolingImage | null {
	const layout = decodeBlua32RomImage(rom.payload, romBaseAddress);
	if (!layout) {
		return null;
	}
	const symbolsEntry = romSource.getEntry(BLUA32_SYMBOLS_IMAGE_ID);
	return {
		layout,
		symbols: symbolsEntry
			? decodeBlua32SymbolsImage(romSource.getBytesView(symbolsEntry))
			: null,
	};
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
