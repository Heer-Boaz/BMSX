#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile> [--ui] [--list-assets] [--manifest] [--program-asm]

import * as fs from 'fs/promises';
import * as pako from 'pako';
import type { RomAsset, CartRomHeader, RomManifest } from '../../src/bmsx/rompack/rompack';
import { getZippedRomAndRomLabelFromBlob, loadAssetList, parseCartHeader } from '../../src/bmsx/rompack/romloader';
import {
	buildManifestAsset,
	disassembleProgramAsset,
	formatByteSize,
	formatNumberAsHex,
	loadProgramFromAssets,
	ROM_MANIFEST_ASSET_ID,
	sortAssetsById,
} from './inspector_shared';
import { runNativeInspectorUI } from './native_ui';

let assetList: RomAsset[] = [];
let romManifest: RomManifest | null = null;
let romProjectRootPath: string | null = null;

const PROGRAM_ASM_BIAS_FLAG = '--program-asm-bias';
function parseProgramAsmBias(args: string[]): number | null {
	for (const arg of args) {
		if (arg.startsWith(`${PROGRAM_ASM_BIAS_FLAG}=`)) {
			return parseBiasValue(arg.slice(PROGRAM_ASM_BIAS_FLAG.length + 1));
		}
	}
	const index = args.indexOf(PROGRAM_ASM_BIAS_FLAG);
	if (index < 0) {
		return null;
	}
	const raw = args[index + 1];
	if (!raw) {
		throw new Error(`[RomInspector] ${PROGRAM_ASM_BIAS_FLAG} requires a value.`);
	}
	return parseBiasValue(raw);
}

function parseBiasValue(raw: string): number {
	let valueText = raw.trim();
	let radix = 10;
	if (valueText.startsWith('0x') || valueText.startsWith('0X')) {
		radix = 16;
		valueText = valueText.slice(2);
	}
	if (valueText.endsWith('h') || valueText.endsWith('H')) {
		radix = 16;
		valueText = valueText.slice(0, -1);
	}
	const parsed = Number.parseInt(valueText, radix);
	if (Number.isNaN(parsed)) {
		throw new Error(`[RomInspector] Invalid ${PROGRAM_ASM_BIAS_FLAG} value: "${raw}".`);
	}
	return parsed;
}
async function loadAssets(rombin: Uint8Array): Promise<{ assets: RomAsset[]; manifest: RomManifest | null; projectRootPath: string | null }> {
	let assets: RomAsset[] = [];
	let manifest: RomManifest | null = null;
	let projectRootPath: string | null = null;
	try {
		// Load the ROM pack metadata using the loadResources function
		console.log('Loading ROM pack metadata...');
		if (!rombin || !(rombin instanceof Uint8Array)) {
			console.error('Invalid metadata format: expected an Uint8Array');
			process.exit(1);
		}
		if (rombin.byteLength < 16) {
			console.error('Metadata buffer is too short, expected at least 16 bytes');
			process.exit(1);
		}
		// Load the ROM pack metadata using the loadResources function
		console.log('Extracting ROM pack metadata...');
		console.log('Loading resources from metadata buffer...');
		// Load asset list from the ROM binary buffer
		({ assets, manifest, projectRootPath } = await loadAssetList(rombin));

		console.log('ROM pack metadata and resources loaded successfully.');

		console.log(`Extracted ${assets.length} assets from ROM pack.`);
	} catch (e: any) {
		console.error(`Failed to decode metadata: ${e.message}`);
		console.error(e?.stack ?? 'No stack trace available');
		process.exit(1);
	}
	return { assets, manifest, projectRootPath };
}

function getTocBuffer(rombin: Buffer | Uint8Array, header: CartRomHeader) {
	const metadataOffset = header.tocOffset;
	const metadataLength = header.tocLength;
	if (metadataOffset + metadataLength > rombin.byteLength) {
		console.error(`Invalid TOC offset or length: offset=${metadataOffset} (${formatByteSize(metadataOffset)}), length=${metadataLength} (${formatByteSize(metadataLength)})`);
		process.exit(1);
	}

	const metaBuf = rombin.slice(metadataOffset, metadataOffset + metadataLength);
	if (!metaBuf || metaBuf.byteLength === 0) {
		console.error('No TOC found in ROM file, invalid ROM file.');
		process.exit(1);
	}
	if (metaBuf.byteLength !== metadataLength) {
		console.error(`TOC length mismatch: expected ${metadataLength} bytes, got ${metaBuf.byteLength} bytes`);
		process.exit(1);
	}
	console.log(`TOC buffer loaded: offset=${metadataOffset} (${formatByteSize(metadataOffset)}), length=${metadataLength} (${formatByteSize(metadataLength)})`);
	return {
		metaBuf,
		metadataOffset,
		metadataLength,
		manifestOffset: header.manifestOffset,
		manifestLength: header.manifestLength,
	};
}

async function loadRompackFromFile(romfile: string): Promise<Uint8Array> {
	let raw: Buffer
	let error: any;
	let rawSize = 0;
	let deflatedSize = 0;
	try {
		console.log(`Reading ROM file from "${romfile}"...`);
		raw = await fs.readFile(romfile);
		rawSize = raw.byteLength;
		console.log(`Read ${formatByteSize(rawSize)} from ROM file.`);
	}
	catch (e: any) {
		error = e;
	}
	// Check whether the file exists
	if (!raw) {
		throw new Error(`Failed to read ROM file at "${romfile}": ${error?.message || 'Unknown error'}`);
	}

	const { zipped_rom, romlabel } = await getZippedRomAndRomLabelFromBlob(
		// @ts-ignore
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
	);
	if (!zipped_rom || zipped_rom.byteLength === 0) {
		throw new Error(`ROM file "${romfile}" is empty or invalid.`);
	}
	const labelInfo = romlabel ? `${formatByteSize(romlabel.byteLength)} PNG label` : 'No label';
	console.log(`Loaded ROM file "${romfile}" with label: ${labelInfo}`);

	function isPakoCompressed(raw: Uint8Array): boolean {
		// Gzip: 1F 8B
		if (raw && raw.length >= 2 && raw[0] === 0x1F && raw[1] === 0x8B) {
			return true;
		}
		// Zlib: 78 01 / 78 9C / 78 DA (common), but also check CMF/FLG validity
		if (raw && raw.length >= 2 && raw[0] === 0x78) {
			const cmf = raw[0], flg = raw[1];
			if ((cmf * 256 + flg) % 31 === 0) {
				return true;
			}
		}
		return false;
	}

	const zippedView = new Uint8Array(zipped_rom);
	const isCompressed = isPakoCompressed(zippedView);
	let rombin: Uint8Array | null = null;
	if (isCompressed) {
		console.log('ROM is compressed, decompressing...');
		let zipped = zippedView;
		let decompressed: Uint8Array | null = null;
		try {
			decompressed = pako.inflate(zipped);
		} catch (e: any) {
			const msg = e && typeof e.message === 'string' ? e.message : String(e);
			console.error(`Failed to decompress ROM: ${msg}`);
			console.error(e?.stack ?? 'No stack trace available');
			decompressed = null; // fallback to null if decompression fails
		}
		rombin = decompressed ?? raw; // Use decompressed data if available, otherwise fallback to raw
		deflatedSize = rombin.byteLength;
		console.log(`Decompressed ROM size: ${formatByteSize(deflatedSize)}`);
		console.log(`Compressed size vs uncompressed size (lower is better): ${((rawSize / deflatedSize) * 100).toFixed(2)}%`);
	} else {
		console.log('ROM is uncompressed, using as-is.');
		rombin = raw;
	}
	if (!rombin) {
		throw new Error('ROM pack is empty or invalid after decompression.');
	}
	return rombin;
}

/**
 * Print asset list to stdout in a tabular format (CLI mode).
 */
function printAssetList(assets: RomAsset[]): void {
	const headers = ['id', 'type', 'path', 'size', 'buffer-start', 'buffer-end', 'metabuffer-start', 'metabuffer-end'];
	const rows = sortAssetsById(assets).map(asset => {
		const path = asset.source_path ?? asset.normalized_source_path ?? '';
		const hasBufferRange = typeof asset.start === 'number' && typeof asset.end === 'number';
		const hasMetaRange = typeof asset.metabuffer_start === 'number' && typeof asset.metabuffer_end === 'number';
		const size = (hasBufferRange ? asset.end - asset.start : 0) + (hasMetaRange ? asset.metabuffer_end - asset.metabuffer_start : 0);
		const bufferStart = typeof asset.start === 'number' ? formatNumberAsHex(asset.start) : '';
		const bufferEnd = typeof asset.end === 'number' ? formatNumberAsHex(asset.end) : '';
		const metaStart = typeof asset.metabuffer_start === 'number' ? formatNumberAsHex(asset.metabuffer_start) : '';
		const metaEnd = typeof asset.metabuffer_end === 'number' ? formatNumberAsHex(asset.metabuffer_end) : '';
		return [
			String(asset.resid),
			String(asset.type),
			path,
			(hasBufferRange || hasMetaRange) ? formatByteSize(size) : '',
			bufferStart,
			bufferEnd,
			metaStart,
			metaEnd,
		];
	});
	const colWidths = headers.map((header, idx) => {
		let max = header.length;
		for (const row of rows) {
			const len = row[idx].length;
			if (len > max) max = len;
		}
		return max;
	});
	const formatRow = (cols: string[]) => cols.map((col, idx) => col.padEnd(colWidths[idx])).join(' | ').trimEnd();

	console.log(formatRow(headers));
	console.log(colWidths.map(width => '-'.repeat(width)).join('-+-'));
	for (const row of rows) {
		console.log(formatRow(row));
	}
}

function printManifest(manifest: RomManifest | null, projectRootPath: string | null): void {
	if (!manifest) {
		console.log('Manifest: <missing>');
		return;
	}
	const payload = projectRootPath ? { project_root_path: projectRootPath, manifest } : { manifest };
	console.log(JSON.stringify(payload, null, 2));
}

async function main() {
	const args = process.argv.slice(2);
	const uiFlag = args.includes('--ui');
	const nativeUiFlag = args.includes('--ui-native');
	const listAssetsFlag = args.includes('--list-assets');
	const manifestFlag = args.includes('--manifest');
	const programAsmFlag = args.includes('--program-asm');
	const programAsmBias = parseProgramAsmBias(args);
	const romfile = args.find(arg => !arg.startsWith('--'));

	if (!romfile) {
		console.error('Usage: npx tsx scripts/rominspector.ts <romfile> [--ui] [--ui-native] [--list-assets] [--program-asm] [--program-asm-bias <value>]');
		console.error('Options:');
		console.error('  --ui            Open the native interactive UI');
		console.error('  --ui-native     Alias for the native interactive UI');
		console.error('  --list-assets   Print asset list to stdout (default)');
		console.error('  --manifest      Print cart manifest details to stdout');
		console.error('  --program-asm   Print program disassembly and exit');
		console.error('  --program-asm-bias  Base PC to add (e.g. 0x80000 or 80000h)');
		process.exit(1);
	}

	// Load the ROM pack from the specified file
	let rombin: Uint8Array;
	try {
		rombin = await loadRompackFromFile(romfile);
	} catch (e: any) {
		console.error(`Failed to load ROM file "${romfile}": ${e.message}`);
		console.error(e?.stack ?? 'No stack trace available');
		process.exit(1);
	}

	const header = parseCartHeader(rombin);
	console.log(
		`ROM header: header=${header.headerSize} ` +
		`manifest=${header.manifestOffset}+${header.manifestLength} ` +
		`toc=${header.tocOffset}+${header.tocLength} ` +
		`data=${header.dataOffset}+${header.dataLength} ` +
		`boot=v${header.programBootVersion} flags=${formatNumberAsHex(header.programBootFlags, 8)} ` +
		`entry=${header.programEntryProtoIndex} protos=${header.programProtoCount} code=${header.programCodeByteCount}`
	);

	getTocBuffer(rombin, header);
	({ assets: assetList, manifest: romManifest, projectRootPath: romProjectRootPath } = await loadAssets(rombin));
	if (!assetList.some(asset => asset.resid === ROM_MANIFEST_ASSET_ID)) {
		assetList.unshift(buildManifestAsset(header));
	}

	if (programAsmFlag) {
		const { program, metadata, sourceTextForPath } = loadProgramFromAssets(rombin, assetList);
		const pcBias = programAsmBias === null ? undefined : programAsmBias;
		console.log(disassembleProgramAsset(program, metadata, sourceTextForPath, { assembly: true, pcBias }));
		process.exit(0);
	}

	if (manifestFlag) {
		printManifest(romManifest, romProjectRootPath);
		if (!uiFlag && !listAssetsFlag) {
			process.exit(0);
		}
	}

	// Print assets by default; UI is only enabled with --ui
	if ((!uiFlag && !nativeUiFlag) || listAssetsFlag) {
		printAssetList(assetList);
		if (!uiFlag && !nativeUiFlag) process.exit(0);
	}

	if (uiFlag || nativeUiFlag) {
		await runNativeInspectorUI({
			romfile,
			rombin,
			assets: assetList,
			manifest: romManifest,
			projectRootPath: romProjectRootPath,
			formatByteSize,
			formatNumberAsHex,
		});
		process.exit(0);
	}
}

main();
