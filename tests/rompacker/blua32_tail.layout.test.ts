import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import {
	parseCartHeader,
} from '../../machine/ts/rompack/format';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { RomManifest } from '../../toolchain/ts/rompack/manifest';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX,
} from '../../toolchain/ts/rompack/blua32_bios_imports';
import { buildBlua32Tail } from '../../toolchain/ts/rompack/blua32_tail';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	BIOS_FUNCTION_EXPORTS,
	SYSTEM_ROM_ASSET_OFFSET,
} from '../../toolchain/ts/rompack/system';
import {
	BLUA32_SYMBOLS_SIDECAR_SUFFIX,
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';
import { buildBlua32Image } from '../../scripts/rompacker/blua32_image_builder';

const ROOT = join(process.cwd(), 'tmp', 'blua32-tail-layout-test');
const RELEASE_ROOT = join(process.cwd(), 'tmp', 'blua32-tail-release-test');
const ENTRY_PATH = 'entry.lua';
const SINCOS_PATH = 'math/sincos.lua';
const SINCOS_SOURCE = readFileSync('machine/bios/math/sincos.lua', 'utf8');
const LINK_RAM_BYTES = 0x00400000;
const MANIFEST: RomManifest = {};

function luaAsset(source: string): RomAsset {
	const entrySource = `module<entry>\n${source}`;
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(entrySource),
		compiled_buffer: compileLuaChunkBuffer(entrySource, ENTRY_PATH),
		source_path: ENTRY_PATH,
	};
}

function sincosAsset(): RomAsset {
	return {
		resid: 'math/sincos',
		type: 'lua',
		buffer: Buffer.from(SINCOS_SOURCE),
		compiled_buffer: compileLuaChunkBuffer(SINCOS_SOURCE, SINCOS_PATH),
		source_path: SINCOS_PATH,
	};
}

test('release system ROM embeds public BIOS imports and keeps linker sidecars', async () => {
	await rm(RELEASE_ROOT, { recursive: true, force: true });
	try {
		await mkdir(RELEASE_ROOT, { recursive: true });
		const assets = [luaAsset('return 1'), sincosAsset()];
		const layout = layoutRomPrefix(assets, false, MANIFEST, SYSTEM_ROM_ASSET_OFFSET);
		const blua32 = buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
			includeSymbols: false,
			optLevel: 0,
			systemAssetEndOffset: layout.nextOffset,
			domain: 'system',
			ramByteCount: LINK_RAM_BYTES,
			biosExports: BIOS_FUNCTION_EXPORTS,
		});
		await finalizeRompack('release-tail', {
			debug: false,
			cartridgeBoardWord: 0,
			cartridgeRamByteCount: 0,
			layout,
			outputDirectory: RELEASE_ROOT,
			blua32,
		});

		const romPath = join(RELEASE_ROOT, 'release-tail.rom');
		const payload = new Uint8Array(await readFile(romPath));
		const index = await parseCartridgeIndex(payload);
		assert.equal(index.entries.some(entry => entry.resid === BLUA32_IMAGE_ID), true);
		assert.equal(index.entries.some(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID), false);
		const importsEntry = index.entries.find(entry => entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID)!;

		assert.equal(blua32.domain, 'system');
		const symbolsSidecar = await readFile(`${romPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`);
		const expectedSymbols = Buffer.from(
			blua32.symbolsPayload.buffer,
			blua32.symbolsPayload.byteOffset,
			blua32.symbolsPayload.byteLength,
		);
		assert.equal(symbolsSidecar.equals(expectedSymbols), true);
		const importsSidecar = await readFile(`${romPath}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`);
		const expectedImports = Buffer.from(
			blua32.biosImportsPayload.buffer,
			blua32.biosImportsPayload.byteOffset,
			blua32.biosImportsPayload.byteLength,
		);
		assert.equal(
			Buffer.from(payload.subarray(importsEntry.start!, importsEntry.end!)).equals(expectedImports),
			true,
		);
		assert.equal(importsSidecar.equals(expectedImports), true);
	} finally {
		await rm(RELEASE_ROOT, { recursive: true, force: true });
	}
});

test('BLua32-tail rebuild preserves immutable asset metadata addresses and bytes', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const initialSource = 'return 1';
		const assets: RomAsset[] = [
			luaAsset(initialSource),
			{
				resid: 'sprite',
				type: 'image',
				buffer: Buffer.from([0x11, 0x22, 0x33]),
				imgmeta: {
					width: 1,
					height: 1,
					texture_u: 0,
					texture_v: 0,
					gx_texture_resid: 'texture',
				},
			},
		];
		const layout = layoutRomPrefix(assets, true, MANIFEST, SYSTEM_ROM_ASSET_OFFSET);
		const blua32 = buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 0,
			systemAssetEndOffset: layout.nextOffset,
			domain: 'system',
			ramByteCount: LINK_RAM_BYTES,
			biosExports: [],
		});
		await finalizeRompack('tail', {
			debug: true,
			cartridgeBoardWord: 0,
			cartridgeRamByteCount: 0,
			layout,
			outputDirectory: ROOT,
			blua32,
		});

		const initialPayload = new Uint8Array(await readFile(join(ROOT, 'tail.debug.rom')));
		const index = await parseCartridgeIndex(initialPayload);
		const imageEntry = index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const symbolsEntry = index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		const spriteEntry = index.entries.find(entry => entry.resid === 'sprite')!;
		const initialHeader = parseCartHeader(initialPayload);
		const imageStart = imageEntry.start!;
		const initialImageEnd = imageEntry.end!;
		const initialSymbolsEnd = symbolsEntry.end!;
		const metadataStart = spriteEntry.metabuffer_start!;
		const metadataEnd = spriteEntry.metabuffer_end!;
		const immutableBody = initialPayload.slice(CART_ROM_HEADER_SIZE, imageStart);
		const metadataBytes = initialPayload.slice(metadataStart, metadataEnd);

		const changedSource = `local value = 0\n${'value = value + 1\n'.repeat(128)}return value`;
		const changed = buildBlua32Image({
			luaAssets: [luaAsset(changedSource)],
			generatedLuaModules: [],
			loadAddress: SYSTEM_ROM_BASE + imageStart,
			optLevel: 0,
			domain: 'system',
			ramByteCount: LINK_RAM_BYTES,
			biosExports: [],
		});
		const rebuilt = buildBlua32Tail(
			{ id: 'system', index, bytes: initialPayload },
			changed,
		);
		const rebuiltHeader = parseCartHeader(rebuilt.bytes);
		const rebuiltImageEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const rebuiltSymbolsEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;

		assert.equal(rebuiltImageEntry.start, imageStart);
		assert.equal(spriteEntry.metabuffer_start, metadataStart);
		assert.equal(spriteEntry.metabuffer_end, metadataEnd);
		assert.equal(rebuiltHeader.metadataOffset, initialHeader.metadataOffset);
		assert.equal(rebuiltHeader.metadataLength, initialHeader.metadataLength);
		assert.equal(rebuiltHeader.manifestOffset, initialHeader.manifestOffset);
		assert.equal(rebuiltHeader.manifestLength, initialHeader.manifestLength);
		assert.deepEqual(rebuilt.bytes.subarray(CART_ROM_HEADER_SIZE, imageStart), immutableBody);
		assert.deepEqual(rebuilt.bytes.subarray(metadataStart, metadataEnd), metadataBytes);
		assert.ok(rebuiltImageEntry.end! > initialImageEnd);
		assert.ok(rebuiltSymbolsEntry.end! > initialSymbolsEnd);
		assert.ok(rebuiltHeader.tocOffset > initialHeader.tocOffset);

		const rebuiltIndex = await parseCartridgeIndex(rebuilt.bytes);
		const rebuiltSprite = rebuiltIndex.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(rebuiltSprite.imgmeta, spriteEntry.imgmeta);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
