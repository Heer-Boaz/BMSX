import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RawRomSource } from '../../src/bmsx/rompack/source';
import type { CartridgeIndex, CartridgeLayerId, RomAsset } from '../../src/bmsx/rompack/format';
import { buildLuaSources } from '../../src/bmsx/machine/program/sources';
import { PROGRAM_IMAGE_ID, toLuaModulePath } from '../../src/bmsx/machine/program/loader';
import { SYSTEM_BOOT_ENTRY_PATH } from '../../src/bmsx/core/system';
import { decodeRomToc } from '../../src/bmsx/rompack/toc';
import { encodeRomToc } from '../../src/bmsx/rompack/tooling/toc_encode';

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
		projectRootPath: 'src/carts/test',
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
	const overlayEntry = luaEntry('main', 'cart.lua', 'overlay', 22);
	const systemEntry = luaEntry('sys', 'bios/system.lua', 'system', 0);
	const cartSource = new TestRomSource([cartEntry], { main: 'return 1' });
	const activeSource = new TestRomSource([overlayEntry, systemEntry], {
		main: 'return 2',
		sys: 'return 3',
	});

	const registry = buildLuaSources(cartSource, activeSource, makeIndex('cart.lua', [cartEntry]), ['overlay', 'cart']);
	const record = registry.path2lua['cart.lua'];

	assert.equal(registry.can_boot_from_source, true);
	assert.equal(record.src, 'return 2');
	assert.equal(record.base_src, 'return 1');
	assert.equal(record.module_path, 'cart');
	assert.equal(record.update_timestamp, 22);
	assert.equal(registry.module2lua.cart, record);
	assert.equal(registry.path2lua['bios/system.lua'], undefined);
});

test('ROM TOC decode gives Lua assets an explicit zero update timestamp', () => {
	const toc = encodeRomToc({
			entries: [
				{ resid: 'main', type: 'lua', source_path: 'cart.lua' },
				{ resid: PROGRAM_IMAGE_ID, type: 'code' },
			],
		projectRootPath: 'src/carts/test',
	});
	const decoded = decodeRomToc(toc);

	assert.equal(decoded.entries[0].update_timestamp, 0);
	assert.equal(decoded.entries[1].update_timestamp, undefined);
});

test('toLuaModulePath normalizes source paths through the loader contract', () => {
	assert.equal(toLuaModulePath('cart.lua'), 'cart');
	assert.equal(toLuaModulePath('bios/font.lua'), 'bios/font');
	assert.equal(SYSTEM_BOOT_ENTRY_PATH, 'bios/bootrom.lua');
	assert.equal(toLuaModulePath(SYSTEM_BOOT_ENTRY_PATH), 'bios/bootrom');
	assert.equal(toLuaModulePath('src/carts/pietious/cart.lua'), 'cart');
	assert.equal(toLuaModulePath('src/carts/pietious/room/index.lua'), 'room/index');
	assert.equal(toLuaModulePath('src\\carts\\pietious\\room\\index.lua'), 'room/index');
	assert.equal(toLuaModulePath('src/bmsx/res/_ignore/ide/source_text.lua'), '_ignore/ide/source_text');
	assert.equal(toLuaModulePath('res/_ignore/ide/source_text.lua'), '_ignore/ide/source_text');
});
