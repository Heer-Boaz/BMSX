import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { alignRomAssetOffset } from '../../toolchain/ts/rompack/asset_layout';
import { SYSTEM_BLUA32_IMAGE_LIMIT } from '../../toolchain/ts/rompack/system';
import {
	parseCartHeader,
} from '../../machine/ts/rompack/format';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { buildRomAssetAddressLinkValuesFromSymbols } from '../../toolchain/ts/rompack/asset_symbols';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_symbols';
import { BLUA32_DIAGNOSTICS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_diagnostics';
import { RomSourceStack } from '../../toolchain/ts/rompack/source';
import {
	buildBlua32Tail,
	layoutBlua32PublicAssets,
} from '../../toolchain/ts/rompack/blua32_tail';
import {
	buildRomBlua32Tail,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';
import {
	buildBlua32Image,
	parseBlua32SourceModules,
} from '../../toolchain/ts/rompack/blua32_image_builder';

const ROOT = join(process.cwd(), 'tmp', 'blua32-tail-layout-test');
const ENTRY_PATH = 'entry.lua';
const LINK_RAM_BYTES = 0x00400000;

function luaAsset(source: string): RomAsset {
	const entrySource = `module<entry>\n${source}`;
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(entrySource),
		program_module: true,
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

test('system rebuilds compact assets behind the actual image while preserving payloads, metadata and the program base', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const initialSource = 'return 1';
		const authoredData = '# Tooling source, not a decoded runtime asset\nfont: "terminal"\n';
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
				sourcemeta: { text: authoredData },
			},
		];
		const blua32 = buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
			includeDiagnostics: true,
			includeSymbols: true,
			optLevel: 0,
			includeSources: true,
			domain: 'system',
			ramByteCount: LINK_RAM_BYTES,
			biosExports: [],
		});
		await finalizeRompack('tail', {
			debug: true,
			outputDirectory: ROOT,
			blua32,
		});

		const initialPayload = new Uint8Array(await readFile(join(ROOT, 'tail.debug.rom')));
		const index = { ...await loadRomAssetList(initialPayload, 'system'), cart_manifest: null };
		for (const id of [BLUA32_IMAGE_ID, BLUA32_SYMBOLS_IMAGE_ID, BLUA32_DIAGNOSTICS_IMAGE_ID])
			assert.equal(index.entries.find(entry => entry.resid === id)!.source_path, undefined, 'generated records have identity, not a fabricated source file');
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
		assert.equal(sourceStart, alignRomAssetOffset(initialImageEnd));
		assert.ok(initialPayload.byteLength < SYSTEM_BLUA32_IMAGE_LIMIT, 'unused program budget is not file padding');
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
			luaModules: parseBlua32SourceModules([luaAsset(changedSource)]),
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
		assert.ok(prelinkedFont.start! >= imageStart + changed.linked.bytes.byteLength);
		assert.equal(prelinkedFont.end! - prelinkedFont.start!, fontEnd - fontStart);
		assert.equal(prelinkedSprite.start! + 0x10000, largerImageSprite.start);
		assert.equal(prelinkedSprite.end! + 0x10000, largerImageSprite.end);
		assert.equal(prelinkedSprite.end! - prelinkedSprite.start!, editedSpriteBytes.byteLength);
		assert.ok(prelinkedSprite.end! <= prelinkedFont.start!);
		assert.equal(prelinkedAssetLayout.payloadEnd + 0x10000, largerImageAssetLayout.payloadEnd);
		assert.equal(prelinkedAssetLayout.nextOffset + 0x10000, largerImageAssetLayout.nextOffset);
		const rebuilt = buildBlua32Tail(
			systemLayer,
			changed.linked,
			changed.diagnosticSources,
		);
		const rebuiltHeader = parseCartHeader(rebuilt.bytes);
		const physicalDirectory = decodeRomToc(rebuilt.bytes.subarray(
			rebuiltHeader.tocOffset, rebuiltHeader.tocOffset + rebuiltHeader.tocLength,
		));
		assert.equal(rebuilt.index.entries.length, physicalDirectory.entries.length);
		for (const id of [BLUA32_IMAGE_ID, BLUA32_SYMBOLS_IMAGE_ID, BLUA32_DIAGNOSTICS_IMAGE_ID])
			assert.equal(rebuilt.index.entries.find(entry => entry.resid === id)!.source_path, undefined, 'derived builds preserve generated provenance');
		for (const entry of rebuilt.index.entries) {
			const physical = physicalDirectory.entries.find(candidate => candidate.type === entry.type && candidate.resid === entry.resid)!;
			assert.equal(entry.id_token_lo, physical.id_token_lo, `${entry.resid} publishes its encoded low token`);
			assert.equal(entry.id_token_hi, physical.id_token_hi, `${entry.resid} publishes its encoded high token`);
			assert.equal(entry.program_module, physical.program_module, `${entry.resid} publishes its encoded program flag`);
			assert.equal(entry.start, physical.start);
			assert.equal(entry.end, physical.end);
		}
		const rebuiltImageEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
		const rebuiltSymbolsEntry = rebuilt.index.entries.find(entry => entry.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		assert.ok(rebuilt.index.entries.every(entry => entry.payload_id === 'system'));
		const sourceStack = new RomSourceStack([rebuilt]);
		assert.deepEqual(sourceStack.getBytesView(rebuiltSymbolsEntry), rebuilt.bytes.subarray(rebuiltSymbolsEntry.start, rebuiltSymbolsEntry.end));

		assert.equal(rebuiltImageEntry.start, imageStart);
		assert.equal(spriteEntry.metabuffer_start, metadataStart);
		assert.equal(spriteEntry.metabuffer_end, metadataEnd);
		const movedSprite = rebuilt.index.entries.find(entry => entry.resid === 'sprite')!;
		assert.ok(movedSprite.start! >= rebuiltImageEntry.end!);
		assert.equal(movedSprite.imgmeta, spriteEntry.imgmeta, 'installed tooling retains decoded image metadata without re-decoding');
		assert.equal(rebuilt.index.entries.find(entry => entry.resid === 'terminal-font')!.sourcemeta, fontEntry.sourcemeta,
			'asset relocation retains the installed authored-source provenance');
		assert.equal(rebuiltHeader.metadataLength, initialHeader.metadataLength);
		assert.equal(rebuiltHeader.manifestOffset, initialHeader.manifestOffset);
		assert.equal(rebuiltHeader.manifestLength, initialHeader.manifestLength);
		assert.deepEqual(rebuilt.bytes.subarray(CART_ROM_HEADER_SIZE, imageStart), immutableBody);
		assert.deepEqual(rebuilt.bytes.subarray(movedSprite.metabuffer_start, movedSprite.metabuffer_end), metadataBytes);
		assert.deepEqual(rebuilt.bytes.subarray(movedSprite.start, movedSprite.end), spriteBytes);
		assert.ok(rebuiltImageEntry.end! > initialImageEnd);
		assert.ok(rebuiltSymbolsEntry.end! > initialSymbolsEnd);
		assert.ok(rebuiltHeader.tocOffset > initialHeader.tocOffset);

		const rebuiltIndex = await loadRomAssetList(rebuilt.bytes, 'system');
		const rebuiltSprite = rebuiltIndex.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(rebuiltSprite.imgmeta, spriteEntry.imgmeta);
		assert.equal(rebuiltIndex.entries.find(entry => entry.resid === 'terminal-font')!.sourcemeta!.text, authoredData);

		const assetEdited = buildBlua32Tail(
			systemLayer,
			changed.linked,
			changed.diagnosticSources,
			{ assetEdits: [['image', 'sprite', editedSpriteBytes]] },
		);
		const assetEditedFont = assetEdited.index.entries.find(entry => entry.resid === 'terminal-font')!;
		const assetEditedSprite = assetEdited.index.entries.find(entry => entry.resid === 'sprite')!;
		assert.equal(assetEditedFont.start, prelinkedFont.start);
		assert.equal(assetEditedFont.end, prelinkedFont.end);
		assert.deepEqual(assetEdited.bytes.subarray(assetEditedFont.start, assetEditedFont.end), fontBytes);
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
		const batchSource = batchEdited.index.entries.find(entry => entry.resid === 'entry')!;
		assert.deepEqual(batchEdited.bytes.subarray(batchSource.start, batchSource.end), sourceBytes);
		const editedIndex = await loadRomAssetList(batchEdited.bytes, 'system');
		assert.equal(editedIndex.entries.find(entry => entry.resid === 'terminal-font')!.sourcemeta!.text, authoredData);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
