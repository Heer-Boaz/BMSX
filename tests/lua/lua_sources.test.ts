import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { RomSourceStack, type RawRomSource } from '../../toolchain/ts/rompack/source';
import {
	CART_ROM_HEADER_MAGIC_OFFSET,
	CART_ROM_HEADER_SIZE,
	CART_ROM_MAGIC,
} from '../../machine/ts/spec/bmsx/rom_package';
import {
	GX_VRAM_LAYOUT_MODULE_PATH,
	GX_VRAM_LAYOUT_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import type {
	CartridgeIndex,
	RomAsset,
} from '../../toolchain/ts/rompack/assets';
import type { RomImageDomain } from '../../machine/ts/rompack/image';
import { buildLuaSources } from '../../ide/runtime/source_registry';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import {
	ROM_TOC_HEADER_SIZE,
	ROM_TOC_INVALID_U32,
} from '../../machine/ts/spec/bmsx/rom_toc';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { buildGxVramLayoutModuleSource, type GxVramLayout } from '../../scripts/rompacker/gx_vram_layout';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

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

	public getCompiledBytesView(entry: RomAsset): Uint8Array {
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
		payload_id: payloadId,
		update_timestamp: updateTimestamp,
	};
}

test('buildLuaSources registers real Lua assets in one pass', () => {
	const cartEntry = luaEntry('main', 'cart.lua', 'cart', 11);
	const activeEntry = luaEntry('main', 'cart.lua', 'cart', 22);
	const generatedEntry = luaEntry(GX_VRAM_LAYOUT_MODULE_PATH, GX_VRAM_LAYOUT_SOURCE_PATH, 'cart', 0);
	const systemEntry = luaEntry('sys', 'kernel/interrupts.lua', 'system', 0);
	const cartSource = new TestRomSource([cartEntry, generatedEntry], {
		main: 'module<entry>\nreturn 1',
		[GX_VRAM_LAYOUT_MODULE_PATH]: 'return { source_addr = 1 }',
	});
	const activeSource = new TestRomSource([activeEntry, generatedEntry, systemEntry], {
		main: 'module<entry>\nreturn 2',
		[GX_VRAM_LAYOUT_MODULE_PATH]: 'return { source_addr = 1 }',
		sys: 'return 3',
	});

	const registry = buildLuaSources(cartSource, activeSource, makeIndex([cartEntry]), 'cart');
	const record = registry.path2lua['cart.lua'];

	assert.equal(registry.can_boot_from_source, true);
	assert.equal(record.src, 'module<entry>\nreturn 2');
	assert.equal(record.base_src, 'module<entry>\nreturn 1');
	assert.equal(record.module_path, 'cart');
	assert.equal(record.update_timestamp, 22);
	assert.equal(record.generated, false);
	assert.equal(registry.module2lua[GX_VRAM_LAYOUT_MODULE_PATH].generated, true);
	assert.equal(registry.module2lua[ROM_ASSET_SYMBOL_MODULE_PATH].generated, true);
	assert.equal(registry.module2lua.cart, record);
	assert.equal(registry.path2lua['kernel/interrupts.lua'], undefined);
});

test('release BLua32 images do not synthesize editable Lua source records', () => {
	const imageEntry: RomAsset = { resid: BLUA32_IMAGE_ID, type: 'code', payload_id: 'system' };
	const source = new TestRomSource([imageEntry], {});
	const registry = buildLuaSources(source, source, makeIndex([imageEntry]), 'system');

	assert.equal(registry.can_boot_from_source, false);
	assert.deepEqual(registry.records, []);
	assert.equal(registry.path2lua['boot/bootrom.lua'], undefined);
});

test('debug package source boot resolves the persisted GX VRAM layout module', async () => {
	const layout: GxVramLayout = {
		framebuffers: [],
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
		'module<entry>',
		`local vram_layout<const> = require('${GX_VRAM_LAYOUT_MODULE_PATH}')`,
		'return vram_layout.scene_texture',
	].join('\n');
	const layoutSource = buildGxVramLayoutModuleSource(layout);
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
		...luaEntry(GX_VRAM_LAYOUT_MODULE_PATH, GX_VRAM_LAYOUT_SOURCE_PATH, 'cart', 0),
		start: layoutStart,
		end: layoutStart + layoutBytes.byteLength,
	};
	const manifest = encodeBinary({ title: 'Source Boot Test' });
	const manifestStart = layoutStart + layoutBytes.byteLength;
	const toc = encodeRomToc({ entries: [cartEntry, layoutEntry], projectRootPath: 'carts/source_boot_test' });
	const tocStart = manifestStart + manifest.byteLength;
	const payload = new Uint8Array(tocStart + toc.byteLength);
	payload.set(cartBytes, cartStart);
	payload.set(layoutBytes, layoutStart);
	payload.set(manifest, manifestStart);
	payload.set(toc, tocStart);
	const header = new DataView(payload.buffer);
	header.setUint32(CART_ROM_HEADER_MAGIC_OFFSET, CART_ROM_MAGIC, true);
	header.setUint32(4, CART_ROM_HEADER_SIZE, true);
	header.setUint32(8, manifestStart, true);
	header.setUint32(12, manifest.byteLength, true);
	header.setUint32(16, tocStart, true);
	header.setUint32(20, toc.byteLength, true);
	header.setUint32(24, CART_ROM_HEADER_SIZE, true);
	header.setUint32(28, cartBytes.byteLength + layoutBytes.byteLength, true);
	const index = await parseCartridgeIndex(payload);
	const source = new RomSourceStack([{ id: 'cart', index, bytes: payload }]);
	const registry = buildLuaSources(source, source, index, 'cart');
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
				programDomain: 'system',
			},
	);
	const image = linkTestSystemBlua32(compiled);
	const memory = new Memory({ systemRom: image.romBytes, cartridgeSlots: cartridgeSlots(payload) }, PSX_MACHINE_SPEC.ramBytes);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, new IrqController(memory), executionAddressSpace);
	cpu.reset();

	assert.equal(registry.module2lua[GX_VRAM_LAYOUT_MODULE_PATH].src, layoutSource);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [64 | (256 << 16)]);
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
