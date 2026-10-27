import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ResourceFilesModel, type FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { WorkbenchTreeNavigationResult, type WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { createTestRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';

function registry(root: string, paths: readonly string[]): LuaSourceRegistry {
	const value: LuaSourceRegistry = { projectRootPath: root, records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', can_boot_from_source: false, revision: 0 };
	for (const path of paths) registerLuaSourceRecord(value, createScenarioTestSourceRecord(path, 1, undefined, `${root}/${path}`));
	return value;
}
function fixture() {
	const system = registry('machine/bios', ['system.lua']);
	const cart = registry('carts/first', ['deep/inner/main.lua', 'z/main.lua', 'top.lua']);
	const other = registry('carts/second', ['deep/inner/main.lua']);
	const sources = createTestRuntimeSourceState(system, [cart, other], 0), model = new ResourceFilesModel();
	model.tree.layout.visibleRowCount = 4;
	model.sync(sources.catalog, 'lua_only');
	return { model, sources, system, cart, other };
}
function file(model: ResourceFilesModel, contextId: string, path: string): WorkbenchTreeNode<FileElement> {
	assert.equal(model.reveal({ contextId, path }), true);
	const selected = model.selectedNode!;
	assert.equal(selected.element.kind, 'file');
	assert.equal(selected.element.contextId, contextId); assert.equal(selected.element.path, path);
	return selected;
}

test('Files retains canonical project roots, full directory parents and canonical resource leaves', () => {
	const f = fixture(), roots = f.model.tree.roots;
	assert.deepEqual(roots.map(node => node.element.kind === 'root'
		? [node.element.locationKind, node.element.contextId, node.element.path] : null),
	[['project', TEST_SYSTEM_CONTEXT_ID, 'machine/bios'], ['project', TEST_CARTRIDGE_CONTEXT_IDS[0], 'carts/first'], ['project', TEST_CARTRIDGE_CONTEXT_IDS[1], 'carts/second']]);
	assert.ok(roots.every(node => node.parent === null && node.depth === 0));
	assert.equal(roots[0].collapsed, true);
	assert.ok(roots.slice(1).every(node => !node.collapsed));
	const directory = roots[1].children.find(node => node.element.kind === 'directory' && node.element.path === 'deep')!;
	assert.equal(directory.collapsed, true); assert.equal(directory.parent, roots[1]);
	const inner = directory.children[0], leaf = inner.children[0];
	assert.equal(inner.element.path, 'deep/inner'); assert.equal(inner.parent, directory);
	assert.equal(leaf.parent, inner); assert.equal(leaf.depth, 3);
	assert.ok(leaf.element.kind === 'file');
	assert.equal(leaf.element.resource, f.sources.catalog.resourceByIdentity.get(resourceIdentityKey(leaf.element)));
	assert.equal(f.model.tree.rows.includes(leaf), false);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), leaf);
	assert.equal(directory.collapsed, false); assert.equal(inner.collapsed, false);
	assert.ok(f.model.tree.rows.includes(leaf));
	assert.notEqual(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], 'deep/inner/main.lua'), leaf, 'equal written paths in different slots are distinct subjects');
});

test('Left/Right and disclosure use shared tree semantics without opening or mutating authored resources', () => {
	const f = fixture(), leaf = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), inner = leaf.parent!;
	const source = f.sources.catalog.resourceByIdentity.get(resourceIdentityKey(leaf.element))!.source;
	let revision = f.model.revision;
	assert.equal(f.model.navigate('left'), WorkbenchTreeNavigationResult.Selection);
	assert.equal(f.model.selectedNode, inner); assert.equal(f.model.revision, revision);
	assert.equal(f.model.navigate('left'), WorkbenchTreeNavigationResult.Collapse);
	assert.equal(inner.collapsed, true); assert.equal(f.model.selectedNode, inner); assert.equal(f.model.revision, ++revision);
	assert.equal(f.model.navigate('right'), WorkbenchTreeNavigationResult.Collapse);
	assert.equal(inner.collapsed, false); assert.equal(f.model.selectedNode, inner); assert.equal(f.model.revision, ++revision);
	assert.equal(f.model.navigate('right'), WorkbenchTreeNavigationResult.Selection); assert.equal(f.model.selectedNode, leaf);
	assert.equal(f.model.toggle(f.model.tree.rows.indexOf(leaf)), false); assert.equal(f.model.revision, revision);
	assert.equal(f.model.toggle(f.model.tree.rows.indexOf(inner)), true);
	assert.equal(f.model.selectedNode, inner); assert.equal(f.model.tree.rows.includes(leaf), false);
	assert.equal(f.sources.catalog.resourceByIdentity.get(resourceIdentityKey(leaf.element))!.source, source);
});

test('a new earlier sibling retains the selected folder node instead of its obsolete ordinal', () => {
	const f = fixture(); file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'z/main.lua'); f.model.navigate('left');
	const selected = f.model.selectedNode, index = f.model.tree.selectionIndex, rows = f.model.tree.rows;
	const added = createScenarioTestSourceRecord('a/first.lua', 2, undefined, 'carts/first/a/first.lua');
	registerLuaSourceRecord(f.cart, added); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], added);
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), true);
	assert.equal(f.model.tree.rows, rows); assert.equal(f.model.selectedNode, selected);
	assert.ok(f.model.tree.selectionIndex > index);
});

test('full catalog publications and same-key source replacement preserve nodes without row rebuild or sorting', t => {
	const f = fixture(), selected = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), rows = f.model.tree.rows;
	const roots = [...f.model.tree.roots], revision = f.model.revision, originalPush = rows.push;
	const push = t.mock.fn(originalPush); rows.push = push; t.after(() => { rows.push = originalPush; });
	const children = roots[1].children, originalSort = children.sort, sort = t.mock.fn(originalSort);
	children.sort = sort; t.after(() => { children.sort = originalSort; });
	const iterate = f.sources.catalog.resourceByIdentity[Symbol.iterator], iteration = t.mock.fn(iterate);
	f.sources.catalog.resourceByIdentity[Symbol.iterator] = iteration;
	t.after(() => { f.sources.catalog.resourceByIdentity[Symbol.iterator] = iterate; });
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), false);
	assert.equal(iteration.mock.callCount(), 0); assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	f.sources.catalog.rebuildResources();
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), false);
	assert.equal(f.model.revision, revision); assert.equal(f.model.selectedNode, selected);
	assert.ok(roots.every((node, index) => f.model.tree.roots[index] === node));
	assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	const replacement = createScenarioTestSourceRecord('deep/inner/main.lua', 3, 'return 123', 'carts/first/deep/inner/main.lua');
	registerLuaSourceRecord(f.cart, replacement); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), false);
	assert.equal(f.model.selectedNode, selected);
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource.source, replacement);
});

test('excluded leaves and ancestors retain topology and collapse while selection retires explicitly', () => {
	const f = fixture();
	f.sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: 'config/nested/settings.yaml', sourcemeta: { text: 'enabled: true' } }]);
	f.model.sync(f.sources.catalog, 'all');
	const leaf = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'config/nested/settings.yaml'), nested = leaf.parent!, directory = nested.parent!;
	f.model.navigate('left'); f.model.navigate('left');
	assert.equal(nested.collapsed, true);
	assert.equal(f.model.selectedNode, nested);
	f.model.sync(f.sources.catalog, 'lua_only');
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.selectionIndex, -1);
	assert.equal(f.model.tree.rows.includes(directory), false);
	assert.equal(f.model.reveal({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'config/nested/settings.yaml' }), false);
	assert.equal(f.model.selectedNode, null, 'an excluded reveal never selects an unrelated visible row');
	f.model.sync(f.sources.catalog, 'all');
	assert.equal(nested.collapsed, true); assert.equal(nested.parent, directory);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'config/nested/settings.yaml'), leaf);
});

test('removing a selected source retires its occurrence and never transfers selection to a neighbouring row', () => {
	const f = fixture(), removed = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'z/main.lua');
	const registry = f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources;
	const removedRecord = registry.path2lua['z/main.lua'];
	registry.records.splice(registry.records.indexOf(removedRecord), 1);
	delete registry.path2lua[removedRecord.source_path]; delete registry.module2lua[removedRecord.module_path];
	f.sources.catalog.rebuildResources(); f.model.sync(f.sources.catalog, 'lua_only');
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.rows.includes(removed), false);
	assert.equal(f.model.reveal({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'z/main.lua' }), false);
	const returned = createScenarioTestSourceRecord('z/main.lua', 4, undefined, 'carts/first/z/main.lua');
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, returned); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], returned);
	f.model.sync(f.sources.catalog, 'lua_only');
	assert.equal(f.model.selectedNode, null);
	assert.notEqual(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'z/main.lua'), removed, 'a newly published occurrence does not resurrect the removed node');
});

test('a different admitted context retires equal-path nodes without merging unrelated context view state', () => {
	const f = fixture(), first = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), other = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], 'deep/inner/main.lua');
	file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua');
	const next = new WorkspaceSourceCatalog();
	for (const context of f.sources.catalog.contexts.values()) {
		if (context.id === TEST_CARTRIDGE_CONTEXT_IDS[0]) next.admitContext({ ...context,
			admission: { id: 'replacement-admission', projectRoot: 'carts/replacement' },
			luaSources: registry('carts/replacement', ['deep/inner/main.lua']), previewRom: null, assetSources: [] });
		else next.admitContext(context);
	}
	f.model.sync(next, 'lua_only');
	assert.equal(f.model.selectedNode, null);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], 'deep/inner/main.lua'), other);
	assert.notEqual(file(f.model, 'replacement-admission', 'deep/inner/main.lua'), first);
});

test('equal shared provenance retains distinct admitted context projections across unrelated catalog publication', () => {
	const f = fixture(), path = 'runtime/shared.lua';
	for (const contextId of TEST_CARTRIDGE_CONTEXT_IDS) {
		const source = createScenarioTestSourceRecord(path, 1, 'return 42', 'cartlib/world.lua');
		registerLuaSourceRecord(f.sources.catalog.getContext(contextId).luaSources, source);
	}
	f.model.sync(f.sources.catalog, 'lua_only');
	const selected = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), directory = selected.parent!;
	const other = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], path);
	assert.notEqual(selected, other); assert.notEqual(directory, other.parent);
	file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path); f.model.navigate('left'); f.model.navigate('left');
	assert.equal(directory.collapsed, true);
	f.sources.catalog.registerTextSources(TEST_SYSTEM_CONTEXT_ID, [{ type: 'data', resid: 'settings', source_path: 'res/settings.yaml' }]);
	f.model.sync(f.sources.catalog, 'lua_only');
	assert.equal(f.model.selectedNode, directory); assert.equal(directory.collapsed, true);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), selected);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], path), other);
});

test('changed canonical location replaces its selected tree projection without changing runtime resource identity', () => {
	const f = fixture(), path = 'runtime/shared.lua';
	const shared = createScenarioTestSourceRecord(path, 1, 'return 42', 'cartlib/world.lua');
	registerLuaSourceRecord(f.cart, shared); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], shared);
	f.model.sync(f.sources.catalog, 'lua_only');
	const leaf = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), oldParent = leaf.parent;
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	const replacement = { ...shared, normalized_source_path: 'carts/first/src/world.lua' };
	registerLuaSourceRecord(f.cart, replacement); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), true);
	const selected = f.model.selectedNode!;
	assert.ok(selected !== leaf); assert.ok(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path) === selected);
	assert.ok(selected.parent !== oldParent); assert.equal(selected.parent!.element.path, 'src');
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.path, path);
	assert.ok(selected.element.resource === resource);
	assert.ok(resource === f.sources.catalog.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('unchanged namespaces in a new source-state object retain canonical topology and update actual resource references', () => {
	const f = fixture(), selected = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), revision = f.model.revision;
	f.model.horizontalScroll = 17.5; f.model.tree.scroll = 2.25;
	const next = createTestRuntimeSourceState(f.system, [f.cart, f.other], 0);
	assert.equal(f.model.sync(next.catalog, 'lua_only'), false);
	assert.equal(f.model.selectedNode, selected); assert.equal(f.model.revision, revision);
	assert.equal(f.model.horizontalScroll, 17.5); assert.equal(f.model.tree.scroll, 2.25);
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource, next.catalog.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('domains with no eligible resources have no fake placeholder rows or disclosure targets', () => {
	const sources = createTestRuntimeSourceState(registry('machine/bios', []), [registry('carts/empty', []), null], 0);
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: 'settings.yaml' }]);
	const model = new ResourceFilesModel(); model.sync(sources.catalog, 'lua_only');
	assert.deepEqual(model.tree.roots, []); assert.deepEqual(model.tree.rows, []); assert.equal(model.selectedNode, null);
	assert.equal(model.navigate('down'), WorkbenchTreeNavigationResult.None);
	model.sync(sources.catalog, 'all');
	assert.equal(model.tree.roots.length, 1); assert.equal(model.tree.roots[0].element.contextId, TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.equal(model.tree.rows.length, 2);
});

test('BIOS starts collapsed and only explicit reveal expands its retained contextId root', () => {
	const f = fixture(), bios = f.model.tree.roots.find(node => node.element.contextId === TEST_SYSTEM_CONTEXT_ID)!;
	assert.equal(bios.collapsed, true); assert.ok(bios.children.length > 0);
	assert.ok(bios.children.every(node => !f.model.tree.rows.includes(node)));
	const source = file(f.model, TEST_SYSTEM_CONTEXT_ID, 'system.lua');
	assert.equal(bios.collapsed, false); assert.ok(f.model.tree.rows.includes(source));
	f.sources.catalog.rebuildResources(); f.model.sync(f.sources.catalog, 'lua_only');
	assert.equal(f.model.tree.roots.find(node => node.element.contextId === TEST_SYSTEM_CONTEXT_ID), bios);
	assert.equal(bios.collapsed, false, 'a deliberate reveal is retained, not reset to the initial preference');
});


test('publishing Lua at an existing data identity publishes its new catalog classification', () => {
	const f = fixture(), identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'settings/virtual.lua' };
	f.sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: identity.path }]);
	f.model.sync(f.sources.catalog, 'all'); const leaf = file(f.model, identity.contextId, identity.path);
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	f.model.sync(f.sources.catalog, 'lua_only'); assert.equal(f.model.selectedNode, null);
	const revision = f.sources.catalog.revision, source = createScenarioTestSourceRecord(identity.path, 2, undefined, `carts/first/${identity.path}`);
	registerLuaSourceRecord(f.cart, source); assert.equal(f.sources.catalog.registerLuaResource(identity.contextId, source), resource);
	assert.ok(f.sources.catalog.revision > revision); assert.ok(f.sources.catalog.luaResources.includes(resource));
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only'), true);
	assert.equal(file(f.model, identity.contextId, identity.path), leaf);
	assert.equal(resource.source, source);
});
