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
import { buildResourcePanelItems } from '../../ide/workbench/contrib/resources/panel/items';
import { refreshResourceCatalog } from '../../ide/workbench/contrib/resources/search/catalog';
import { resourceSearchState } from '../../ide/workbench/contrib/resources/widget_state';
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
		program_module: true,
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
		getCompiledBytesView() {
			return new Uint8Array();
		},
		list(type) {
			return type ? entries.filter(entry => entry.type === type) : entries;
		},
	};
}

function activeDataResources(sources: ReturnType<typeof createTestRuntimeSourceState>): RuntimeResource[] {
	const resources: RuntimeResource[] = [];
	for (let index = 0; index < sources.activeResources.length; index += 1) {
		const resource = sources.activeResources[index];
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

	const panelItem = buildResourcePanelItems(sources, 'all')
		.find(item => item.resource?.path === retained.path && item.resource.domain === retained.domain)!;
	assert.strictEqual(panelItem.resource, retained);

	refreshResourceCatalog(sources);
	const searchEntry = resourceSearchState.catalog
		.find(entry => entry.resource.path === retained.path && entry.resource.domain === retained.domain)!;
	assert.strictEqual(searchEntry.resource, retained);

	const context = createLuaCodeTabContext(sources, retained);
	assert.strictEqual(context.model.resource, retained);
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

test('active resource catalog exposes source-backed data only from the active source domain', () => {
	const systemRegistry = sourceRegistry('machine/ts', [
		luaSource('system/main.lua', 'system-main', 'return 1'),
	]);
	const cartridgeRegistry = sourceRegistry('carts/test', [
		luaSource('src/main.lua', 'cart-main', 'return 2'),
	]);
	const sources = createTestRuntimeSourceState(
		systemRegistry,
		[cartridgeRegistry, null],
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
	assert.deepEqual(activeDataResources(sources), [systemData, systemAem]);

	enterCartridgeSources(sources, 0);
	assert.deepEqual(activeDataResources(sources), [cartridgeData, cartridgeAem]);

	enterSystemSources(sources);
	assert.strictEqual(
		resolveRuntimeResource(sources, { domain: SYSTEM_RESOURCE_DOMAIN, path: 'system/scene.aem' }),
		systemAem,
	);
	assert.deepEqual(activeDataResources(sources), [systemData, systemAem]);
});
