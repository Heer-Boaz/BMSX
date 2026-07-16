import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { RomSourceStack, type RawRomSource } from '../../machine/ts/rompack/source';
import {
	CART_ROM_HEADER_SIZE,
	CART_ROM_MAGIC_BYTES,
	CART_VDP_CLASS_PSX,
	GX_TEXTURE_LAYOUT_MODULE_PATH,
	GX_TEXTURE_LAYOUT_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	type CartridgeIndex,
	type CartridgeLayerId,
	type RomAsset,
} from '../../machine/ts/rompack/format';
import { buildLuaSources } from '../../machine/ts/lua/source_registry';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_IMAGE_ID, toLuaModulePath } from '../../machine/ts/machine/program/loader';
import { parseCartridgeIndex } from '../../machine/ts/rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH } from '../../machine/ts/core/system';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { encodeRomToc } from '../../machine/ts/rompack/tooling/toc_encode';
import { buildGxTextureLayoutModuleSource, type GxTextureLayout } from '../../scripts/rompacker/gx_texture_layout';
import { parseLuaChunk } from './cpu_test_harness';

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

function makeIndex(entryPath: string, entries: RomAsset[]): CartridgeIndex {
	return {
		entries,
		projectRootPath: 'carts/test',
		cart_manifest: null,
		machine: { namespace: 'test' } as CartridgeIndex['machine'],
		entry_path: entryPath,
	};
}

function luaEntry(resid: string, sourcePath: string, payloadId: CartridgeLayerId, updateTimestamp: number): RomAsset {
	return {
		resid,
		type: 'lua',
		source_path: sourcePath,
		payload_id: payloadId,
		update_timestamp: updateTimestamp,
	};
}

test('buildLuaSources registers real Lua assets in one pass', () => {
	const cartEntry = luaEntry('main', 'cart.lua', 'cart', 11);
	const activeEntry = luaEntry('main', 'cart.lua', 'cart', 22);
	const generatedEntry = luaEntry(GX_TEXTURE_LAYOUT_MODULE_PATH, GX_TEXTURE_LAYOUT_SOURCE_PATH, 'cart', 0);
	const systemEntry = luaEntry('sys', 'bios/system.lua', 'system', 0);
	const cartSource = new TestRomSource([cartEntry, generatedEntry], {
		main: 'return 1',
		[GX_TEXTURE_LAYOUT_MODULE_PATH]: 'return { source_addr = 1 }',
	});
	const activeSource = new TestRomSource([activeEntry, generatedEntry, systemEntry], {
		main: 'return 2',
		[GX_TEXTURE_LAYOUT_MODULE_PATH]: 'return { source_addr = 1 }',
		sys: 'return 3',
	});

	const registry = buildLuaSources(cartSource, activeSource, makeIndex('cart.lua', [cartEntry]), ['cart']);
	const record = registry.path2lua['cart.lua'];

	assert.equal(registry.can_boot_from_source, true);
	assert.equal(record.src, 'return 2');
	assert.equal(record.base_src, 'return 1');
	assert.equal(record.module_path, 'cart');
	assert.equal(record.update_timestamp, 22);
	assert.equal(record.generated, false);
	assert.equal(registry.module2lua[GX_TEXTURE_LAYOUT_MODULE_PATH].generated, true);
	assert.equal(registry.module2lua[ROM_ASSET_SYMBOL_MODULE_PATH].generated, true);
	assert.equal(registry.module2lua.cart, record);
	assert.equal(registry.path2lua['bios/system.lua'], undefined);
});

test('debug package source boot resolves the persisted GX texture layout module', async () => {
	const layout: GxTextureLayout = {
		reserved: {},
		slots: {
			scene: { texture: { x: 64, y: 256, width: 128, height: 128 } },
		},
		groups: {
			0: { mode: 'direct16', slots: ['scene'], page_local: true },
		},
		working_sets: {
			gameplay: ['scene'],
		},
	};
	const cartSource = [
		`local texture_layout<const> = require('${GX_TEXTURE_LAYOUT_MODULE_PATH}')`,
		'return texture_layout.scene',
	].join('\n');
	const layoutSource = buildGxTextureLayoutModuleSource(layout);
	const cartBytes = textEncoder.encode(cartSource);
	const layoutBytes = textEncoder.encode(layoutSource);
	const cartStart = CART_ROM_HEADER_SIZE;
	const layoutStart = cartStart + cartBytes.byteLength;
	const cartEntry: RomAsset = {
		...luaEntry('cart', 'cart.lua', 'cart', 1),
		start: cartStart,
		end: layoutStart,
	};
	const layoutEntry: RomAsset = {
		...luaEntry(GX_TEXTURE_LAYOUT_MODULE_PATH, GX_TEXTURE_LAYOUT_SOURCE_PATH, 'cart', 0),
		start: layoutStart,
		end: layoutStart + layoutBytes.byteLength,
	};
	const manifest = encodeBinary({
		rom_name: 'source_boot_test',
		machine: { namespace: 'source_boot_test', vdp_class: 'psx' },
		lua: { entry_path: 'cart.lua' },
	});
	const manifestStart = layoutStart + layoutBytes.byteLength;
	const toc = encodeRomToc({ entries: [cartEntry, layoutEntry], projectRootPath: 'carts/source_boot_test' });
	const tocStart = manifestStart + manifest.byteLength;
	const payload = new Uint8Array(tocStart + toc.byteLength);
	payload.set(CART_ROM_MAGIC_BYTES, 0);
	payload.set(cartBytes, cartStart);
	payload.set(layoutBytes, layoutStart);
	payload.set(manifest, manifestStart);
	payload.set(toc, tocStart);
	const header = new DataView(payload.buffer);
	header.setUint32(4, CART_ROM_HEADER_SIZE, true);
	header.setUint32(8, manifestStart, true);
	header.setUint32(12, manifest.byteLength, true);
	header.setUint32(16, tocStart, true);
	header.setUint32(20, toc.byteLength, true);
	header.setUint32(24, CART_ROM_HEADER_SIZE, true);
	header.setUint32(28, cartBytes.byteLength + layoutBytes.byteLength, true);
	header.setUint32(72, CART_VDP_CLASS_PSX, true);
	const index = await parseCartridgeIndex(payload);
	const source = new RomSourceStack([{ id: 'cart', index, payload }]);
	const registry = buildLuaSources(source, source, index, ['cart']);
	const entryRecord = registry.module2lua.cart;
	const modules = registry.records
		.filter(record => record !== entryRecord)
		.map(record => ({
			path: record.module_path,
			chunk: parseLuaChunk(record.src, record.source_path),
			source: record.src,
		}));
	const compiled = compileLuaChunkToProgram(
		parseLuaChunk(entryRecord.src, entryRecord.source_path),
		modules,
		{
			entrySource: entryRecord.src,
			optLevel: 3,
		},
	);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: payload });
	const cpu = new CPU(memory, new IrqController(memory));
	cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata, 0, 0, 0);
	cpu.start(compiled.entryProtoIndex);

	assert.equal(registry.module2lua[GX_TEXTURE_LAYOUT_MODULE_PATH].src, layoutSource);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [64 | (256 << 16)]);
});

test('ROM TOC decode gives Lua assets an explicit zero update timestamp', () => {
	const toc = encodeRomToc({
			entries: [
				{ resid: 'main', type: 'lua', source_path: 'cart.lua' },
				{ resid: PROGRAM_IMAGE_ID, type: 'code' },
			],
		projectRootPath: 'carts/test',
	});
	const decoded = decodeRomToc(toc);

	assert.equal(decoded.entries[0].update_timestamp, 0);
	assert.equal(decoded.entries[1].update_timestamp, undefined);
});

test('toLuaModulePath normalizes source paths through the loader contract', () => {
	assert.equal(toLuaModulePath('cart.lua'), 'cart');
	assert.equal(toLuaModulePath('system/font.lua'), 'system/font');
	assert.equal(SYSTEM_BOOT_ENTRY_PATH, 'bios/bootrom.lua');
	assert.equal(toLuaModulePath(SYSTEM_BOOT_ENTRY_PATH), 'bios/bootrom');
	assert.equal(toLuaModulePath('carts/pietious/cart.lua'), 'cart');
	assert.equal(toLuaModulePath('carts/pietious/room/index.lua'), 'room/index');
	assert.equal(toLuaModulePath('carts\\pietious\\room\\index.lua'), 'room/index');
	assert.equal(toLuaModulePath('machine/firmware/res/_ignore/ide/source_text.lua'), '_ignore/ide/source_text');
	assert.equal(toLuaModulePath('res/_ignore/ide/source_text.lua'), '_ignore/ide/source_text');
});
