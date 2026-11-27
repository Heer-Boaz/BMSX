import {
	alignBlua32ImageOffset,
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
import { SYSTEM_EXECUTION_DOMAIN_ID, type ExecutionDomainId } from '../../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE, CART_ROM_SIZE, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { RomImage } from '../../../machine/ts/rompack/image';
import { decodeRomToc, type RomTocEntry } from '../../../machine/ts/rompack/toc';

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

/** A second executable can be read as data while the mounted image remains executable. */
export function stageBlua32Executable(installedRom: Uint8Array, image: Blua32ImageLayout,
	domain: ExecutionDomainId): { bytes: Uint8Array; imageAddress: number } {
	const system = domain === SYSTEM_EXECUTION_DOMAIN_ID;
	const base = system ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const limit = system ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	const offset = alignBlua32ImageOffset(installedRom.byteLength, base, 4);
	const extent = offset + image.bytes.byteLength;
	if (extent > limit) throw new Error('Staged executable exceeds the physical ROM aperture.');
	const bytes = new Uint8Array(extent);
	bytes.set(installedRom);
	bytes.set(image.bytes, offset);
	return { bytes, imageAddress: base + offset };
}

/** Omitted entries decode the ROM TOC; supplied entries (including empty) are authoritative. */
export function loadBlua32ToolingImage(
	rom: RomImage,
	romBaseAddress: number,
	tocEntries: readonly RomTocEntry[] | undefined = undefined,
): Blua32ToolingImage | null {
	const layout = decodeBlua32RomImage(rom.bytes, romBaseAddress);
	if (!layout) {
		return null;
	}
	const entries = tocEntries === undefined ? decodeRomToc(rom.bytes.subarray(
		rom.header.tocOffset,
		rom.header.tocOffset + rom.header.tocLength,
	)).entries : tocEntries;
	let symbols: Blua32SymbolsImage | null = null;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
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
