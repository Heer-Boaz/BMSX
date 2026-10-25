import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceIdentityKey, type ResourceDomain } from '../../ide/common/resource';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { rebuildRuntimeSourceResources, registerRuntimeLuaResource, registerWorkspaceTextSources } from '../../ide/runtime/sources';
import { ResourceFilesModel, type FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { WorkbenchTreeNavigationResult, type WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
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
	model.sync(sources, 'lua_only');
	return { model, sources, system, cart, other };
}
function file(model: ResourceFilesModel, domain: ResourceDomain, path: string): WorkbenchTreeNode<FileElement> {
	assert.equal(model.reveal({ domain, path }), true);
	const selected = model.selectedNode!;
	assert.equal(selected.element.kind, 'file');
	assert.equal(selected.element.domain, domain); assert.equal(selected.element.path, path);
	return selected;
}

test('Files retains canonical project roots, full directory parents and canonical resource leaves', () => {
	const f = fixture(), roots = f.model.tree.roots;
	assert.deepEqual(roots.map(node => node.element.kind === 'root'
		? [node.element.locationKind, node.element.domain, node.element.path] : null),
	[['project', -1, 'machine/bios'], ['project', 0, 'carts/first'], ['project', 1, 'carts/second']]);
	assert.ok(roots.every(node => node.parent === null && node.depth === 0));
	assert.equal(roots[0].collapsed, true);
	assert.ok(roots.slice(1).every(node => !node.collapsed));
	const directory = roots[1].children.find(node => node.element.kind === 'directory' && node.element.path === 'deep')!;
	assert.equal(directory.collapsed, true); assert.equal(directory.parent, roots[1]);
	const inner = directory.children[0], leaf = inner.children[0];
	assert.equal(inner.element.path, 'deep/inner'); assert.equal(inner.parent, directory);
	assert.equal(leaf.parent, inner); assert.equal(leaf.depth, 3);
	assert.ok(leaf.element.kind === 'file');
	assert.equal(leaf.element.resource, f.sources.resourceByIdentity.get(resourceIdentityKey(leaf.element)));
	assert.equal(f.model.tree.rows.includes(leaf), false);
	assert.equal(file(f.model, 0, 'deep/inner/main.lua'), leaf);
	assert.equal(directory.collapsed, false); assert.equal(inner.collapsed, false);
	assert.ok(f.model.tree.rows.includes(leaf));
	assert.notEqual(file(f.model, 1, 'deep/inner/main.lua'), leaf, 'equal written paths in different slots are distinct subjects');
});

test('Left/Right and disclosure use shared tree semantics without opening or mutating authored resources', () => {
	const f = fixture(), leaf = file(f.model, 0, 'deep/inner/main.lua'), inner = leaf.parent!;
	const source = f.sources.resourceByIdentity.get(resourceIdentityKey(leaf.element))!.source;
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
	assert.equal(f.sources.resourceByIdentity.get(resourceIdentityKey(leaf.element))!.source, source);
});

test('a new earlier sibling retains the selected folder node instead of its obsolete ordinal', () => {
	const f = fixture(); file(f.model, 0, 'z/main.lua'); f.model.navigate('left');
	const selected = f.model.selectedNode, index = f.model.tree.selectionIndex, rows = f.model.tree.rows;
	const added = createScenarioTestSourceRecord('a/first.lua', 2, undefined, 'carts/first/a/first.lua');
	registerLuaSourceRecord(f.cart, added); registerRuntimeLuaResource(f.sources, 0, added);
	assert.equal(f.model.sync(f.sources, 'lua_only'), true);
	assert.equal(f.model.tree.rows, rows); assert.equal(f.model.selectedNode, selected);
	assert.ok(f.model.tree.selectionIndex > index);
});

test('full catalog publications and same-key source replacement preserve nodes without row rebuild or sorting', t => {
	const f = fixture(), selected = file(f.model, 0, 'deep/inner/main.lua'), rows = f.model.tree.rows;
	const roots = [...f.model.tree.roots], revision = f.model.revision, originalPush = rows.push;
	const push = t.mock.fn(originalPush); rows.push = push; t.after(() => { rows.push = originalPush; });
	const children = roots[1].children, originalSort = children.sort, sort = t.mock.fn(originalSort);
	children.sort = sort; t.after(() => { children.sort = originalSort; });
	const iterate = f.sources.resourceByIdentity[Symbol.iterator], iteration = t.mock.fn(iterate);
	f.sources.resourceByIdentity[Symbol.iterator] = iteration;
	t.after(() => { f.sources.resourceByIdentity[Symbol.iterator] = iterate; });
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.model.sync(f.sources, 'lua_only'), false);
	assert.equal(iteration.mock.callCount(), 0); assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	rebuildRuntimeSourceResources(f.sources);
	assert.equal(f.model.sync(f.sources, 'lua_only'), false);
	assert.equal(f.model.revision, revision); assert.equal(f.model.selectedNode, selected);
	assert.ok(roots.every((node, index) => f.model.tree.roots[index] === node));
	assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	const replacement = createScenarioTestSourceRecord('deep/inner/main.lua', 3, 'return 123', 'carts/first/deep/inner/main.lua');
	registerLuaSourceRecord(f.cart, replacement); registerRuntimeLuaResource(f.sources, 0, replacement);
	assert.equal(f.model.sync(f.sources, 'lua_only'), false);
	assert.equal(f.model.selectedNode, selected);
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource.source, replacement);
});

test('excluded leaves and ancestors retain topology and collapse while selection retires explicitly', () => {
	const f = fixture();
	registerWorkspaceTextSources(f.sources, 0, [{ type: 'data', resid: 'settings', source_path: 'config/nested/settings.yaml', sourcemeta: { text: 'enabled: true' } }]);
	f.model.sync(f.sources, 'all');
	const leaf = file(f.model, 0, 'config/nested/settings.yaml'), nested = leaf.parent!, directory = nested.parent!;
	f.model.navigate('left'); f.model.navigate('left');
	assert.equal(nested.collapsed, true);
	assert.equal(f.model.selectedNode, nested);
	f.model.sync(f.sources, 'lua_only');
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.selectionIndex, -1);
	assert.equal(f.model.tree.rows.includes(directory), false);
	assert.equal(f.model.reveal({ domain: 0, path: 'config/nested/settings.yaml' }), false);
	assert.equal(f.model.selectedNode, null, 'an excluded reveal never selects an unrelated visible row');
	f.model.sync(f.sources, 'all');
	assert.equal(nested.collapsed, true); assert.equal(nested.parent, directory);
	assert.equal(file(f.model, 0, 'config/nested/settings.yaml'), leaf);
});

test('removing a selected source retires its occurrence and never transfers selection to a neighbouring row', () => {
	const f = fixture(), removed = file(f.model, 0, 'z/main.lua');
	f.sources.cartridgeSlots[0]!.luaSources = registry('carts/first', ['deep/inner/main.lua', 'top.lua']);
	rebuildRuntimeSourceResources(f.sources); f.model.sync(f.sources, 'lua_only');
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.rows.includes(removed), false);
	assert.equal(f.model.reveal({ domain: 0, path: 'z/main.lua' }), false);
	const returned = createScenarioTestSourceRecord('z/main.lua', 4, undefined, 'carts/first/z/main.lua');
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, returned); registerRuntimeLuaResource(f.sources, 0, returned);
	f.model.sync(f.sources, 'lua_only');
	assert.equal(f.model.selectedNode, null);
	assert.notEqual(file(f.model, 0, 'z/main.lua'), removed, 'a newly published occurrence does not resurrect the removed node');
});

test('slot namespace replacement retires equal-path nodes but leaves unrelated domain view state intact', () => {
	const f = fixture(), first = file(f.model, 0, 'deep/inner/main.lua'), other = file(f.model, 1, 'deep/inner/main.lua');
	file(f.model, 0, 'deep/inner/main.lua');
	const next = createTestRuntimeSourceState(f.system, [registry('carts/replacement', ['deep/inner/main.lua']), f.other], 0);
	f.model.sync(next, 'lua_only');
	assert.equal(f.model.selectedNode, null);
	assert.equal(file(f.model, 1, 'deep/inner/main.lua'), other);
	assert.notEqual(file(f.model, 0, 'deep/inner/main.lua'), first);
});

test('project replacement retires project roots while canonical shared occurrences retain their own context and view state', () => {
	const f = fixture(), path = 'runtime/shared.lua';
	const shared = createScenarioTestSourceRecord(path, 1, 'return 42', 'cartlib/world.lua');
	for (const domain of [0, 1] as const) {
		registerLuaSourceRecord(f.sources.cartridgeSlots[domain]!.luaSources, { ...shared });
		registerRuntimeLuaResource(f.sources, domain, f.sources.cartridgeSlots[domain]!.luaSources.path2lua[path]);
	}
	f.model.sync(f.sources, 'lua_only');
	const rootOf = (node: WorkbenchTreeNode<FileElement>) => {
		while (node.parent !== null) node = node.parent;
		return node;
	};
	const project = rootOf(file(f.model, 0, 'top.lua'));
	const selected = file(f.model, 0, path), root = rootOf(selected), directory = selected.parent!;
	const other = file(f.model, 1, path), otherRoot = rootOf(other);
	assert.ok(root.element.kind === 'root'); assert.equal(root.element.locationKind, 'workspace');
	assert.ok(otherRoot.element.kind === 'root'); assert.equal(otherRoot.element.locationKind, 'workspace');
	assert.ok(root !== otherRoot, 'shared provenance does not merge distinct runtime-context occurrences');
	assert.ok(selected !== other); assert.equal(directory.element.path, 'cartlib');
	file(f.model, 0, path);
	f.model.navigate('left'); f.model.navigate('left');
	assert.equal(directory.collapsed, true);
	const nextCart = registry('carts/replacement', ['deep/inner/main.lua', 'top.lua']);
	registerLuaSourceRecord(nextCart, { ...shared });
	const next = createTestRuntimeSourceState(f.system, [nextCart, f.other], 0);
	f.model.sync(next, 'lua_only');
	assert.ok(f.model.selectedNode === directory);
	assert.equal(directory.collapsed, true);
	assert.ok(file(f.model, 0, path) === selected); assert.ok(rootOf(selected) === root);
	assert.ok(file(f.model, 1, path) === other); assert.ok(rootOf(other) === otherRoot);
	assert.ok(rootOf(file(f.model, 0, 'top.lua')) !== project);
	assert.ok(selected.element.kind === 'file');
	assert.ok(selected.element.resource === next.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('changed canonical location replaces its selected tree projection without changing runtime resource identity', () => {
	const f = fixture(), path = 'runtime/shared.lua';
	const shared = createScenarioTestSourceRecord(path, 1, 'return 42', 'cartlib/world.lua');
	registerLuaSourceRecord(f.cart, shared); registerRuntimeLuaResource(f.sources, 0, shared);
	f.model.sync(f.sources, 'lua_only');
	const leaf = file(f.model, 0, path), oldParent = leaf.parent;
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	const replacement = { ...shared, normalized_source_path: 'carts/first/src/world.lua' };
	registerLuaSourceRecord(f.cart, replacement); registerRuntimeLuaResource(f.sources, 0, replacement);
	assert.equal(f.model.sync(f.sources, 'lua_only'), true);
	const selected = f.model.selectedNode!;
	assert.ok(selected !== leaf); assert.ok(file(f.model, 0, path) === selected);
	assert.ok(selected.parent !== oldParent); assert.equal(selected.parent!.element.path, 'src');
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.path, path);
	assert.ok(selected.element.resource === resource);
	assert.ok(resource === f.sources.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('unchanged namespaces in a new source-state object retain canonical topology and update actual resource references', () => {
	const f = fixture(), selected = file(f.model, 0, 'deep/inner/main.lua'), revision = f.model.revision;
	f.model.horizontalScroll = 17.5; f.model.tree.scroll = 2.25;
	const next = createTestRuntimeSourceState(f.system, [f.cart, f.other], 0);
	assert.equal(f.model.sync(next, 'lua_only'), false);
	assert.equal(f.model.selectedNode, selected); assert.equal(f.model.revision, revision);
	assert.equal(f.model.horizontalScroll, 17.5); assert.equal(f.model.tree.scroll, 2.25);
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource, next.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('domains with no eligible resources have no fake placeholder rows or disclosure targets', () => {
	const sources = createTestRuntimeSourceState(registry('machine/bios', []), [registry('carts/empty', []), null], 0);
	registerWorkspaceTextSources(sources, 0, [{ type: 'data', resid: 'settings', source_path: 'settings.yaml' }]);
	const model = new ResourceFilesModel(); model.sync(sources, 'lua_only');
	assert.deepEqual(model.tree.roots, []); assert.deepEqual(model.tree.rows, []); assert.equal(model.selectedNode, null);
	assert.equal(model.navigate('down'), WorkbenchTreeNavigationResult.None);
	model.sync(sources, 'all');
	assert.equal(model.tree.roots.length, 1); assert.equal(model.tree.roots[0].element.domain, 0);
	assert.equal(model.tree.rows.length, 2);
});

test('BIOS starts collapsed and only explicit reveal expands its retained domain root', () => {
	const f = fixture(), bios = f.model.tree.roots.find(node => node.element.domain === -1)!;
	assert.equal(bios.collapsed, true); assert.ok(bios.children.length > 0);
	assert.ok(bios.children.every(node => !f.model.tree.rows.includes(node)));
	const source = file(f.model, -1, 'system.lua');
	assert.equal(bios.collapsed, false); assert.ok(f.model.tree.rows.includes(source));
	rebuildRuntimeSourceResources(f.sources); f.model.sync(f.sources, 'lua_only');
	assert.equal(f.model.tree.roots.find(node => node.element.domain === -1), bios);
	assert.equal(bios.collapsed, false, 'a deliberate reveal is retained, not reset to the initial preference');
});


test('publishing Lua at an existing data identity publishes its new catalog classification', () => {
	const f = fixture(), identity = { domain: 0 as const, path: 'settings/virtual.lua' };
	registerWorkspaceTextSources(f.sources, 0, [{ type: 'data', resid: 'settings', source_path: identity.path }]);
	f.model.sync(f.sources, 'all'); const leaf = file(f.model, identity.domain, identity.path);
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	f.model.sync(f.sources, 'lua_only'); assert.equal(f.model.selectedNode, null);
	const revision = f.sources.resourceCatalogRevision, source = createScenarioTestSourceRecord(identity.path, 2, undefined, `carts/first/${identity.path}`);
	registerLuaSourceRecord(f.cart, source); assert.equal(registerRuntimeLuaResource(f.sources, identity.domain, source), resource);
	assert.ok(f.sources.resourceCatalogRevision > revision); assert.ok(f.sources.luaResources.includes(resource));
	assert.equal(f.model.sync(f.sources, 'lua_only'), true);
	assert.equal(file(f.model, identity.domain, identity.path), leaf);
	assert.equal(resource.source, source);
});
