import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_DISPLAY_PRESET_SOURCE_PATH,
	GX_REGISTER_MODULE_PATH,
	GX_REGISTER_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	ROM_ASSET_SYMBOL_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
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

for (const generated of [
	{
		path: GX_DISPLAY_PRESET_MODULE_PATH,
		sourcePath: GX_DISPLAY_PRESET_SOURCE_PATH,
		source: GX_DISPLAY_PRESET_MODULE_SOURCE,
	},
	{
		path: GX_REGISTER_MODULE_PATH,
		sourcePath: GX_REGISTER_SOURCE_PATH,
		source: GX_REGISTER_MODULE_SOURCE,
	},
] as const) {
	test(`BLua32 image rejects a cart Lua module that collides with generated ${generated.path}`, () => {
		const entrySource = 'module<entry>\nreturn true';
		const cartGeneratedSource = 'module<const>\nreturn { conflicting_word = 0 }';
		const assets: RomAsset[] = [
			{
				resid: 'cart',
				type: 'lua',
				buffer: Buffer.from(entrySource),
				compiled_buffer: compileLuaChunkBuffer(entrySource, 'cart'),
				source_path: 'cart.lua',
			},
			{
				resid: 'cart_generated_gx_contract',
				type: 'lua',
				buffer: Buffer.from(cartGeneratedSource),
				compiled_buffer: compileLuaChunkBuffer(cartGeneratedSource, generated.path),
				source_path: generated.sourcePath,
			},
		];
		assert.throws(
			() => buildRomBlua32Tail(assets, {
				generatedLuaModules: [{ path: generated.path, source: generated.source }],
				includeSymbols: true,
				optLevel: 3,
				systemAssetEndOffset: SYSTEM_ROM_ASSET_OFFSET,
				domain: 'system',
				ramByteCount: 0x00400000,
				biosExports: [],
			}),
			new RegExp(`Generated Lua module '${generated.path}' conflicts with a ROM Lua asset`),
		);
	});
}
