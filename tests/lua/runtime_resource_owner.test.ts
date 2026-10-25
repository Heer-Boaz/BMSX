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
	rebuildRuntimeSourceResources,
	registerRuntimeLuaResource,
	registerWorkspaceTextSources,
	resolveRuntimeResource,
	resolveRuntimeResourceForContext,
} from '../../ide/runtime/sources';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { RawRomSource } from '../../toolchain/ts/rompack/source';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { ResourceFilesModel } from '../../ide/workbench/contrib/resources/panel/files_model';
import { buildResourceQuickPickItems } from '../../ide/workbench/contrib/resources/quick_access';
import {
	createLuaCodeTabContext,
	retainEntryTabContext,
} from '../../ide/workbench/ui/code_tab/contexts';
import { codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { editorTextModelService } from '../../ide/editor/model/model_service';

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

function romSource(entries: RomAsset[]): RawRomSource {
	return {
		getEntry(id) {
			return entries.find(entry => entry.resid === id) || null;
		},
		getEntryByPath(path) {
			return entries.find(entry => entry.source_path === path) || null;
		},
		getBytes() {
			return new Uint8Array();
		},
		getBytesView() {
			return new Uint8Array();
		},
		list(type) {
			return type ? entries.filter(entry => entry.type === type) : entries;
		},
	};
}

function dataResources(sources: ReturnType<typeof createTestRuntimeSourceState>): RuntimeResource[] {
	const resources: RuntimeResource[] = [];
	for (let index = 0; index < sources.resources.length; index += 1) {
		const resource = sources.resources[index];
		if (resource.source.type === 'data' || resource.source.type === 'aem') {
			resources.push(resource);
		}
	}
	return resources;
}

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
	const identity = { domain: 0 as const, path: 'src/main.lua' };
	const retained = resolveRuntimeResource(sources, identity);
	assert.ok(retained);
	assert.strictEqual(
		sources.luaResources.find(resource => resourceIdentityKey(resource) === resourceIdentityKey(identity)),
		retained,
	);

	const replacement = luaSource('src/main.lua', 'cart-main', 'return 3');
	registerLuaSourceRecord(cartridgeRegistry, replacement);
	const registered = registerRuntimeLuaResource(sources, 0, replacement);

	assert.strictEqual(registered, retained);
	assert.strictEqual(retained.source, replacement);
	assert.equal(sources.luaResources.filter(resource => resource === retained).length, 1);
	assert.strictEqual(resolveRuntimeResourceForContext(sources, 0, 'system/main.lua')?.source, systemRegistry.records[0]);
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
	const resource = (domain: -1 | 0, path: string) => resolveRuntimeResource(sources, { domain, path })!;
	const systemShared = resource(-1, sharedPath), cartShared = resource(0, sharedPath);
	assert.deepEqual(cartShared.location, { kind: 'workspace', path: sharedPath });
	assert.deepEqual(systemShared.location, cartShared.location);
	assert.ok(systemShared !== cartShared, 'canonical shared source still has a resource in each execution context');
	assert.deepEqual(resource(0, local.source_path).location,
		{ kind: 'project', projectRootPath: 'carts/test', path: local.source_path });
	assert.deepEqual(resource(0, testlib.source_path).location, { kind: 'workspace', path: testlib.normalized_source_path });
	assert.deepEqual(resource(0, generated.source_path).location, { kind: 'generated', path: generated.source_path });
	assert.deepEqual(resource(0, neighbour.source_path).location, { kind: 'workspace', path: neighbour.normalized_source_path });
	assert.equal(local.sourceKind, 'library'); assert.equal(testlib.sourceKind, 'source-only');
	assert.equal(shared.program_module, true); assert.equal(testlib.program_module, false);
	const systemModel = createLuaCodeTabContext(sources, systemShared).model;
	const cartModel = createLuaCodeTabContext(sources, cartShared).model;
	assert.ok(systemModel !== cartModel, 'provenance does not merge independently authored execution-context working copies');
	assert.ok(systemModel.resource === systemShared); assert.ok(cartModel.resource === cartShared);
	const location = cartShared.location, revision = sources.resourceCatalogRevision;
	rebuildRuntimeSourceResources(sources);
	assert.ok(resource(0, sharedPath) === cartShared); assert.ok(resource(-1, sharedPath) === systemShared);
	assert.ok(cartShared.location === location, 'unchanged provenance retains its catalog-owned value');
	assert.ok(sources.resourceCatalogRevision > revision);
	registerWorkspaceTextSources(sources, 0, [{ type: 'data', resid: 'settings', source_path: 'res/settings.yaml' }]);
	assert.deepEqual(resource(0, 'res/settings.yaml').location,
		{ kind: 'project', projectRootPath: 'carts/test', path: 'res/settings.yaml' });
});

test('same runtime resource publishes changed provenance while retaining its canonical working copy', t => {
	t.after(() => editorTextModelService.clear());
	const source = luaSource('cartlib/world.lua', 'shared-world', 'return 42');
	const registry = sourceRegistry('carts/test', [source]);
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', []), [registry, null], 0);
	const resource = resolveRuntimeResource(sources, { domain: 0, path: source.source_path })!;
	const model = createLuaCodeTabContext(sources, resource).model;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	const bytes = model.buffer.getText(), revision = sources.resourceCatalogRevision;
	const replacement = { ...source, normalized_source_path: `carts/test/${source.source_path}` };
	registerLuaSourceRecord(registry, replacement);
	assert.ok(registerRuntimeLuaResource(sources, 0, replacement) === resource);
	assert.deepEqual(resource.location, { kind: 'project', projectRootPath: 'carts/test', path: source.source_path });
	assert.ok(sources.resourceCatalogRevision > revision, 'provenance is a catalog publication even when runtime identity and role are unchanged');
	assert.ok(createLuaCodeTabContext(sources, resource).model === model);
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
	const retained = resolveRuntimeResource(sources, { domain: 0, path: 'src/main.lua' })!;

	const files = new ResourceFilesModel();
	assert.equal(files.sync(sources, 'all'), true);
	assert.equal(files.reveal(retained), true);
	const panelNode = files.selectedNode!;
	assert.ok(panelNode.element.kind === 'file');
	assert.strictEqual(panelNode.element.resource, retained);

	const searchEntry = buildResourceQuickPickItems(sources.resources)
		.find(entry => entry.resource.path === retained.path && entry.resource.domain === retained.domain)!;
	assert.strictEqual(searchEntry.resource, retained);

	const context = createLuaCodeTabContext(sources, retained);
	assert.strictEqual(context.model.resource, retained);

	const replacement = luaSource(retained.path, 'cart-main', 'return 3');
	registerLuaSourceRecord(cartridgeRegistry, replacement);
	registerRuntimeLuaResource(sources, 0, replacement);
	files.sync(sources, 'all');
	assert.strictEqual(files.selectedNode, panelNode);
	assert.strictEqual(panelNode.element.resource, retained);
	assert.strictEqual(panelNode.element.resource.source, replacement);
	assert.strictEqual(context.model.resource.source, replacement);
});

test('workspace entry tab opens the development cartridge instead of the booting BIOS', (t) => {
	codeEditorInputManager.clear();
	editorTextModelService.clear();
	t.after(() => {
		codeEditorInputManager.clear();
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

	const context = retainEntryTabContext(sources);
	assert.equal(context.model.resource.domain, 0);
	assert.equal(context.model.resource.path, 'cart.lua');
	context.view.cursorRow = 7;
	assert.strictEqual(retainEntryTabContext(sources), context);
	assert.equal(retainEntryTabContext(sources).view.cursorRow, 7);
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
	);
	sources.systemRomSource = romSource([
		{ resid: 'system-scene', type: 'aem', source_path: 'system/scene.aem' },
		{ resid: 'system-config', type: 'data', source_path: 'system/config.json' },
		{ resid: 'compiled-image', type: 'code', source_path: 'compiled.image' },
		{ resid: 'source-less', type: 'data' },
	]);
	sources.cartridgeSlots[0]!.romSource = romSource([
		{ resid: 'cart-scene', type: 'aem', source_path: 'scenes/cart.aem' },
		{ resid: 'enemy-guard', type: 'data', source_path: 'res/data/enemy_guard.yaml' },
	]);
	sources.cartridgeSlots[1]!.romSource = romSource([
		{ resid: 'other-guard', type: 'data', source_path: 'res/data/enemy_guard.yaml' },
	]);
	rebuildRuntimeSourceResources(sources);

	const systemAem = resolveRuntimeResource(sources, {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: 'system/scene.aem',
	});
	const cartridgeAem = resolveRuntimeResource(sources, {
		domain: 0,
		path: 'scenes/cart.aem',
	});
	const systemData = resolveRuntimeResource(sources, {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: 'system/config.json',
	});
	const cartridgeData = resolveRuntimeResource(sources, {
		domain: 0,
		path: 'res/data/enemy_guard.yaml',
	});
	assert.ok(systemAem);
	assert.ok(cartridgeAem);
	assert.ok(systemData);
	assert.ok(cartridgeData);
	assert.equal(cartridgeData.source.type, 'data');
	assert.equal(resolveRuntimeResource(sources, {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: 'compiled.image',
	}), undefined);
	const otherData = resolveRuntimeResource(sources, { domain: 1, path: cartridgeData.path })!;
	assert.notEqual(otherData, cartridgeData);
	const catalog = [cartridgeData, otherData, cartridgeAem, systemData, systemAem];
	assert.deepEqual(dataResources(sources), catalog);
	const files = new ResourceFilesModel();
	files.sync(sources, 'all');
	const fileResources = buildResourceQuickPickItems(sources.resources).map(item => item.resource);
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
		resolveRuntimeResource(sources, { domain: SYSTEM_RESOURCE_DOMAIN, path: 'system/scene.aem' }),
		systemAem,
	);
	assert.deepEqual(dataResources(sources), catalog);
});
