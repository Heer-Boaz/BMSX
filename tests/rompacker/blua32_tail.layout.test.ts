import assert from 'node:assert/strict';
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
import { buildRomAssetAddressLinkValuesFromSymbols } from '../../toolchain/ts/rompack/asset_symbols';
import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import {
	buildBlua32Tail,
	layoutBlua32PublicAssets,
} from '../../toolchain/ts/rompack/blua32_tail';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	SYSTEM_ROM_ASSET_OFFSET,
} from '../../toolchain/ts/rompack/system';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';
import {
	buildBlua32Image,
	decodeBlua32SourceModules,
} from '../../toolchain/ts/rompack/blua32_image_builder';

const ROOT = join(process.cwd(), 'tmp', 'blua32-tail-layout-test');
const ENTRY_PATH = 'entry.lua';
const LINK_RAM_BYTES = 0x00400000;
const MANIFEST: CartManifest = { hardware: [{ type: 'rom' }] };

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

test('BLua32 asset relocation keeps final payload lengths concrete', () => {
	const values = buildRomAssetAddressLinkValuesFromSymbols([{
		name: 'aem_events',
		assetId: 'events',
		assetType: 'aem',
		payloadId: 'cart',
		offset: 0x1234,
		address: 0x00801234,
		byteLength: 6156,
	}]);
	assert.deepEqual(Array.from(values), [['aem_events_addr', 0x00801234]]);
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
					gx_atlas_id: 'texture',
				},
			},
			{
				resid: 'terminal-font',
				type: 'data',
				buffer: Buffer.from([0x44, 0x55, 0x66, 0x77]),
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
			layout,
			outputDirectory: ROOT,
			blua32,
		});

		const initialPayload = new Uint8Array(await readFile(join(ROOT, 'tail.debug.rom')));
		const index = await parseCartridgeIndex(initialPayload);
		const imageEntry = index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const symbolsEntry = index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		const sourceEntry = index.entries.find(entry => entry.type === 'lua' && entry.resid === 'entry')!;
		const fontEntry = index.entries.find(entry => entry.resid === 'terminal-font')!;
		const spriteEntry = index.entries.find(entry => entry.resid === 'sprite')!;
		const initialHeader = parseCartHeader(initialPayload);
		const imageStart = imageEntry.start!;
		const initialImageEnd = imageEntry.end!;
		const initialSymbolsEnd = symbolsEntry.end!;
		const sourceStart = sourceEntry.start!;
		const sourceEnd = sourceEntry.end!;
		const sourceBytes = initialPayload.slice(sourceStart, sourceEnd);
		const metadataStart = spriteEntry.metabuffer_start!;
		const metadataEnd = spriteEntry.metabuffer_end!;
		const spriteStart = spriteEntry.start!;
		const spriteEnd = spriteEntry.end!;
		const spriteBytes = initialPayload.slice(spriteStart, spriteEnd);
		const fontStart = fontEntry.start!;
		const fontEnd = fontEntry.end!;
		const fontBytes = initialPayload.slice(fontStart, fontEnd);
		const immutableBody = initialPayload.slice(CART_ROM_HEADER_SIZE, imageStart);
		const metadataBytes = initialPayload.slice(metadataStart, metadataEnd);

		const changedSource = `local value = 0\n${'value = value + 1\n'.repeat(128)}return value`;
		const changed = buildBlua32Image({
			luaModules: decodeBlua32SourceModules([luaAsset(changedSource)]),
			generatedLuaModules: [],
			loadAddress: SYSTEM_ROM_BASE + imageStart,
			optLevel: 0,
			traceStatements: 'erase',
			domain: 'system',
			ramByteCount: LINK_RAM_BYTES,
			biosExports: [],
		});
		const editedSpriteBytes = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd, 0xee);
		const systemLayer = { id: 'system' as const, index, bytes: initialPayload };
		const prelinkedAssetLayout = layoutBlua32PublicAssets(
			systemLayer,
			changed.linked.bytes.byteLength,
			{ assetEdits: [['image', 'sprite', editedSpriteBytes]] },
		);
		const largerImageAssetLayout = layoutBlua32PublicAssets(
			systemLayer,
			changed.linked.bytes.byteLength + 0x10000,
			{ assetEdits: [['image', 'sprite', editedSpriteBytes]] },
		);
		const prelinkedSprite = prelinkedAssetLayout.entries.find(entry => entry.resid === 'sprite')!;
		const largerImageSprite = largerImageAssetLayout.entries.find(entry => entry.resid === 'sprite')!;
		const prelinkedFont = prelinkedAssetLayout.entries.find(entry => entry.resid === 'terminal-font')!;
		assert.equal(prelinkedFont.start, fontStart);
		assert.equal(prelinkedFont.end, fontEnd);
		assert.equal(prelinkedSprite.start, largerImageSprite.start);
		assert.equal(prelinkedSprite.end, largerImageSprite.end);
		assert.equal(prelinkedSprite.end! - prelinkedSprite.start!, editedSpriteBytes.byteLength);
		assert.ok(prelinkedSprite.start! >= fontEnd);
		assert.equal(prelinkedAssetLayout.payloadEnd, largerImageAssetLayout.payloadEnd);
		assert.equal(prelinkedAssetLayout.nextOffset, largerImageAssetLayout.nextOffset);
		const rebuilt = buildBlua32Tail(
			systemLayer,
			changed.linked,
			changed.diagnosticSources,
		);
		const rebuiltHeader = parseCartHeader(rebuilt.bytes);
		const rebuiltImageEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const rebuiltSymbolsEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;

		assert.equal(rebuiltImageEntry.start, imageStart);
		assert.equal(spriteEntry.metabuffer_start, metadataStart);
		assert.equal(spriteEntry.metabuffer_end, metadataEnd);
		assert.equal(rebuilt.index.entries.find(entry => entry.resid === 'sprite')!.start, spriteStart);
		assert.equal(rebuilt.index.entries.find(entry => entry.resid === 'sprite')!.end, spriteEnd);
		assert.equal(rebuiltHeader.metadataOffset, initialHeader.metadataOffset);
		assert.equal(rebuiltHeader.metadataLength, initialHeader.metadataLength);
		assert.equal(rebuiltHeader.manifestOffset, initialHeader.manifestOffset);
		assert.equal(rebuiltHeader.manifestLength, initialHeader.manifestLength);
		assert.deepEqual(rebuilt.bytes.subarray(CART_ROM_HEADER_SIZE, imageStart), immutableBody);
		assert.deepEqual(rebuilt.bytes.subarray(metadataStart, metadataEnd), metadataBytes);
		assert.deepEqual(rebuilt.bytes.subarray(spriteStart, spriteEnd), spriteBytes);
		assert.ok(rebuiltImageEntry.end! > initialImageEnd);
		assert.ok(rebuiltSymbolsEntry.end! > initialSymbolsEnd);
		assert.ok(rebuiltHeader.tocOffset > initialHeader.tocOffset);

		const rebuiltIndex = await parseCartridgeIndex(rebuilt.bytes);
		const rebuiltSprite = rebuiltIndex.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(rebuiltSprite.imgmeta, spriteEntry.imgmeta);

		const assetEdited = buildBlua32Tail(
			systemLayer,
			changed.linked,
			changed.diagnosticSources,
			{ assetEdits: [['image', 'sprite', editedSpriteBytes]] },
		);
		const assetEditedFont = assetEdited.index.entries.find(entry => entry.resid === 'terminal-font')!;
		const assetEditedSprite = assetEdited.index.entries.find(entry => entry.resid === 'sprite')!;
		assert.equal(assetEditedFont.start, fontStart);
		assert.equal(assetEditedFont.end, fontEnd);
		assert.deepEqual(assetEdited.bytes.subarray(fontStart, fontEnd), fontBytes);
		assert.notEqual(assetEditedSprite.start, spriteStart);
		assert.deepEqual(
			assetEdited.bytes.subarray(assetEditedSprite.start!, assetEditedSprite.end!),
			editedSpriteBytes,
		);

		const editedFontBytes = Uint8Array.of(0x91, 0x92, 0x93);
		const batchEdited = buildBlua32Tail(
			systemLayer,
			changed.linked,
			changed.diagnosticSources,
			{
				assetEdits: [
					['image', 'sprite', editedSpriteBytes],
					['data', 'terminal-font', editedFontBytes],
				],
			},
		);
		const batchEditedFont = batchEdited.index.entries.find(entry => entry.resid === 'terminal-font')!;
		const batchEditedSprite = batchEdited.index.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(
			batchEdited.bytes.subarray(batchEditedFont.start!, batchEditedFont.end!),
			editedFontBytes,
		);
		assert.deepEqual(
			batchEdited.bytes.subarray(batchEditedSprite.start!, batchEditedSprite.end!),
			editedSpriteBytes,
		);
		assert.deepEqual(batchEdited.bytes.subarray(sourceStart, sourceEnd), sourceBytes);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
