import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { buildLuaSourceAssetChanges } from '../../ide/runtime/source_media';
import { collectProgramSources, collectInstalledProgramSources } from '../../ide/runtime/program_sources';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { layoutBlua32PublicAssets } from '../../toolchain/ts/rompack/blua32_tail';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import type { RomSourceLayer } from '../../toolchain/ts/rompack/source';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';

const encoder = new TextEncoder();
const originalSource = 'module<entry>\nreturn 1';
const changedSource = 'module<entry>\nreturn 2';
const textureBytes = Uint8Array.of(0x12, 0x34, 0x56, 0x78);

test('new imports admit source-only library dependencies without parsing unrelated sources', () => {
	const registry = sourceRegistry();
	registry.records[0].src = "module<entry>\nreturn require('cartlib/world/world')";
	for (const [path, source, installed, sourceKind] of [
		['cartlib/world/world', "return require('cartlib/registry')", true, 'library'],
		['cartlib/registry', 'return 42', false, 'library'],
		['cartlib/unused', 'return (', false, 'library'],
		['example_assert', 'return (', false, 'source-only'],
	] as const) registerLuaSourceRecord(registry, {
		...registry.records[0], resid: path, source_path: `${path}.lua`, normalized_source_path: `${path}.lua`,
		module_path: path, src: source, base_src: source, program_module: installed, sourceKind,
	});
	const selected = collectProgramSources(registry, registry.entrySourcePath, []);
	assert.deepEqual(selected.modules.map(module => module.path), ['cartlib/world/world', 'cartlib/registry']);
	assert.equal(selected.parsed.has('cartlib/unused'), false);
	assert.equal(selected.parsed.has('example_assert'), false);
	const changes = buildLuaSourceAssetChanges(sourceLayer(true), registry, new Map([['entry', originalSource]]), selected.parsed, undefined);
	assert.equal(changes.assetAdditions!.find(asset => asset.resid === 'cartlib/registry')!.program_module, true);
	assert.equal(changes.assetAdditions!.some(asset => asset.resid === 'cartlib/unused'), false);
	const installed = collectInstalledProgramSources(new Map([['entry', { displayPath: 'entry.lua',
		content: { kind: 'text', text: originalSource } }]]), ['entry']);
	assert.deepEqual(installed.modules, [], 'an installed-only rebuild must not adopt newly imported workspace modules');
});

function sourceRegistry(): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'entry.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'entry', type: 'lua', source_path: 'entry.lua', normalized_source_path: 'entry.lua',
		module_path: 'entry', src: changedSource, base_src: originalSource,
		update_timestamp: 1, base_update_timestamp: 0, generated: false, program_module: true, sourceKind: 'project',
	});
	return registry;
}

function sourceLayer(includeLua: boolean, additionalAssets: RomAsset[] = []): RomSourceLayer<'cart'> {
	const assets: RomAsset[] = [{ resid: 'entry', type: 'texture', buffer: textureBytes }, ...additionalAssets];
	if (includeLua) {
		assets.push({
			resid: 'entry', type: 'lua', source_path: 'entry.lua',
			buffer: encoder.encode(originalSource),
			program_module: true,
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

for (const included of [false, true]) {
	test(`${included ? 'importing' : 'removing'} a library publishes membership even when its text is unchanged`, () => {
		const registry = sourceRegistry();
		const path = 'cartlib/registry';
		const source = 'return 42';
		registerLuaSourceRecord(registry, {
			...registry.records[0], resid: path, source_path: `${path}.lua`, normalized_source_path: `${path}.lua`,
			module_path: path, sourceKind: 'library', src: source, base_src: source, program_module: !included,
		});
		if (included) registry.records[0].src = `module<entry>\nreturn require('${path}')`;
		const layer = sourceLayer(true, [{ resid: path, type: 'lua', source_path: `${path}.lua`,
			buffer: encoder.encode(source), program_module: !included }]);
		const installed = new Map([['entry', originalSource]]);
		if (!included) installed.set(path, source);
		const selected = collectProgramSources(registry, registry.entrySourcePath, []);
		const changes = buildLuaSourceAssetChanges(layer, registry, installed, selected.parsed, undefined);
		const published = changes.assetReplacements!.get('lua')!.get(path)!;
		assert.equal(published.program_module, included);
		assert.equal(new TextDecoder().decode(published.buffer), source);
		assert.equal(registry.module2lua[path].program_module, !included, 'compilation does not rewrite packed provenance');
	});
}

for (const includeLua of [true, false]) {
	test(`${includeLua ? 'editing' : 'adding'} Lua preserves a texture with the same asset name`, () => {
		const layer = sourceLayer(includeLua);
		const registry = sourceRegistry();
		const selected = collectProgramSources(registry, registry.entrySourcePath, []);
		const changes = buildLuaSourceAssetChanges(
			layer, registry, new Map(includeLua ? [['entry', originalSource]] : []), selected.parsed, undefined,
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
		assert.equal(lua.program_module, true);
	});
}
