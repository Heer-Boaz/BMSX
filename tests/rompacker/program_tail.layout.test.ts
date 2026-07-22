import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { PROGRAM_IMAGE_ID, PROGRAM_SYMBOLS_IMAGE_ID } from '../../machine/ts/machine/program/loader';
import { CART_ROM_HEADER_SIZE, type RomAsset, type RomManifest } from '../../machine/ts/rompack/format';
import { parseCartridgeIndex, parseCartHeader } from '../../machine/ts/rompack/loader';
import { buildProgramTail } from '../../machine/ts/rompack/tooling/program_tail';
import { layoutRomProgramPrefix } from '../../machine/ts/rompack/tooling/rom_layout';
import { buildRomProgramTail, compileLuaChunkBuffer, finalizeRompack } from '../../scripts/rompacker/rombuilder';
import { buildProgramImage } from '../../scripts/rompacker/program_image_builder';

const ROOT = join(process.cwd(), 'tmp', 'program-tail-layout-test');
const ENTRY_PATH = 'entry.lua';
const MANIFEST: RomManifest = {
	machine: { namespace: 'program-tail-layout-test', vdp_class: 'psx' },
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

test('program-tail rebuild preserves immutable asset metadata addresses and bytes', async () => {
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
		const layout = layoutRomProgramPrefix(assets, true, MANIFEST);
		const program = buildRomProgramTail(assets, ENTRY_PATH, {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 0,
			programOffset: layout.programOffset,
			programDomain: 'system',
		});
		await finalizeRompack('tail', {
			debug: true,
			layout,
			outputDirectory: ROOT,
			program,
			zipRom: false,
		});

		const initialPayload = new Uint8Array(await readFile(join(ROOT, 'tail.debug.rom')));
		const index = await parseCartridgeIndex(initialPayload);
		const programEntry = index.entries.find(entry => entry.resid === PROGRAM_IMAGE_ID)!;
		const symbolsEntry = index.entries.find(entry => entry.resid === PROGRAM_SYMBOLS_IMAGE_ID)!;
		const spriteEntry = index.entries.find(entry => entry.resid === 'sprite')!;
		const initialHeader = parseCartHeader(initialPayload);
		const programStart = programEntry.start!;
		const initialProgramEnd = programEntry.end!;
		const initialSymbolsEnd = symbolsEntry.end!;
		const metadataStart = spriteEntry.metabuffer_start!;
		const metadataEnd = spriteEntry.metabuffer_end!;
		const immutableBody = initialPayload.slice(CART_ROM_HEADER_SIZE, programStart);
		const metadataBytes = initialPayload.slice(metadataStart, metadataEnd);

		const changedSource = `local value = 0\n${'value = value + 1\n'.repeat(128)}return value`;
		const changed = buildProgramImage({
			luaAssets: [luaAsset(changedSource)],
			externalLuaAssets: [],
			generatedLuaModules: [],
			entryPath: ENTRY_PATH,
			loadAddress: SYSTEM_ROM_BASE + programStart,
			optLevel: 0,
			programDomain: 'system',
		});
		const rebuilt = buildProgramTail(
			{ id: 'system', index, payload: initialPayload },
			changed.image,
			changed.metadata!,
		);
		const rebuiltHeader = parseCartHeader(rebuilt.payload);

		assert.equal(programEntry.start, programStart);
		assert.equal(spriteEntry.metabuffer_start, metadataStart);
		assert.equal(spriteEntry.metabuffer_end, metadataEnd);
		assert.equal(rebuiltHeader.metadataOffset, initialHeader.metadataOffset);
		assert.equal(rebuiltHeader.metadataLength, initialHeader.metadataLength);
		assert.equal(rebuiltHeader.manifestOffset, initialHeader.manifestOffset);
		assert.equal(rebuiltHeader.manifestLength, initialHeader.manifestLength);
		assert.deepEqual(rebuilt.payload.subarray(CART_ROM_HEADER_SIZE, programStart), immutableBody);
		assert.deepEqual(rebuilt.payload.subarray(metadataStart, metadataEnd), metadataBytes);
		assert.ok(programEntry.end! > initialProgramEnd);
		assert.ok(symbolsEntry.end! > initialSymbolsEnd);
		assert.ok(rebuiltHeader.tocOffset > symbolsEntry.end!);
		assert.ok(rebuiltHeader.tocOffset > initialHeader.tocOffset);

		const rebuiltIndex = await parseCartridgeIndex(rebuilt.payload);
		const rebuiltSprite = rebuiltIndex.entries.find(entry => entry.resid === 'sprite')!;
		assert.deepEqual(rebuiltSprite.imgmeta, spriteEntry.imgmeta);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
