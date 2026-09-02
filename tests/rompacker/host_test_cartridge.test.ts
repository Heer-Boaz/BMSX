import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { buildLuaSources } from '../../ide/runtime/source_registry';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { buildLuaStackFrames } from '../../ide/runtime/stack_trace';
import { buildHostTestCartridge } from '../../scripts/bootrom/platforms/hostrunner/host_test_cartridge';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { decodeBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { loadBlua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { RomSourceStack } from '../../toolchain/ts/rompack/source';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import { parseCartridgePackage } from '../../machine/ts/rompack/image';

const ROOT = join(process.cwd(), 'tmp', 'host-test-cartridge-test');
const MANIFEST: CartManifest = { hardware: [{ type: 'rom' }] };
const TEST_SOURCE_PATH = 'tests/carts/example/example_assert.lua';

function luaEntry(source: string): RomAsset {
	return {
		resid: 'entry',
		type: 'lua',
		buffer: Buffer.from(source),
		compiled_buffer: compileLuaChunkBuffer(source, 'entry'),
		source_path: 'entry.lua',
		normalized_source_path: 'carts/example/entry.lua',
	};
}

test('host test cartridge packages authored test source without making it a startup module', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const systemSource = 'module<entry>\nreturn true';
		const systemAssets = [luaEntry(systemSource)];
		const systemLayout = layoutRomPrefix(systemAssets, true, MANIFEST, SYSTEM_ROM_ASSET_OFFSET);
		const systemBlua32 = buildRomBlua32Tail(systemAssets, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 0,
			ramByteCount: 0x00400000,
			domain: 'system',
			systemAssetEndOffset: systemLayout.nextOffset,
			biosExports: [],
		});
		await finalizeRompack('system', {
			debug: true,
			layout: systemLayout,
			outputDirectory: ROOT,
			blua32: systemBlua32,
		});

		const cartSource = 'module<entry>\nreturn true';
		const retainedDocument: RomAsset = {
			resid: 'retained-document',
			type: 'lua',
			buffer: Buffer.from('return "source only"'),
			source_path: 'docs/retained.lua',
			normalized_source_path: 'carts/example/docs/retained.lua',
		};
		const cartAssets = [luaEntry(cartSource), retainedDocument];
		const cartLayout = layoutRomPrefix(cartAssets, true, MANIFEST);
		const cartBlua32 = buildRomBlua32Tail(cartAssets, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 0,
			ramByteCount: 0x00400000,
			domain: 'cart',
			imageOffset: cartLayout.nextOffset,
			biosImports: decodeBlua32BiosImports(systemBlua32.biosImportsPayload),
		});
		await finalizeRompack('cart', {
			projectRootPath: 'carts/example',
			debug: true,
			layout: cartLayout,
			outputDirectory: ROOT,
			blua32: cartBlua32,
		});

		const systemRom = new Uint8Array(await readFile(join(ROOT, 'system.debug.rom')));
		const cartRom = new Uint8Array(await readFile(join(ROOT, 'cart.debug.rom')));
		const testSource = [
			'__bmsx_host_test = {}',
			'function __bmsx_host_test.ready()',
			'\treturn true',
			'end',
			'function __bmsx_host_test.setup()',
			'end',
			'function __bmsx_host_test.update()',
			"\tassert(false, 'mapped assertion')",
			'end',
		].join('\n');
		const enhanced = await buildHostTestCartridge(
			systemRom,
			cartRom,
			{
				sourcePath: TEST_SOURCE_PATH,
				source: testSource,
				updateTimestamp: 1234,
			},
			'host = {}',
		);
		const index = await parseCartridgeIndex(enhanced);
		const sourceEntry = index.entries.find(entry => entry.source_path === TEST_SOURCE_PATH)!;

		assert.equal(sourceEntry.type, 'lua');
		assert.equal(sourceEntry.compiled_start, undefined);
		assert.equal(sourceEntry.normalized_source_path, TEST_SOURCE_PATH);
		assert.equal(sourceEntry.update_timestamp, 1234);
		assert.equal(
			Buffer.from(enhanced.subarray(sourceEntry.start, sourceEntry.end)).toString('utf8'),
			testSource,
		);
		const retainedEntry = index.entries.find(entry => entry.resid === retainedDocument.resid)!;
		assert.equal(retainedEntry.compiled_start, undefined);
		assert.equal(
			Buffer.from(enhanced.subarray(retainedEntry.start, retainedEntry.end)).toString('utf8'),
			'return "source only"',
		);

		const cartPackage = parseCartridgePackage(enhanced);
		const toolingImage = loadBlua32ToolingImage(cartPackage, CART_ROM_BASE)!;
		const testModulePath = toLuaModulePath(TEST_SOURCE_PATH);
		const authoredRanges = toolingImage.symbols!.metadata.debugRanges.filter(
			range => range !== null && range.path === testModulePath,
		);
		assert.ok(authoredRanges.some(range => range!.start.line === 8 && range!.start.column === 2));
		const debugRangeIndex = toolingImage.symbols!.metadata.debugRanges.findIndex(
			range => range !== null
				&& range.path === testModulePath
				&& range.start.line === 8
				&& range.start.column === 2,
		);
		const tracePc = toolingImage.layout.header.textAddress + debugRangeIndex * INSTRUCTION_BYTES;
		const functionIndex = toolingImage.layout.functions.findIndex(
			fn => tracePc >= fn.codeAddress && tracePc < fn.codeAddress + fn.codeByteCount,
		);
		const fn = toolingImage.layout.functions[functionIndex];
		const media = await loadRomToolingMedia(systemRom, [enhanced, null]);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		const frames = buildLuaStackFrames(sources, [{
			executionDomainId: 0,
			toolingImage,
			functionAddress: fn.address,
			functionIndex,
			codeAddress: fn.codeAddress,
			codeByteCount: fn.codeByteCount,
			tracePc,
			registers: [],
			upvalues: [],
		}]);
		const authoredFrame = frames.find(
			frame => frame.kind === 'source' && frame.resource.path === TEST_SOURCE_PATH,
		)!;
		assert.equal(authoredFrame.kind, 'source');
		assert.equal(authoredFrame.line, 8);
		assert.equal(authoredFrame.column, 2);
		assert.equal(authoredFrame.workspacePath, TEST_SOURCE_PATH);

		const layer = { id: 'cart' as const, index, bytes: enhanced };
		const romSource = new RomSourceStack([layer]);
		const registry = buildLuaSources(romSource, romSource, index, 'cart');
		const testRecord = registry.path2lua[TEST_SOURCE_PATH];
		assert.equal(testRecord.program_module, false);
		assert.equal(testRecord.src, testSource);
		assert.equal(registry.module2lua[testModulePath], testRecord);
		assert.equal(registry.entrySourcePath, 'entry.lua');

		await assert.rejects(
			buildHostTestCartridge(
				systemRom,
				cartRom,
				{
					sourcePath: TEST_SOURCE_PATH,
					source: 'local value = 1\n@',
					updateTimestamp: 1235,
				},
				'host = {}',
			),
			(error: LuaSyntaxError) => error.path === TEST_SOURCE_PATH
				&& error.line === 2
				&& error.column === 1,
		);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
