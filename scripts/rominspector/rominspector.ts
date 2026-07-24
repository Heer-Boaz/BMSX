#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile> [--ui] [--list-assets] [--manifest] [--blua32-asm]

import * as fs from 'fs/promises';
import { parseArgs } from 'node:util';
import { parseCartHeader, type RomAsset, type CartRomHeader, type RomManifest } from '../../machine/ts/rompack/format';
import { collectRomAssetSymbols } from '../../machine/ts/rompack/asset_symbols';
import { loadRomAssetList, parseCartridgeIndex } from '../../machine/ts/rompack/loader';
import {
	buildManifestAsset,
	disassembleBlua32Image,
	formatByteSize,
	formatNumberAsHex,
	loadBlua32ImageFromAssets,
	ROM_MANIFEST_ASSET_ID,
	sortAssetsById,
} from './shared';
import { runNativeInspectorUI } from './native_ui';
import { generateCycleCostReport } from './cycle_cost_analysis';

let assetList: RomAsset[] = [];
let romManifest: RomManifest | null = null;
let romProjectRootPath: string | null = null;
async function loadAssets(
	rombin: Uint8Array,
	header: CartRomHeader,
): Promise<{ assets: RomAsset[]; manifest: RomManifest | null; projectRootPath: string | null }> {
	let assets: RomAsset[] = [];
	let manifest: RomManifest | null = null;
	let projectRootPath: string | null = null;
	if (header.manifestLength === 0) {
		const entriesAndRoot = await loadRomAssetList(rombin);
		assets = entriesAndRoot.entries;
		projectRootPath = entriesAndRoot.projectRootPath;
		console.log('ROM header has no manifest; loading TOC assets only.');
		return { assets, manifest, projectRootPath };
	}

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
	try {
		const index = await parseCartridgeIndex(rombin);
		assets = index.entries;
		manifest = index.cart_manifest;
		projectRootPath = index.projectRootPath;

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
	const tocOffset = header.tocOffset;
	const tocLength = header.tocLength;
	if (tocOffset + tocLength > rombin.byteLength) {
		console.error(`Invalid TOC offset or length: offset=${formatNumberAsHex(tocOffset)} (${formatByteSize(tocOffset)}), length=${formatNumberAsHex(tocLength)} (${formatByteSize(tocLength)})`);
		process.exit(1);
	}

	const metaBuf = rombin.slice(tocOffset, tocOffset + tocLength);
	if (!metaBuf || metaBuf.byteLength === 0) {
		console.error('No TOC found in ROM file, invalid ROM file.');
		process.exit(1);
	}
	if (metaBuf.byteLength !== tocLength) {
		console.error(`TOC length mismatch: expected ${formatNumberAsHex(tocLength)} bytes, got ${formatNumberAsHex(metaBuf.byteLength)} bytes`);
		process.exit(1);
	}
	console.log(`TOC buffer loaded: offset=${formatNumberAsHex(tocOffset)} (${formatByteSize(tocOffset)}), length=${formatNumberAsHex(tocLength)} (${formatByteSize(tocLength)})`);
	return {
		metaBuf,
		metadataOffset: tocOffset,
		metadataLength: tocLength,
		manifestOffset: header.manifestOffset,
		manifestLength: header.manifestLength,
	};
}

async function loadRompackFromFile(romfile: string): Promise<Uint8Array> {
	console.log(`Reading ROM file from "${romfile}"...`);
	const raw = await fs.readFile(romfile);
	console.log(`Read ${formatByteSize(raw.byteLength)} from ROM file.`);
	return raw;
}

/**
 * Print asset list to stdout in a tabular format (CLI mode).
 */
function printTable(headers: string[], rows: string[][]): void {
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

function printAssetList(assets: RomAsset[], romByteLength: number): void {
	const offsetHexWidth = romByteLength > 1 ? (romByteLength - 1).toString(16).length : 1;
	const headers = ['id', 'type', 'path', 'size', 'buffer-start', 'buffer-end', 'metabuffer-start', 'metabuffer-end'];
	const rows = sortAssetsById(assets).map(asset => {
		const sourcePath = asset.source_path ?? asset.normalized_source_path;
		const path = sourcePath === undefined ? '<none>' : sourcePath;
		const hasBufferRange = asset.start !== undefined && asset.end !== undefined;
		const hasMetaRange = asset.metabuffer_start !== undefined && asset.metabuffer_end !== undefined;
		const size = (hasBufferRange ? asset.end - asset.start : 0) + (hasMetaRange ? asset.metabuffer_end - asset.metabuffer_start : 0);
		const bufferStart = asset.start !== undefined ? formatNumberAsHex(asset.start, offsetHexWidth) : '';
		const bufferEnd = asset.end !== undefined ? formatNumberAsHex(asset.end, offsetHexWidth) : '';
		const metaStart = asset.metabuffer_start !== undefined ? formatNumberAsHex(asset.metabuffer_start, offsetHexWidth) : '';
		const metaEnd = asset.metabuffer_end !== undefined ? formatNumberAsHex(asset.metabuffer_end, offsetHexWidth) : '';
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
	printTable(headers, rows);
}

function printAssetSymbols(assets: RomAsset[]): void {
	const symbols = collectRomAssetSymbols(assets, 'cart');
	let addressHexWidth = 1;
	for (let index = 0; index < symbols.length; index += 1) {
		const endAddressWidth = (symbols[index].address + symbols[index].byteLength).toString(16).length;
		if (endAddressWidth > addressHexWidth) {
			addressHexWidth = endAddressWidth;
		}
	}
	const rows = symbols.map(symbol => [
		symbol.name,
		symbol.assetType,
		symbol.assetId,
		symbol.payloadId,
		formatNumberAsHex(symbol.address, addressHexWidth),
		formatByteSize(symbol.byteLength),
	]);
	printTable(['symbol', 'type', 'asset', 'payload', 'address', 'length'], rows);
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
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			ui: { type: 'boolean' },
			'ui-native': { type: 'boolean' },
			'list-assets': { type: 'boolean' },
			'asset-symbols': { type: 'boolean' },
			manifest: { type: 'boolean' },
			'blua32-asm': { type: 'boolean' },
			'cycle-cost': { type: 'boolean' },
		},
	});
	const uiFlag = values.ui === true;
	const nativeUiFlag = values['ui-native'] === true;
	const listAssetsFlag = values['list-assets'] === true;
	const assetSymbolsFlag = values['asset-symbols'] === true;
	const manifestFlag = values.manifest === true;
	const blua32AsmFlag = values['blua32-asm'] === true;
	const cycleCostFlag = values['cycle-cost'] === true;
	const romfile = positionals[0];

	if (!romfile) {
		console.error('Usage: npx tsx scripts/rominspector.ts <romfile> [--ui] [--ui-native] [--list-assets] [--asset-symbols] [--blua32-asm] [--cycle-cost]');
		console.error('Options:');
		console.error('  --ui            Open the native interactive UI');
		console.error('  --ui-native     Alias for the native interactive UI');
		console.error('  --list-assets   Print asset list to stdout (default)');
		console.error('  --asset-symbols Print generated bmsx/assets ROM address symbols');
		console.error('  --manifest      Print cart manifest details to stdout');
		console.error('  --cycle-cost    Print fantasy CPU cycle cost analysis');
		console.error('  --blua32-asm    Print physical BLua32 disassembly and exit');
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
		`metadata=${header.metadataOffset}+${header.metadataLength} ` +
		`blua32=${header.blua32ImageOffset}+${header.blua32ImageByteCount} ` +
		`startup=${formatNumberAsHex(header.blua32StartupFunctionAddress, 8)} ` +
		`irq=${formatNumberAsHex(header.blua32IrqFunctionAddress, 8)} ` +
		`exception=${formatNumberAsHex(header.blua32ExceptionFunctionAddress, 8)} ` +
		`layout=${formatNumberAsHex(header.blua32StaticLayoutTokenHi, 8)}:${formatNumberAsHex(header.blua32StaticLayoutTokenLo, 8)}`
	);

	getTocBuffer(rombin, header);
	({ assets: assetList, manifest: romManifest, projectRootPath: romProjectRootPath } = await loadAssets(rombin, header));
	if (header.manifestLength > 0 && !assetList.some(asset => asset.resid === ROM_MANIFEST_ASSET_ID)) {
		assetList.unshift(buildManifestAsset(header));
	}
	if (blua32AsmFlag) {
		const { image, symbols, sourceTextByPath, missingSourcePaths } = loadBlua32ImageFromAssets(rombin, assetList);
		if (missingSourcePaths.length > 0) {
			console.warn(`Source comments unavailable for ${missingSourcePaths.length} Lua path(s); ROM is stripped or partial.`);
		}
		console.log(disassembleBlua32Image(image, symbols, sourceTextByPath, { assembly: true }));
		process.exit(0);
	}

	if (cycleCostFlag) {
		const { image, symbols } = loadBlua32ImageFromAssets(rombin, assetList);
		console.log(generateCycleCostReport(image, symbols));
		process.exit(0);
	}

	if (manifestFlag) {
		printManifest(romManifest, romProjectRootPath);
		if (!uiFlag && !listAssetsFlag && !assetSymbolsFlag) {
			process.exit(0);
		}
	}

	if (assetSymbolsFlag) {
		printAssetSymbols(assetList);
		if (!uiFlag && !listAssetsFlag) {
			process.exit(0);
		}
	}

	// Print assets by default; UI is only enabled with --ui
	if ((!uiFlag && !nativeUiFlag) || listAssetsFlag) {
		printAssetList(assetList, rombin.byteLength);
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
