import { loadBlua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { formatNumberAsHex } from '../../machine/ts/common/byte_hex_string';
export { formatNumberAsHex, formatByteSize } from '../../machine/ts/common/byte_hex_string';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	BLUA32_IMAGE_ID,
	type Blua32ImageLayout,
} from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	type Blua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import {
	describeBlua32InstructionAtPc,
	formatSourceSnippet,
} from '../../toolchain/ts/rompack/disassembler';
import {
	INSTRUCTION_BYTES,
	readInstructionWord,
} from '../../machine/ts/spec/blua32/instruction_format';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import {
	CART_ROM_BASE,
	SYSTEM_ROM_BASE,
} from '../../machine/ts/spec/bmsx/memory_map';
import {
	parseCartHeader,
	type CartRomHeader,
} from '../../machine/ts/rompack/format';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { RomTocEntry } from '../../machine/ts/rompack/toc';

export const ROM_MANIFEST_ASSET_ID = '__rom_manifest__';
export const ROM_MANIFEST_SOURCE_PATH = 'manifest.rommanifest';

const ASSET_ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function buildManifestAsset(header: CartRomHeader): RomAsset {
	const start = header.manifestOffset;
	const end = header.manifestOffset + header.manifestLength;
	return {
		resid: ROM_MANIFEST_ASSET_ID,
		type: 'data',
		source_path: ROM_MANIFEST_SOURCE_PATH,
		normalized_source_path: ROM_MANIFEST_SOURCE_PATH,
		start,
		end,
	};
}

export function sortAssetsById(assets: RomAsset[]): RomAsset[] {
	return [...assets].sort((left, right) => ASSET_ID_COLLATOR.compare(left.resid, right.resid));
}

export function buildLuaSourceLookup(rombin: Uint8Array, assets: readonly RomTocEntry[]): Map<string, string> {
	const sources = new Map<string, string>();
	for (const asset of assets) {
		if (asset.type !== 'lua') {
			continue;
		}
		if (!asset.source_path) {
			throw new Error(`Lua asset '${asset.resid}' is missing its source path.`);
		}
		const path = toLuaModulePath(asset.source_path);
		if (asset.start === undefined || asset.end === undefined) {
			throw new Error(`Lua asset '${asset.resid}' is missing its buffer range.`);
		}
		if (sources.has(path)) {
			throw new Error(`Duplicate Lua source path '${path}'.`);
		}
		sources.set(path, Buffer.from(rombin.subarray(asset.start, asset.end)).toString('utf8'));
	}
	return sources;
}

export type InspectedBlua32Image = {
	image: Blua32ImageLayout;
	symbols: Blua32SymbolsImage | null;
	sourceTextByPath: ReadonlyMap<string, string> | null;
	missingSourcePaths: string[];
};

export function loadBlua32ImageFromAssets(rombin: Uint8Array, tocEntries: readonly RomTocEntry[]): InspectedBlua32Image {
	const header = parseCartHeader(rombin);
	if (header.blua32ImageByteCount === 0) {
		throw new Error('ROM has no BLua32 executable image.');
	}
	const romBaseAddress = header.blua32StartupFunctionAddress < CART_ROM_BASE
		? SYSTEM_ROM_BASE
		: CART_ROM_BASE;
	const { layout: image, symbols } = loadBlua32ToolingImage({ bytes: rombin, header }, romBaseAddress, tocEntries);
	const sourceMap = symbols ? buildLuaSourceLookup(rombin, tocEntries) : null;
	const missingSourcePaths = new Set<string>();
	if (symbols && sourceMap && sourceMap.size > 0) {
		for (const range of symbols.metadata.debugRanges) {
			if (range !== null && !sourceMap.has(range.path)) {
				missingSourcePaths.add(range.path);
			}
		}
	}
	return {
		image,
		symbols,
		sourceTextByPath: sourceMap,
		missingSourcePaths: Array.from(missingSourcePaths.values()).sort(),
	};
}

export function disassembleBlua32Image(
	image: Blua32ImageLayout,
	symbols: Blua32SymbolsImage | null,
	sourceTextByPath: ReadonlyMap<string, string> | null,
	options: { assembly?: boolean } = {},
): string {
	const assembly = options.assembly === true;
	const lines: string[] = [];
	for (let functionIndex = 0; functionIndex < image.functions.length; functionIndex += 1) {
		const fn = image.functions[functionIndex];
		const id = symbols ? ` id=${symbols.metadata.functionIds[functionIndex]}` : '';
		lines.push(
			`; function=${formatNumberAsHex(fn.address, 8)}${id}` +
			` entry=${formatNumberAsHex(fn.codeAddress, 8)}` +
			` len=${fn.codeByteCount}` +
			` params=${fn.numParams}` +
			` vararg=${fn.isVararg ? 1 : 0}` +
			` stack=${fn.maxStack}` +
			` upvalues=${fn.upvalues.length}`,
		);
		if (assembly) {
			lines.push(`.ORG ${formatNumberAsHex(fn.codeAddress, 8)}`);
		}
		let pc = fn.codeAddress;
		let lastRangeKey: string | null = null;
		while (pc < fn.codeAddress + fn.codeByteCount) {
			const wordIndex = (pc - image.header.textAddress) / INSTRUCTION_BYTES;
			const word = readInstructionWord(image.textBytes, wordIndex);
			const instruction = describeBlua32InstructionAtPc(image, symbols, pc, {
				pcRadix: 16,
				pcSuffix: 'h',
			});
			const prefix = assembly ? '' : `${instruction.pcText}: `;
			let sourceComment = '';
			if (sourceTextByPath !== null && instruction.sourceRange !== null) {
				const range = instruction.sourceRange;
				const rangeKey = `${range.path}:${range.start.line}`;
				const sourceText = sourceTextByPath.get(range.path);
				if (rangeKey !== lastRangeKey) {
					if (sourceText !== undefined) {
						sourceComment = ` ; ${formatSourceSnippet(range, sourceText)}`;
					}
					lastRangeKey = rangeKey;
				}
			}
			lines.push(`${prefix}${instruction.instructionText}${sourceComment}`);
			const opcode = (word >>> 18) & 0x3f;
			pc += opcode === OpCode.WIDE ? INSTRUCTION_BYTES * 2 : INSTRUCTION_BYTES;
		}
		if (functionIndex < image.functions.length - 1) {
			lines.push('');
		}
	}
	return lines.join('\n');
}

export { BLUA32_IMAGE_ID, BLUA32_SYMBOLS_IMAGE_ID };
