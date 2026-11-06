import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resourceIdentityKey } from '../../ide/common/resource';
import { createLuaSourceRegistry, registerLuaSourceRecord, type LuaSourceRecord } from '../../ide/runtime/source_registry';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { buildPossibleRomAssetAddressLinkExports, type RomAssetSymbol } from '../../toolchain/ts/rompack/asset_symbols';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

test('the asset producer classifies address relocations in either ROM domain, never payload lengths', () => {
	const symbol = (name: string, payloadId: 'system' | 'cart'): RomAssetSymbol => ({
		name, payloadId, assetId: name, assetType: 'data', address: 0, offset: 0, byteLength: 12,
	});
	assert.deepEqual([...buildPossibleRomAssetAddressLinkExports([
		symbol('data_image', 'cart'), symbol('data_firmware', 'system'),
	])], ['data_image_addr', 'data_firmware_addr']);
});

test('link-export metadata has immutable semantic snapshot generation ownership', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['entry.lua', 'asset.lua']));
	workspace.updateFile('entry.lua', "return require('asset').address");
	workspace.updateFile('asset.lua', 'module<const>\nreturn { address = 1 }');
	const before = workspace.getSnapshot();
	const linkExports = new Map([['asset.lua', new Set(['address'])]]);
	assert.equal(workspace.setLinkExports(linkExports), true);
	const after = workspace.getSnapshot();
	assert.notEqual(after, before);
	assert.equal(before.linkExports.has('asset.lua'), false);
	assert.equal(after.linkExports.get('asset.lua')!.has('address'), true);
	assert.equal(after.resolveModule('entry.lua', 'asset'), 'asset.lua');
	assert.equal(workspace.setLinkExports(linkExports), false);
	assert.equal(workspace.getSnapshot(), after);
	workspace.setLinkExports(new Map());
	assert.equal(workspace.getSnapshot().linkExports.has('asset.lua'), false);
	assert.equal(after.linkExports.get('asset.lua')!.has('address'), true);
});

test('editor snapshots replace generated export metadata on registry changes and source overlays', t => {
	const system = createLuaSourceRegistry('', '');
	const cart = createLuaSourceRegistry('', 'entry.lua');
	const record = (path: string, source: string, linkExports?: ReadonlySet<string>): LuaSourceRecord => ({
		resid: path, type: 'lua', src: source, base_src: source, base_update_timestamp: 0, source_path: path,
		normalized_source_path: path, module_path: path.slice(0, -4), update_timestamp: 0,
		generated: linkExports !== undefined, sourceKind: 'project', program_module: true, linkExports,
	});
	registerLuaSourceRecord(cart, record('entry.lua', "return require('asset').address"));
	const source = 'module<const>\nreturn { address = 1, length = 2 }';
	registerLuaSourceRecord(cart, record('asset.lua', source, new Set(['address'])));
	const catalog = createTestRuntimeSourceState(system, [cart, null], 0).catalog;
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(TEST_CARTRIDGE_CONTEXT_IDS[0], models);
	t.after(() => { project.dispose(); models.clear(); catalog.dispose(); });
	project.synchronizeSources(catalog);
	const identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'asset.lua' };
	const address = resourceIdentityKey(identity);
	const first = project.getSnapshot();
	assert.deepEqual([...first.linkExports.get(address)!], ['address']);
	const entry = resourceIdentityKey({ contextId: identity.contextId, path: 'entry.lua' });
	assert.equal(first.resolveModule(entry, 'asset'), address);
	registerLuaSourceRecord(cart, record('asset.lua', source, new Set(['length'])));
	const second = project.getSnapshot();
	assert.notEqual(second, first);
	assert.equal(first.getFileData(address), second.getFileData(address), 'metadata-only changes do not reparse source');
	assert.deepEqual([...first.linkExports.get(address)!], ['address']);
	assert.deepEqual([...second.linkExports.get(address)!], ['length']);
	project.updateDocument(identity, 'module<const>\nreturn { address = 3 }');
	assert.equal(project.getSnapshot().linkExports.has(address), false);
	assert.deepEqual([...second.linkExports.get(address)!], ['length']);
});
