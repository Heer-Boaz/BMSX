import {
	decodeBlua32RomImage,
	blua32FunctionIndexAtAddress,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import type { ExecutionDomainId } from '../../../machine/ts/spec/blua32/execution_domain';
import type { RomImage } from '../../../machine/ts/rompack/image';
import { decodeRomToc } from '../../../machine/ts/rompack/toc';

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
	rom: RomImage,
	romBaseAddress: number,
): Blua32ToolingImage | null {
	const layout = decodeBlua32RomImage(rom.bytes, romBaseAddress);
	if (!layout) {
		return null;
	}
	const toc = decodeRomToc(rom.bytes.subarray(
		rom.header.tocOffset,
		rom.header.tocOffset + rom.header.tocLength,
	));
	let symbols: Blua32SymbolsImage | null = null;
	for (let index = 0; index < toc.entries.length; index += 1) {
		const entry = toc.entries[index];
		if (entry.resid === BLUA32_SYMBOLS_IMAGE_ID) {
			symbols = decodeBlua32SymbolsImage(rom.bytes.subarray(entry.start!, entry.end!));
			break;
		}
	}
	return { layout, symbols };
}

/** The reset thunk carries the selected entry chunk's source range, including in derived builds. */
export function blua32StartupSourcePath(
	image: Blua32ToolingImage | null,
	startupFunctionAddress: number,
): string | undefined {
	if (image === null || image.symbols === null) return undefined;
	const fn = image.layout.functions[blua32FunctionIndexAtAddress(image.layout, startupFunctionAddress)];
	return blua32SourceRangeAtPc(image.symbols, image.layout.header.textAddress, fn.codeAddress)!.path;
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
