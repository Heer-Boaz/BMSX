import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { BLUA32_IMAGE_ID } from '../../machine/ts/machine/cpu/blua32_image';
import { CART_ROM_HEADER_SIZE, parseCartHeader, type RomAsset, type RomManifest } from '../../machine/ts/rompack/format';
import { parseCartridgeIndex } from '../../machine/ts/rompack/loader';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../machine/ts/rompack/tooling/blua32_symbols';
import { buildBlua32Tail } from '../../machine/ts/rompack/tooling/blua32_tail';
import { layoutRomPrefix } from '../../machine/ts/rompack/tooling/rom_prefix_layout';
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
const MANIFEST: RomManifest = {
	machine: { namespace: 'blua32-tail-layout-test', vdp_class: 'psx' },
	lua: { entry_path: ENTRY_PATH },
};

function luaAsset(source: string): RomAsset {
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(source),
		compiled_buffer: compileLuaChunkBuffer(source, ENTRY_PATH),
		source_path: ENTRY_PATH,
	};
}

test('release system ROM keeps BLua32 symbols in the linker sidecar only', async () => {
	await rm(RELEASE_ROOT, { recursive: true, force: true });
	try {
		await mkdir(RELEASE_ROOT, { recursive: true });
		const assets = [luaAsset('return 1')];
		const layout = layoutRomPrefix(assets, false, MANIFEST);
		const blua32 = buildRomBlua32Tail(assets, ENTRY_PATH, {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: false,
			optLevel: 0,
			imageOffset: layout.blua32Offset,
			domain: 'system',
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

		const sidecar = await readFile(`${romPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`);
		const expected = Buffer.from(
			blua32.symbolsPayload.buffer,
			blua32.symbolsPayload.byteOffset,
			blua32.symbolsPayload.byteLength,
		);
		assert.equal(sidecar.equals(expected), true);
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
		const layout = layoutRomPrefix(assets, true, MANIFEST);
		const blua32 = buildRomBlua32Tail(assets, ENTRY_PATH, {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 0,
			imageOffset: layout.blua32Offset,
			domain: 'system',
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
			externalLuaAssets: [],
			generatedLuaModules: [],
			entryPath: ENTRY_PATH,
			loadAddress: SYSTEM_ROM_BASE + imageStart,
			optLevel: 0,
			domain: 'system',
		});
		const rebuilt = buildBlua32Tail(
			{ id: 'system', index, payload: initialPayload },
			changed,
		);
		const rebuiltHeader = parseCartHeader(rebuilt.payload);
		const rebuiltImageEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const rebuiltSymbolsEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;

		assert.equal(rebuiltImageEntry.start, imageStart);
		assert.equal(spriteEntry.metabuffer_start, metadataStart);
		assert.equal(spriteEntry.metabuffer_end, metadataEnd);
		assert.equal(rebuiltHeader.metadataOffset, initialHeader.metadataOffset);
		assert.equal(rebuiltHeader.metadataLength, initialHeader.metadataLength);
		assert.equal(rebuiltHeader.manifestOffset, initialHeader.manifestOffset);
		assert.equal(rebuiltHeader.manifestLength, initialHeader.manifestLength);
		assert.deepEqual(rebuilt.payload.subarray(CART_ROM_HEADER_SIZE, imageStart), immutableBody);
		assert.deepEqual(rebuilt.payload.subarray(metadataStart, metadataEnd), metadataBytes);
		assert.ok(rebuiltImageEntry.end! > initialImageEnd);
		assert.ok(rebuiltSymbolsEntry.end! > initialSymbolsEnd);
		assert.ok(rebuiltHeader.tocOffset > rebuiltSymbolsEntry.end!);
		assert.ok(rebuiltHeader.tocOffset > initialHeader.tocOffset);

		const rebuiltIndex = await parseCartridgeIndex(rebuilt.payload);
		const rebuiltSprite = rebuiltIndex.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(rebuiltSprite.imgmeta, spriteEntry.imgmeta);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
