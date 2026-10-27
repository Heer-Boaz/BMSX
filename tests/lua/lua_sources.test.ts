import { compiledBlua32Sources } from '../../toolchain/ts/rompack/blua32_sources';
import { collectInstalledProgramSources } from '../../ide/runtime/program_sources';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RawRomSource } from '../../toolchain/ts/rompack/source';
import {
	BLUA32_FIRMWARE_MODULE_PATH,
	BLUA32_FIRMWARE_SOURCE_PATH,
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_DISPLAY_PRESET_SOURCE_PATH,
	GX_REGISTER_MODULE_PATH,
	GX_REGISTER_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
import type {
	CartridgeIndex,
	RomAsset,
} from '../../toolchain/ts/rompack/assets';
import type { RomImageDomain } from '../../machine/ts/rompack/image';
import { buildLuaSources, captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import {
	ROM_TOC_HEADER_SIZE,
	ROM_TOC_INVALID_U32,
} from '../../machine/ts/spec/bmsx/rom_toc';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { collectProgramSources } from '../../ide/runtime/program_sources';

const textEncoder = new TextEncoder();

class TestRomSource implements RawRomSource {
	public constructor(
		private readonly entries: RomAsset[],
		private readonly sources: Record<string, string>,
	) {
	}

	public getEntry(id: string): RomAsset | null {
		for (const entry of this.entries) {
			if (entry.resid === id) {
				return entry;
			}
		}
		return null;
	}

	public getEntryByPath(path: string): RomAsset | null {
		for (const entry of this.entries) {
			if (entry.source_path === path) {
				return entry;
			}
		}
		return null;
	}

	public getBytes(entry: RomAsset): Uint8Array {
		const source = this.sources[entry.resid];
		assert.notEqual(source, undefined);
		return textEncoder.encode(source);
	}

	public getBytesView(entry: RomAsset): Uint8Array {
		const source = this.sources[entry.resid];
		assert.notEqual(source, undefined);
		return textEncoder.encode(source);
	}

	public list(type?: string): RomAsset[] {
		if (type === undefined) {
			return this.entries;
		}
		return this.entries.filter(entry => entry.type === type);
	}
}

function makeIndex(entries: RomAsset[]): CartridgeIndex {
	return {
		entries,
		projectRootPath: 'carts/test',
		cart_manifest: null,
	};
}

function luaEntry(resid: string, sourcePath: string, payloadId: RomImageDomain, updateTimestamp: number): RomAsset {
	return {
		resid,
		type: 'lua',
		source_path: sourcePath,
		normalized_source_path: sourcePath,
		payload_id: payloadId,
		update_timestamp: updateTimestamp,
		program_module: true,
	};
}

test('buildLuaSources registers real Lua assets in one pass', () => {
	const cartEntry = luaEntry('main', 'cart.lua', 'cart', 11);
	const activeEntry = luaEntry('main', 'cart.lua', 'cart', 22);
	const systemEntry = luaEntry('sys', 'kernel/interrupts.lua', 'system', 0);
	const cartSource = new TestRomSource([cartEntry], {
		main: 'module<entry>\nreturn 1',
	});
	const activeSource = new TestRomSource([activeEntry, systemEntry], {
		main: 'module<entry>\nreturn 2',
		sys: 'return 3',
	});

	const registry = buildLuaSources(cartSource, activeSource, makeIndex([cartEntry]), 'cart', 'cart', []);
	const record = registry.path2lua['cart.lua'];

	assert.equal(registry.can_boot_from_source, true);
	assert.equal(record.src, 'module<entry>\nreturn 2');
	assert.equal(record.base_src, 'module<entry>\nreturn 1');
	assert.equal(record.module_path, 'cart');
	assert.equal(record.normalized_source_path, 'cart.lua');
	assert.equal(record.update_timestamp, 22);
	assert.equal(record.generated, false);
	assert.equal(record.program_module, true);
	assert.equal(registry.module2lua[ROM_ASSET_SYMBOL_MODULE_PATH].generated, true);
	const displayPresets = registry.module2lua[GX_DISPLAY_PRESET_MODULE_PATH];
	assert.equal(displayPresets.source_path, GX_DISPLAY_PRESET_SOURCE_PATH);
	assert.equal(displayPresets.src, GX_DISPLAY_PRESET_MODULE_SOURCE);
	assert.equal(displayPresets.base_src, GX_DISPLAY_PRESET_MODULE_SOURCE);
	assert.equal(displayPresets.generated, true);
	assert.equal(registry.path2lua[GX_DISPLAY_PRESET_SOURCE_PATH], displayPresets);
	const gxRegisters = registry.module2lua[GX_REGISTER_MODULE_PATH];
	assert.equal(gxRegisters.source_path, GX_REGISTER_SOURCE_PATH);
	assert.equal(gxRegisters.src, GX_REGISTER_MODULE_SOURCE);
	assert.equal(gxRegisters.base_src, GX_REGISTER_MODULE_SOURCE);
	assert.equal(gxRegisters.generated, true);
	assert.equal(registry.path2lua[GX_REGISTER_SOURCE_PATH], gxRegisters);
	assert.equal(registry.module2lua.cart, record);
	assert.equal(registry.path2lua['kernel/interrupts.lua'], undefined);
});

test('buildLuaSources retains source-only Lua without admitting it to the program', () => {
	const entry = luaEntry('main', 'cart.lua', 'cart', 11);
	const testSource: RomAsset = {
		resid: '__test_source__',
		type: 'lua',
		program_module: false,
		source_path: 'tests/carts/test/cart_assert.lua',
		normalized_source_path: 'tests/carts/test/cart_assert.lua',
		payload_id: 'cart',
		update_timestamp: 12,
	};
	const source = new TestRomSource([entry, testSource], {
		main: 'module<entry>\nreturn 1',
		__test_source__: 'return { kind=\'unit\', tests={ sample=function() end } }',
	});

	const registry = buildLuaSources(source, source, makeIndex([entry, testSource]), 'cart', 'cart', []);
	const retained = registry.path2lua['tests/carts/test/cart_assert.lua'];

	assert.equal(registry.can_boot_from_source, true);
	assert.equal(retained.program_module, false);
	assert.equal(retained.src, 'return { kind=\'unit\', tests={ sample=function() end } }');
	assert.equal(retained.normalized_source_path, 'tests/carts/test/cart_assert.lua');
	assert.equal(registry.module2lua['tests/carts/test/cart_assert'], retained);
	assert.equal(registry.entrySourcePath, 'cart.lua');
});

test('packed Scenario sources in the library tree keep their source-only role', () => {
	const entry = luaEntry('main', 'entry.lua', 'cart', 1);
	const testPath = 'cartlib/example_assert.lua';
	const scenario = { ...luaEntry(scenarioTestAssetId(testPath), testPath, 'cart', 1), program_module: false };
	const source = new TestRomSource([entry, scenario], {
		main: 'module<entry>\nreturn 1', [scenario.resid]: 'return (',
	});
	const registry = buildLuaSources(source, source, makeIndex([entry, scenario]), 'cart', 'entry', []);
	assert.equal(registry.path2lua[testPath].sourceKind, 'source-only');
	const selected = collectProgramSources(registry, registry.entrySourcePath, []);
	assert.equal(selected.parsed.has('cartlib/example_assert'), false);
});

test('release BLua32 images do not synthesize editable Lua source records', () => {
	const imageEntry: RomAsset = { resid: BLUA32_IMAGE_ID, type: 'code', payload_id: 'system' };
	const source = new TestRomSource([imageEntry], {});
	const registry = buildLuaSources(source, source, makeIndex([imageEntry]), 'system', undefined, []);

	assert.equal(registry.can_boot_from_source, false);
	assert.deepEqual(registry.records, []);
	assert.equal(registry.path2lua['boot/bootrom.lua'], undefined);
});

test('system source registry retains the BLua32 compile-time firmware module', () => {
	const entry = luaEntry('boot', 'boot.lua', 'system', 0);
	const source = new TestRomSource([entry], {
		boot: 'module<entry>\nreturn require(\'bmsx/blua32\').instruction_bytes',
	});
	const registry = buildLuaSources(source, source, makeIndex([entry]), 'system', 'boot', []);
	const firmware = registry.module2lua[BLUA32_FIRMWARE_MODULE_PATH];

	assert.equal(firmware.source_path, BLUA32_FIRMWARE_SOURCE_PATH);
	assert.equal(firmware.src, BLUA32_FIRMWARE_MODULE_SOURCE);
	assert.equal(firmware.generated, true);
	const displayPresets = registry.module2lua[GX_DISPLAY_PRESET_MODULE_PATH];
	assert.equal(displayPresets.source_path, GX_DISPLAY_PRESET_SOURCE_PATH);
	assert.equal(displayPresets.src, GX_DISPLAY_PRESET_MODULE_SOURCE);
	assert.equal(displayPresets.generated, true);
	const gxRegisters = registry.module2lua[GX_REGISTER_MODULE_PATH];
	assert.equal(gxRegisters.source_path, GX_REGISTER_SOURCE_PATH);
	assert.equal(gxRegisters.src, GX_REGISTER_MODULE_SOURCE);
	assert.equal(gxRegisters.generated, true);
});

test('ROM TOC decode gives Lua assets an explicit zero update timestamp', () => {
	const toc = encodeRomToc({
			entries: [
				{ resid: 'main', type: 'lua', source_path: 'cart.lua' },
				{ resid: BLUA32_IMAGE_ID, type: 'code' },
			],
		projectRootPath: 'carts/test',
	});
	const decoded = decodeRomToc(toc);

	assert.equal(decoded.entries[0].update_timestamp, 0);
	assert.equal(decoded.entries[1].update_timestamp, undefined);
});

test('ROM TOC decode rejects incomplete payload ranges', () => {
	const toc = encodeRomToc({
		entries: [{ resid: 'raw', type: 'bin', start: 0x100, end: 0x120 }],
	});
	new DataView(toc.buffer, toc.byteOffset, toc.byteLength).setUint32(
		ROM_TOC_HEADER_SIZE + 44,
		ROM_TOC_INVALID_U32,
		true,
	);

	assert.throws(() => decodeRomToc(toc), /incomplete payload range/);
});

test('toLuaModulePath normalizes source paths through the loader contract', () => {
	assert.equal(toLuaModulePath('cart.lua'), 'cart');
	assert.equal(toLuaModulePath('system/font.lua'), 'system/font');
	assert.equal(toLuaModulePath('carts/pietious/cart.lua'), 'cart');
	assert.equal(toLuaModulePath('carts/pietious/room/room.lua'), 'room/room');
	assert.equal(toLuaModulePath('carts\\pietious\\room\\room.lua'), 'room/room');
});


for (const entrySourcePath of ['stripped_entry', undefined]) test(`partial embedded source retains its available files without an authored entry (${entrySourcePath})`, () => {
	const available = luaEntry('available', 'available.lua', 'cart', 1);
	const source = new TestRomSource([available], { available: 'return 17' });
	const registry = buildLuaSources(source, source, makeIndex([available]), 'cart', entrySourcePath, []);
	assert.equal(registry.can_boot_from_source, false);
	assert.equal(registry.entrySourcePath, '');
	assert.equal(registry.module2lua.available.src, 'return 17');
	const captured = captureInstalledLuaSources(registry, ['stripped_entry', 'available']);
	assert.deepEqual([...captured.keys()], ['available']);
	assert.equal(captured.get('available')!.displayPath, 'available.lua');
});

test('installed source capture joins compiler membership to available text, never packed directory flags', () => {
	const entry = luaEntry('entry', 'entry.lua', 'cart', 1);
	const included = { ...luaEntry('included', 'module/included.lua', 'cart', 1), program_module: false };
	const unused = luaEntry('unused', 'unused.lua', 'cart', 1);
	const source = new TestRomSource([entry, included, unused], { entry: 'module<entry>\nreturn 17', included: 'return 29', unused: 'return 37' });
	const registry = buildLuaSources(source, source, makeIndex([entry, included, unused]), 'cart', 'entry', []);
	const captured = captureInstalledLuaSources(registry, ['entry', 'module/included', 'stripped']);
	assert.deepEqual([...captured.keys()], ['entry', 'module/included']);
	assert.equal(captured.get('module/included')!.displayPath, 'module/included.lua');
	assert.equal(captured.has('unused'), false);
});

test('installed compilation consumes the direct-input manifest while retaining mapped diagnostic proof', () => {
	const sources = compiledBlua32Sources(new Map([
		['compiler_entry', { displayPath: 'generated/entry.lua', source: 'module<entry>\nreturn 17' }],
		['compiler_library', { displayPath: 'generated/library.lua', source: 'return 29' }],
		['authored_origin', { displayPath: 'authored/origin.yaml', source: 'this: is: not: a: Lua: compiler: input' }],
	]));
	assert.equal(sources.has('authored_origin'), true);
	const selected = collectInstalledProgramSources(sources, ['compiler_entry', 'compiler_library']);
	assert.equal(selected.entry.path, 'compiler_entry');
	assert.deepEqual(selected.modules.map(module => module.path), ['compiler_library']);
	assert.equal(selected.parsed.has('authored_origin'), false);
	assert.throws(() => collectInstalledProgramSources(sources, ['missing_compiler_input']), /no embedded source text/);
});
