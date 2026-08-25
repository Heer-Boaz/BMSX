import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ROM_ASSET_SYMBOL_MODULE_PATH,
	ROM_ASSET_SYMBOL_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import { buildRomBlua32Tail, compileLuaChunkBuffer } from '../../scripts/rompacker/rombuilder';

test('BLua32 image rejects a cart Lua module that collides with generated asset symbols', () => {
	const entrySource = 'module<entry>\nreturn true';
	const cartAssetSource = 'return { scene = 1 }';
	const generatedAssetSource = 'return { scene = 2 }';
	const assets: RomAsset[] = [
		{
			resid: 'cart',
			type: 'lua',
			buffer: Buffer.from(entrySource),
			compiled_buffer: compileLuaChunkBuffer(entrySource, 'cart'),
			source_path: 'cart.lua',
		},
		{
			resid: 'cart_assets',
			type: 'lua',
			buffer: Buffer.from(cartAssetSource),
			compiled_buffer: compileLuaChunkBuffer(cartAssetSource, ROM_ASSET_SYMBOL_MODULE_PATH),
			source_path: ROM_ASSET_SYMBOL_SOURCE_PATH,
		},
	];
	assert.throws(
		() => buildRomBlua32Tail(assets, {
			generatedLuaModules: [{
				path: ROM_ASSET_SYMBOL_MODULE_PATH,
				source: generatedAssetSource,
			}],
			includeSymbols: true,
			optLevel: 3,
			systemAssetEndOffset: SYSTEM_ROM_ASSET_OFFSET,
			domain: 'system',
			ramByteCount: 0x00400000,
			biosExports: [],
		}),
		/Generated Lua module 'bmsx\/assets' conflicts with a ROM Lua asset/,
	);
});
