import type { RomAsset, CartRomHeader } from '../../src/bmsx/rompack/format';
import { disassembleProgram } from '../../src/bmsx/machine/cpu/disassembler';
import type { Program, ProgramMetadata } from '../../src/bmsx/machine/cpu/cpu';
import {
	decodeProgramImage,
	inflateProgram,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
} from '../../src/bmsx/machine/program/loader';
import { decodeBinary } from 'bmsx/common/serializer/binencoder';

export const ROM_MANIFEST_ASSET_ID = '__rom_manifest__';
export const ROM_MANIFEST_SOURCE_PATH = 'manifest.rommanifest';

const ASSET_ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function formatNumberAsHex(n: number, width?: number): string {
	const hex = n.toString(16).toUpperCase();
	const padded = width === undefined ? hex : hex.padStart(width, '0');
	return `${padded}h`;
}

export function formatByteSize(size: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	let i = 0;
	let n = size;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return i === 0 ? `${size} ${units[0]}` : `${n.toFixed(2)} ${units[i]}`;
}

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

export function buildLuaSourceLookup(rombin: Uint8Array, assets: RomAsset[]): Map<string, string> {
	const sources = new Map<string, string>();
	for (const asset of assets) {
		if (asset.type !== 'lua') {
			continue;
		}
		const path = asset.normalized_source_path ?? asset.source_path;
		if (!path) {
			throw new Error(`[RomInspector] Lua asset '${asset.resid}' is missing its source path.`);
		}
		if (asset.start === undefined || asset.end === undefined) {
			throw new Error(`[RomInspector] Lua asset '${asset.resid}' is missing buffer range.`);
		}
		if (sources.has(path)) {
			throw new Error(`[RomInspector] Duplicate lua source path '${path}'.`);
		}
		sources.set(path, Buffer.from(rombin.slice(asset.start, asset.end)).toString('utf8'));
	}
	return sources;
}

export function loadProgramFromAssets(rombin: Uint8Array, assets: RomAsset[]) {
	const programImageEntry = assets.find(asset => asset.resid === PROGRAM_IMAGE_ID);
	if (!programImageEntry) {
		throw new Error('[RomInspector] Program asset not found.');
	}
	if (programImageEntry.start === undefined || programImageEntry.end === undefined) {
		throw new Error(`[RomInspector] Program asset '${programImageEntry.resid}' is missing buffer range.`);
	}
	const programBytes = new Uint8Array(rombin.slice(programImageEntry.start, programImageEntry.end));
	const programImage = decodeProgramImage(programBytes);
	const program = inflateProgram(programImage.program);
	const symbolsAsset = assets.find(asset => asset.resid === PROGRAM_SYMBOLS_IMAGE_ID);
	const metadata = symbolsAsset
		? (() => {
			if (symbolsAsset.start === undefined || symbolsAsset.end === undefined) {
				throw new Error(`[RomInspector] Program symbols asset '${symbolsAsset.resid}' is missing buffer range.`);
			}
			const symbolsBytes = new Uint8Array(rombin.slice(symbolsAsset.start, symbolsAsset.end));
			return decodeBinary(symbolsBytes).metadata;
		})()
		: null;
	const sourceMap = metadata ? buildLuaSourceLookup(rombin, assets) : null;
	const missingSourcePaths = new Set<string>();
	if (metadata && sourceMap && sourceMap.size > 0) {
		for (const range of metadata.debugRanges) {
			if (range !== null && !sourceMap.has(range.path)) {
				missingSourcePaths.add(range.path);
			}
		}
	}
	const sourceTextForPath = metadata && sourceMap && sourceMap.size > 0 && missingSourcePaths.size === 0
		? (path: string) => {
			const text = sourceMap.get(path);
			if (text === undefined) {
				throw new Error(`[RomInspector] Lua source '${path}' not found in ROM pack.`);
			}
			return text;
		}
		: null;
	return {
		programImage,
		program,
		metadata,
		sourceTextForPath,
		missingSourcePaths: Array.from(missingSourcePaths.values()).sort(),
	};
}

export function disassembleProgramImage(
	program: Program,
	metadata: ProgramMetadata | null,
	sourceTextForPath: ((path: string) => string) | null,
	options: { assembly?: boolean; pcBias?: number } = {},
): string {
	const assembly = options.assembly === true;
	return disassembleProgram(program, metadata, {
		formatStyle: assembly ? 'assembly' : 'default',
		pcRadix: 16,
		pcFormatter: assembly ? undefined : (pc, width) => formatNumberAsHex(pc, width),
		pcBias: options.pcBias,
		showSourceComments: metadata !== null && sourceTextForPath !== null,
		sourceTextForPath: sourceTextForPath ?? undefined,
	});
}
