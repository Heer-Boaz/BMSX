import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { LuaInterpreter } from '../../ide/language/lua/interpreter/interpreter';
import { buildLuaSourceAssetChanges } from '../../ide/runtime/source_media';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { layoutBlua32PublicAssets } from '../../toolchain/ts/rompack/blua32_tail';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import type { RomSourceLayer } from '../../toolchain/ts/rompack/source';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';

const interpreter = new LuaInterpreter({
	convertFromLua() { throw new Error('Source compilation must not execute Lua.'); },
	toLua() { throw new Error('Source compilation must not execute Lua.'); },
});
const encoder = new TextEncoder();
const originalSource = 'module<entry>\nreturn 1';
const changedSource = 'module<entry>\nreturn 2';
const textureBytes = Uint8Array.of(0x12, 0x34, 0x56, 0x78);

function sourceRegistry(): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'entry.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'entry', type: 'lua', source_path: 'entry.lua', normalized_source_path: 'entry.lua',
		module_path: 'entry', src: changedSource, base_src: originalSource,
		update_timestamp: 1, base_update_timestamp: 0, generated: false, program_module: true,
	});
	return registry;
}

function sourceLayer(includeLua: boolean): RomSourceLayer<'cart'> {
	const assets: RomAsset[] = [{ resid: 'entry', type: 'texture', buffer: textureBytes }];
	if (includeLua) {
		assets.push({
			resid: 'entry', type: 'lua', source_path: 'entry.lua',
			buffer: encoder.encode(originalSource),
			compiled_buffer: encodeLuaChunk(interpreter.compileChunk(originalSource, 'entry')),
		});
	}
	const layout = layoutRomAssetPayloads(assets, true);
	const bytes = new Uint8Array(layout.nextOffset + 16);
	writeCartRomHeader(bytes, {
		...parseCartHeader(createTestRuntimeRomPayload()),
		blua32ImageOffset: layout.nextOffset, blua32ImageByteCount: 16,
	});
	for (const range of layout.ranges) bytes.set(range.buffer, range.start);
	return { id: 'cart', bytes, index: { entries: layout.entries, projectRootPath: '', cart_manifest: null } };
}

for (const includeLua of [true, false]) {
	test(`${includeLua ? 'editing' : 'adding'} Lua preserves a texture with the same asset name`, () => {
		const layer = sourceLayer(includeLua);
		const changes = buildLuaSourceAssetChanges(
			layer, sourceRegistry(), new Map(includeLua ? [['entry', originalSource]] : []), interpreter, undefined,
		);
		const layout = layoutBlua32PublicAssets(layer, 16, changes);
		assert.deepEqual(layout.entries.map(entry => [entry.type, entry.resid]), [
			['texture', 'entry'], ['lua', 'entry'],
		]);
		assert.equal(changes.assetAdditions!.length, includeLua ? 0 : 1);
		const bytes = new Uint8Array(Math.max(layer.bytes.length, layout.nextOffset));
		bytes.set(layer.bytes);
		for (const range of layout.ranges) bytes.set(range.buffer, range.start);
		const [texture, lua] = layout.entries;
		assert.deepEqual(texture, layer.index.entries[0]);
		assert.deepEqual(bytes.subarray(texture.start!, texture.end!), textureBytes);
		assert.equal(new TextDecoder().decode(bytes.subarray(lua.start!, lua.end!)), changedSource);
		assert.deepEqual(bytes.subarray(lua.compiled_start!, lua.compiled_end!),
			encodeLuaChunk(interpreter.compileChunk(changedSource, 'entry')));
	});
}
