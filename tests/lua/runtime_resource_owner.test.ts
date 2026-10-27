import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityKey,
	type RuntimeResource,
} from '../../ide/common/resource';
import {
	enterCartridgeSources,
	enterSystemSources,
} from '../../ide/runtime/sources';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { createTestRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { ResourceFilesModel } from '../../ide/workbench/contrib/resources/panel/files_model';
import { buildResourceQuickPickItems } from '../../ide/workbench/contrib/resources/quick_access';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { workspaceCanonicalSourceCache } from '../../ide/workspace/cache';

function luaSource(path: string, resid: string, source: string): LuaSourceRecord {
	return {
		resid,
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: 0,
		source_path: path,
		normalized_source_path: path,
		module_path: path.slice(0, -4),
		update_timestamp: 0,
		generated: false,
		sourceKind: 'project', program_module: true,
	};
}

function sourceRegistry(projectRootPath: string, records: LuaSourceRecord[]): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: '',
		projectRootPath,
		can_boot_from_source: records.length > 0,
		revision: 0,
	};
	for (let index = 0; index < records.length; index += 1) {
		registerLuaSourceRecord(registry, records[index]);
	}
	return registry;
}


function dataResources(sources: ReturnType<typeof createTestRuntimeSourceState>): RuntimeResource[] {
	const resources: RuntimeResource[] = [];
	for (let index = 0; index < sources.catalog.resources.length; index += 1) {
		const resource = sources.catalog.resources[index];
		if (resource.source.type === 'data' || resource.source.type === 'aem') {
			resources.push(resource);
		}
	}
	return resources;
}

test('source admission publishes canonical file addresses for authored resources, not for generated Lua', () => {
	const local = { ...luaSource('src/main.lua', 'main', 'return 1'), normalized_source_path: 'carts/test/src/main.lua' };
	const shared = { ...luaSource('shared.lua', 'shared', 'return 2'), normalized_source_path: 'cartlib/shared.lua', sourceKind: 'library' as const };
	const generated = { ...luaSource('generated.lua', 'generated', 'return 3'), generated: true };
	const registry = sourceRegistry('carts/test', [local, shared, generated]);
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', []), [registry, null], 0, {
		system: [], cartridgeSlots: [[
			{ type: 'data', resid: 'stage', source_path: 'res/stage.yaml' },
			{ type: 'aem', resid: 'events', source_path: 'res/events.aem.yaml' },
		], []],
	});
	sources.catalog.rebuildResources();
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'src/main.lua' })!.sourceFilePath, local.normalized_source_path);
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'shared.lua' })!.sourceFilePath, shared.normalized_source_path);
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'generated.lua' })!.sourceFilePath, undefined);
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/stage.yaml' })!.sourceFilePath, 'carts/test/res/stage.yaml');
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/events.aem.yaml' })!.sourceFilePath, 'carts/test/res/events.aem.yaml');
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'new', source_path: 'res/new.yaml' }]);
	assert.equal(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/new.yaml' })!.sourceFilePath, 'carts/test/res/new.yaml');
});

test('retained source admission refreshes its file address and catalog publication when its source record changes in place', () => {
	const record = luaSource('shared.lua', 'shared', 'return 1');
	const registry = sourceRegistry('carts/test', [record]);
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', []), [registry, null], 0);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'shared.lua' })!;
	const revision = sources.catalog.revision;
	record.normalized_source_path = 'cartlib/relocated/shared.lua';
	assert.ok(sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], record) === resource);
	assert.equal(resource.sourceFilePath, record.normalized_source_path);
	assert.ok(sources.catalog.revision > revision);
	assert.equal(sources.catalog.resources.filter(candidate => candidate === resource).length, 1);
});

test('generated Lua has no canonical file baseline even when its virtual path matches a workspace record', t => {
	t.after(() => { editorTextModelService.clear(); workspaceCanonicalSourceCache.clear(); });
	const generated = { ...luaSource('generated.lua', 'generated', 'return 3'), generated: true };
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', []), [sourceRegistry('carts/test', [generated]), null], 0);
	workspaceCanonicalSourceCache.set(generated.normalized_source_path, { contents: 'return 99', updatedAt: 1 });
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: generated.source_path })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	assert.equal(model.buffer.getText(), generated.src);
	assert.equal(model.lastSavedSource, generated.base_src);
	assert.equal(model.persistedBaseline, null);
	assert.equal(model.dirty, false);
	assert.equal(model.readOnly, true);
});

test('runtime source owner retains Lua resource identity when its source record is replaced', () => {
	const systemRegistry = sourceRegistry('machine/ts', [
		luaSource('system/main.lua', 'system-main', 'return 1'),
	]);
	const cartridgeRegistry = sourceRegistry('carts/test', [
		luaSource('src/main.lua', 'cart-main', 'return 2'),
	]);
	const sources = createTestRuntimeSourceState(
		systemRegistry,
		[cartridgeRegistry, null],
		0,
	);
	const identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'src/main.lua' };
	const retained = sources.catalog.resolveResource(identity);
	assert.ok(retained);
	assert.strictEqual(
		sources.catalog.luaResources.find(resource => resourceIdentityKey(resource) === resourceIdentityKey(identity)),
		retained,
	);

	const replacement = luaSource('src/main.lua', 'cart-main', 'return 3');
	registerLuaSourceRecord(cartridgeRegistry, replacement);
	const registered = sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);

	assert.strictEqual(registered, retained);
	assert.strictEqual(retained.source, replacement);
	assert.equal(sources.catalog.luaResources.filter(resource => resource === retained).length, 1);
	assert.strictEqual(sources.catalog.resolveResource(sources.catalog.resolveModule(TEST_CARTRIDGE_CONTEXT_IDS[0], 'system/main')!)?.source, systemRegistry.records[0]);
});

test('catalog location follows canonical source provenance without changing execution identities or source roles', t => {
	t.after(() => editorTextModelService.clear());
	const sharedPath = 'cartlib/world.lua';
	const shared = { ...luaSource(sharedPath, 'shared-world', 'return 42'), sourceKind: 'library' as const };
	const local = { ...luaSource('cartlib/local.lua', 'local-world', 'return 1'),
		normalized_source_path: 'carts/test/cartlib/local.lua', sourceKind: 'library' as const };
	const testlib = { ...luaSource('testlib/assert.lua', 'test-assert', 'return true'),
		sourceKind: 'source-only' as const, program_module: false };
	const generated = { ...luaSource('bmsx/gpu.lua', 'generated-gpu', 'return {}'),
		normalized_source_path: 'carts/test/bmsx/gpu.lua', generated: true };
	const neighbour = { ...luaSource('neighbour.lua', 'neighbour', 'return 7'),
		normalized_source_path: 'carts/test-other/neighbour.lua' };
	const system = sourceRegistry('machine/bios', [{ ...shared }]);
	const cart = sourceRegistry('carts/test', [shared, local, testlib, generated, neighbour]);
	const sources = createTestRuntimeSourceState(system, [cart, null], 0);
	const resource = (contextId: string, path: string) => sources.catalog.resolveResource({ contextId, path })!;
	const systemShared = resource(TEST_SYSTEM_CONTEXT_ID, sharedPath), cartShared = resource(TEST_CARTRIDGE_CONTEXT_IDS[0], sharedPath);
	assert.deepEqual(cartShared.location, { kind: 'workspace', path: sharedPath });
	assert.deepEqual(systemShared.location, cartShared.location);
	assert.ok(systemShared !== cartShared, 'canonical shared source still has a resource in each execution context');
	assert.deepEqual(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], local.source_path).location,
		{ kind: 'project', projectRootPath: 'carts/test', path: local.source_path });
	assert.deepEqual(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], testlib.source_path).location, { kind: 'workspace', path: testlib.normalized_source_path });
	assert.deepEqual(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], generated.source_path).location, { kind: 'generated', path: generated.source_path });
	assert.deepEqual(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], neighbour.source_path).location, { kind: 'workspace', path: neighbour.normalized_source_path });
	assert.equal(local.sourceKind, 'library'); assert.equal(testlib.sourceKind, 'source-only');
	assert.equal(shared.program_module, true); assert.equal(testlib.program_module, false);
	const systemModel = resolveLuaTextFileModel(editorTextModelService, sources.catalog, systemShared);
	const cartModel = resolveLuaTextFileModel(editorTextModelService, sources.catalog, cartShared);
	assert.ok(systemModel !== cartModel, 'provenance does not merge independently authored execution-context working copies');
	assert.ok(systemModel.resource === systemShared); assert.ok(cartModel.resource === cartShared);
	const location = cartShared.location, revision = sources.catalog.revision;
	sources.catalog.rebuildResources();
	assert.ok(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], sharedPath) === cartShared); assert.ok(resource(TEST_SYSTEM_CONTEXT_ID, sharedPath) === systemShared);
	assert.ok(cartShared.location === location, 'unchanged provenance retains its catalog-owned value');
	assert.ok(sources.catalog.revision > revision);
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: 'res/settings.yaml' }]);
	assert.deepEqual(resource(TEST_CARTRIDGE_CONTEXT_IDS[0], 'res/settings.yaml').location,
		{ kind: 'project', projectRootPath: 'carts/test', path: 'res/settings.yaml' });
});

test('same runtime resource publishes changed provenance while retaining its canonical working copy', t => {
	t.after(() => editorTextModelService.clear());
	const source = luaSource('cartlib/world.lua', 'shared-world', 'return 42');
	const registry = sourceRegistry('carts/test', [source]);
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', []), [registry, null], 0);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: source.source_path })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	const bytes = model.buffer.getText(), revision = sources.catalog.revision;
	const replacement = { ...source, normalized_source_path: `carts/test/${source.source_path}` };
	registerLuaSourceRecord(registry, replacement);
	assert.ok(sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement) === resource);
	assert.deepEqual(resource.location, { kind: 'project', projectRootPath: 'carts/test', path: source.source_path });
	assert.ok(sources.catalog.revision > revision, 'provenance is a catalog publication even when runtime identity and role are unchanged');
	assert.ok(resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource) === model);
	assert.equal(model.buffer.getText(), bytes); assert.equal(model.dirty, true);
	model.undo(); assert.equal(model.buffer.getText(), source.src); assert.equal(model.dirty, false);
});

test('resource panel, search, and code tabs consume the retained owner resource', (t) => {
	t.after(() => editorTextModelService.clear());
	const systemRegistry = sourceRegistry('machine/ts', [
		luaSource('system/main.lua', 'system-main', 'return 1'),
	]);
	const cartridgeRegistry = sourceRegistry('carts/test', [
		luaSource('src/main.lua', 'cart-main', 'return 2'),
	]);
	cartridgeRegistry.entrySourcePath = 'src/main.lua';
	const sources = createTestRuntimeSourceState(
		systemRegistry,
		[cartridgeRegistry, null],
		0,
	);
	const retained = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'src/main.lua' })!;

	const files = new ResourceFilesModel();
	assert.equal(files.sync(sources.catalog, 'all'), true);
	assert.equal(files.reveal(retained), true);
	const panelNode = files.selectedNode!;
	assert.ok(panelNode.element.kind === 'file');
	assert.strictEqual(panelNode.element.resource, retained);

	const searchEntry = buildResourceQuickPickItems(sources.catalog.resources)
		.find(entry => entry.resource.path === retained.path && entry.resource.contextId === retained.contextId)!;
	assert.strictEqual(searchEntry.resource, retained);

	const input = resolveLuaCodeEditorInput(sources.catalog, retained);
	t.after(() => input.dispose());
	const model = input.workingCopy;
	assert.strictEqual(model.resource, retained);

	const replacement = luaSource(retained.path, 'cart-main', 'return 3');
	registerLuaSourceRecord(cartridgeRegistry, replacement);
	sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);
	files.sync(sources.catalog, 'all');
	assert.strictEqual(files.selectedNode, panelNode);
	assert.strictEqual(panelNode.element.resource, retained);
	assert.strictEqual(panelNode.element.resource.source, replacement);
	assert.strictEqual(model.resource.source, replacement);
});

test('fresh Source candidates keep their explicit authoring resource while the BIOS executes', (t) => {
	editorTextModelService.clear();
	t.after(() => {
		editorTextModelService.clear();
	});
	const systemRegistry = sourceRegistry('machine/bios', [
		luaSource('system/main.lua', 'system-main', 'return 1'),
	]);
	systemRegistry.entrySourcePath = 'system/main.lua';
	const cartridgeRegistry = sourceRegistry('carts/test', [
		luaSource('cart.lua', 'cart-main', 'return 2'),
	]);
	cartridgeRegistry.entrySourcePath = 'cart.lua';
	const sources = createTestRuntimeSourceState(
		systemRegistry,
		[cartridgeRegistry, null],
		SYSTEM_RESOURCE_DOMAIN,
	);
	sources.cartridgeSlots[0]!.rom.header.blua32ImageOffset = 64;

	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'cart.lua' })!;
	const first = resolveLuaCodeEditorInput(sources.catalog, resource), second = resolveLuaCodeEditorInput(sources.catalog, resource);
	t.after(() => { first.dispose(); second.dispose(); });
	assert.equal(first.workingCopy.resource.contextId, TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.equal(first.workingCopy.resource.path, 'cart.lua');
	first.context.view.cursorColumn = 7;
	assert.notEqual(first, second); assert.notEqual(first.context.view, second.context.view);
	assert.equal(first.workingCopy, second.workingCopy);
	assert.equal(second.context.view.cursorColumn, 0);
});

test('authoring catalog keeps loaded data accessible while the BIOS or either cartridge executes', () => {
	const systemRegistry = sourceRegistry('machine/ts', [
		luaSource('system/main.lua', 'system-main', 'return 1'),
	]);
	const cartridgeRegistry = sourceRegistry('carts/test', [
		luaSource('src/main.lua', 'cart-main', 'return 2'),
	]);
	const sources = createTestRuntimeSourceState(
		systemRegistry,
		[cartridgeRegistry, sourceRegistry('carts/second', [])],
		SYSTEM_RESOURCE_DOMAIN,
		{ system: [
			{ resid: 'system-scene', type: 'aem', source_path: 'system/scene.aem' },
			{ resid: 'system-config', type: 'data', source_path: 'system/config.json' },
			{ resid: 'compiled-image', type: 'code', source_path: 'compiled.image' },
			{ resid: 'source-less', type: 'data' },
		], cartridgeSlots: [[
			{ resid: 'cart-scene', type: 'aem', source_path: 'scenes/cart.aem' },
			{ resid: 'enemy-guard', type: 'data', source_path: 'res/data/enemy_guard.yaml' },
		], [{ resid: 'other-guard', type: 'data', source_path: 'res/data/enemy_guard.yaml' }]] },
	);

	sources.catalog.rebuildResources();

	const systemAem = sources.catalog.resolveResource({
		contextId: TEST_SYSTEM_CONTEXT_ID,
		path: 'system/scene.aem',
	});
	const cartridgeAem = sources.catalog.resolveResource({
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'scenes/cart.aem',
	});
	const systemData = sources.catalog.resolveResource({
		contextId: TEST_SYSTEM_CONTEXT_ID,
		path: 'system/config.json',
	});
	const cartridgeData = sources.catalog.resolveResource({
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'res/data/enemy_guard.yaml',
	});
	assert.ok(systemAem);
	assert.ok(cartridgeAem);
	assert.ok(systemData);
	assert.ok(cartridgeData);
	assert.equal(cartridgeData.source.type, 'data');
	assert.equal(sources.catalog.resolveResource({
		contextId: TEST_SYSTEM_CONTEXT_ID,
		path: 'compiled.image',
	}), undefined);
	const otherData = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: cartridgeData.path })!;
	assert.notEqual(otherData, cartridgeData);
	const catalog = [cartridgeData, otherData, cartridgeAem, systemData, systemAem];
	assert.deepEqual(dataResources(sources), catalog);
	const files = new ResourceFilesModel();
	files.sync(sources.catalog, 'all');
	const fileResources = buildResourceQuickPickItems(sources.catalog.resources).map(item => item.resource);
	for (const resource of catalog) {
		assert.equal(files.reveal(resource), true);
		const selected = files.selectedNode!;
		assert.ok(selected.element.kind === 'file');
		assert.strictEqual(selected.element.resource, resource);
		assert.ok(fileResources.includes(resource));
	}

	enterCartridgeSources(sources, 0);
	assert.deepEqual(dataResources(sources), catalog);
	enterCartridgeSources(sources, 1);
	assert.deepEqual(dataResources(sources), catalog);

	enterSystemSources(sources);
	assert.strictEqual(
		sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: 'system/scene.aem' }),
		systemAem,
	);
	assert.deepEqual(dataResources(sources), catalog);
});
