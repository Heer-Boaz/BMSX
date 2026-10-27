import { ProjectContentIndex, type ProjectContentEntry } from '../../ide/workbench/contrib/resources/panel/content_index';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { ResourceFilesModel, type FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';

const EMPTY_CONTENT: ReadonlyMap<string, readonly ProjectContentEntry[]> = new Map();
import { WorkbenchTreeNavigationResult, type WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { createTestRuntimeSourceState, createTestToolingPackage, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

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
	model.sync(sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
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
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), true);
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
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), false);
	assert.equal(iteration.mock.callCount(), 0); assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	f.sources.catalog.rebuildResources();
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), false);
	assert.equal(f.model.revision, revision); assert.equal(f.model.selectedNode, selected);
	assert.ok(roots.every((node, index) => f.model.tree.roots[index] === node));
	assert.equal(push.mock.callCount(), 0); assert.equal(sort.mock.callCount(), 0);
	const replacement = createScenarioTestSourceRecord('deep/inner/main.lua', 3, 'return 123', 'carts/first/deep/inner/main.lua');
	registerLuaSourceRecord(f.cart, replacement); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), false);
	assert.equal(f.model.selectedNode, selected);
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource.source, replacement);
});

test('excluded leaves and ancestors retain topology and collapse while selection retires explicitly', () => {
	const f = fixture();
	f.sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: 'config/nested/settings.yaml', sourcemeta: { text: 'enabled: true' } }]);
	f.model.sync(f.sources.catalog, 'all', EMPTY_CONTENT, 0);
	const leaf = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'config/nested/settings.yaml'), nested = leaf.parent!, directory = nested.parent!;
	f.model.navigate('left'); f.model.navigate('left');
	assert.equal(nested.collapsed, true);
	assert.equal(f.model.selectedNode, nested);
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.selectionIndex, -1);
	assert.equal(f.model.tree.rows.includes(directory), false);
	assert.equal(f.model.reveal({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'config/nested/settings.yaml' }), false);
	assert.equal(f.model.selectedNode, null, 'an excluded reveal never selects an unrelated visible row');
	f.model.sync(f.sources.catalog, 'all', EMPTY_CONTENT, 0);
	assert.equal(nested.collapsed, true); assert.equal(nested.parent, directory);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'config/nested/settings.yaml'), leaf);
});

test('removing a selected source retires its occurrence and never transfers selection to a neighbouring row', () => {
	const f = fixture(), removed = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'z/main.lua');
	const registry = f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources;
	const removedRecord = registry.path2lua['z/main.lua'];
	registry.records.splice(registry.records.indexOf(removedRecord), 1);
	delete registry.path2lua[removedRecord.source_path]; delete registry.module2lua[removedRecord.module_path];
	f.sources.catalog.rebuildResources(); f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	assert.equal(f.model.selectedNode, null); assert.equal(f.model.tree.rows.includes(removed), false);
	assert.equal(f.model.reveal({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'z/main.lua' }), false);
	const returned = createScenarioTestSourceRecord('z/main.lua', 4, undefined, 'carts/first/z/main.lua');
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, returned); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], returned);
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
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
	f.model.sync(next, 'lua_only', EMPTY_CONTENT, 0);
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
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	const selected = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), directory = selected.parent!;
	const other = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], path);
	assert.notEqual(selected, other); assert.notEqual(directory, other.parent);
	file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path); f.model.navigate('left'); f.model.navigate('left');
	assert.equal(directory.collapsed, true);
	f.sources.catalog.registerTextSources(TEST_SYSTEM_CONTEXT_ID, [{ type: 'data', resid: 'settings', source_path: 'res/settings.yaml' }]);
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	assert.equal(f.model.selectedNode, directory); assert.equal(directory.collapsed, true);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), selected);
	assert.equal(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[1], path), other);
});

test('shared animation rows expose their different project namespaces without repeating same-context provenance', t => {
	const source = "local timeline=require('cartlib/timeline/program'); local sprite=require('cartlib/component/sprite_animation_component'); timeline.compile(require('shared')); sprite.factory(require('shared'))";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('main.lua', 1, source),
		createScenarioTestSourceRecord('cartlib/timeline/program.lua', 1, 'return {}'),
		createScenarioTestSourceRecord('cartlib/component/sprite_animation_component.lua', 1, 'return {}'),
	]);
	const catalog = sources.catalog, first = catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	registerLuaSourceRecord(catalog.getContext(TEST_SYSTEM_CONTEXT_ID).luaSources,
		createScenarioTestSourceRecord('shared.lua', 1, "return {frames={'one'},frame_run=2}", 'machine/bios/shared.lua'));
	const second = catalog.admitContext({ ...first,
		admission: { id: TEST_CARTRIDGE_CONTEXT_IDS[1], projectRoot: 'carts/second' },
		previewPackage: createTestToolingPackage('carts/second'),
	});
	first.previewPackage.img.one = { type: 'image', resid: 'one', source_path: 'res/first/one.png' };
	second.previewPackage.img.one = { type: 'image', resid: 'one', source_path: 'res/second/one.png' };
	const models = new EditorTextModelService(), index = new ProjectContentIndex(models, catalog, new BehaviorRegistrationIndex(models, catalog));
	t.after(() => { index.dispose(); models.clear(); catalog.dispose(); });
	index.sync();
	const tree = new ResourceFilesModel(); tree.sync(catalog, 'lua_only', index.entriesByResource, index.revision);
	const shared = file(tree, TEST_SYSTEM_CONTEXT_ID, 'shared.lua');
	tree.navigate('right');
	assert.equal(shared.children.length, 3, 'one authored table retains its distinct discovering project namespaces');
	const crossContext = shared.children.filter(node => node.element.kind === 'definition'
		&& node.element.content.projectContextId !== TEST_SYSTEM_CONTEXT_ID);
	assert.equal(crossContext.length, 2);
	assert.equal(new Set(crossContext.map(node => node.element.label)).size, 2,
		'the visible rows distinguish otherwise identical authored labels with different asset namespaces');
	for (const node of shared.children) {
		assert.ok(node.element.kind === 'definition');
		const entry = node.element.content, context = catalog.getContext(entry.projectContextId);
		assert.ok(tree.tree.rows.includes(node));
		assert.ok(node.element.label.includes(entry.label));
		if (entry.projectContextId === TEST_SYSTEM_CONTEXT_ID) assert.equal(node.element.label, entry.label);
		else {
			assert.ok(node.element.label.includes(context.projectRootPath), 'the visible occurrence identifies its project, not its opaque context ID');
			const binding = catalog.resolveAsset(entry.projectContextId, 'img', 'one')!;
			assert.equal(binding.contextId, entry.projectContextId);
			assert.equal(binding.value, context.previewPackage.img.one);
		}
	}
	assert.notEqual(catalog.resolveAsset(first.id, 'img', 'one')!.value, catalog.resolveAsset(second.id, 'img', 'one')!.value);
	const caller = file(tree, first.id, 'main.lua');
	assert.equal(caller.children.length, 1);
	assert.ok(caller.children[0].element.kind === 'definition');
	assert.equal(caller.children[0].element.label, caller.children[0].element.content.label, 'the containing context already supplies local provenance');
	const previous = crossContext[0], previousLabel = previous.element.label;
	assert.ok(previous.element.kind === 'definition');
	const entry = previous.element.content;
	const callerModel = resolveLuaTextFileModel(models, catalog, catalog.resolveResource({ contextId: entry.projectContextId, path: 'main.lua' })!);
	callerModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved invocation\n' }]);
	index.sync(); tree.sync(catalog, 'lua_only', index.entriesByResource, index.revision);
	assert.ok(shared.children.includes(previous), 'a presentation update retains the authored occurrence row');
	assert.notEqual(previous.element.label, previousLabel);
	assert.ok(previous.element.label.includes(entry.label));
	assert.ok(previous.element.label.includes(catalog.getContext(entry.projectContextId).projectRootPath));
	for (let frame = 0; frame < 1000; frame++) assert.equal(tree.sync(catalog, 'lua_only', index.entriesByResource, index.revision), false);
});

test('changed canonical location replaces its selected tree projection without changing runtime resource identity', () => {
	const f = fixture(), path = 'runtime/shared.lua';
	const shared = createScenarioTestSourceRecord(path, 1, 'return 42', 'cartlib/world.lua');
	registerLuaSourceRecord(f.cart, shared); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], shared);
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	const leaf = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path), oldParent = leaf.parent;
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	const replacement = { ...shared, normalized_source_path: 'carts/first/src/world.lua' };
	registerLuaSourceRecord(f.cart, replacement); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement);
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), true);
	const selected = f.model.selectedNode!;
	assert.ok(selected !== leaf); assert.ok(file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], path) === selected);
	assert.ok(selected.parent !== oldParent); assert.equal(selected.parent!.element.path, 'src');
	assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.path, path);
	assert.ok(selected.element.resource === resource);
	assert.ok(resource === f.sources.catalog.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('same-path resource identity replacement publishes once over the retained row while same-resource source updates stay quiet', () => {
	const f = fixture(), contextId = TEST_CARTRIDGE_CONTEXT_IDS[0], path = 'deep/inner/main.lua';
	const selected = file(f.model, contextId, path); assert.ok(selected.element.kind === 'file');
	const previous = selected.element.resource, revision = f.model.revision, record = f.cart.path2lua[path];
	let changes = 0, coherent = false;
	const unbind = f.model.onDidChange(() => {
		changes++;
		coherent = selected.element.kind === 'file' && selected.element.resource !== previous
			&& selected.element.resource === f.sources.catalog.resolveResource(previous) && f.model.selectedNode === selected;
	});
	try {
		f.cart.records.splice(f.cart.records.indexOf(record), 1); delete f.cart.path2lua[path]; delete f.cart.module2lua[record.module_path];
		f.sources.catalog.rebuildResources(); registerLuaSourceRecord(f.cart, { ...record, update_timestamp: record.update_timestamp + 1 });
		f.sources.catalog.rebuildResources();
		assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), true);
		assert.equal(changes, 1); assert.equal(coherent, true); assert.equal(f.model.revision, revision + 1);
		const resource = selected.element.resource;
		const updated = createScenarioTestSourceRecord(path, 4, 'return 4', `carts/first/${path}`);
		registerLuaSourceRecord(f.cart, updated); f.sources.catalog.registerLuaResource(contextId, updated);
		assert.ok(f.sources.catalog.resolveResource(resource) === resource);
		assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), false);
		assert.equal(changes, 1); assert.equal(f.model.revision, revision + 1); assert.ok(f.model.selectedNode === selected);
	} finally { unbind(); }
});

test('a new source-state publishes replacement resources while retaining namespace topology and reading position', () => {
	const f = fixture(), selected = file(f.model, TEST_CARTRIDGE_CONTEXT_IDS[0], 'deep/inner/main.lua'), revision = f.model.revision;
	f.model.horizontalScroll = 17.5; f.model.tree.scroll = 2.25;
	const next = createTestRuntimeSourceState(f.system, [f.cart, f.other], 0);
	assert.equal(f.model.sync(next.catalog, 'lua_only', EMPTY_CONTENT, 0), true);
	assert.ok(f.model.selectedNode === selected); assert.equal(f.model.revision, revision + 1);
	assert.equal(f.model.horizontalScroll, 17.5); assert.equal(f.model.tree.scroll, 2.25);
	assert.ok(selected.element.kind === 'file');
	assert.ok(selected.element.resource === next.catalog.resourceByIdentity.get(resourceIdentityKey(selected.element)));
});

test('domains with no eligible resources have no fake placeholder rows or disclosure targets', () => {
	const sources = createTestRuntimeSourceState(registry('machine/bios', []), [registry('carts/empty', []), null], 0);
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: 'settings.yaml' }]);
	const model = new ResourceFilesModel(); model.sync(sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	assert.deepEqual(model.tree.roots, []); assert.deepEqual(model.tree.rows, []); assert.equal(model.selectedNode, null);
	assert.equal(model.navigate('down'), WorkbenchTreeNavigationResult.None);
	model.sync(sources.catalog, 'all', EMPTY_CONTENT, 0);
	assert.equal(model.tree.roots.length, 1); assert.equal(model.tree.roots[0].element.contextId, TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.equal(model.tree.rows.length, 2);
});

test('BIOS starts collapsed and only explicit reveal expands its retained contextId root', () => {
	const f = fixture(), bios = f.model.tree.roots.find(node => node.element.contextId === TEST_SYSTEM_CONTEXT_ID)!;
	assert.equal(bios.collapsed, true); assert.ok(bios.children.length > 0);
	assert.ok(bios.children.every(node => !f.model.tree.rows.includes(node)));
	const source = file(f.model, TEST_SYSTEM_CONTEXT_ID, 'system.lua');
	assert.equal(bios.collapsed, false); assert.ok(f.model.tree.rows.includes(source));
	f.sources.catalog.rebuildResources(); f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0);
	assert.equal(f.model.tree.roots.find(node => node.element.contextId === TEST_SYSTEM_CONTEXT_ID), bios);
	assert.equal(bios.collapsed, false, 'a deliberate reveal is retained, not reset to the initial preference');
});


test('publishing Lua at an existing data identity publishes its new catalog classification', () => {
	const f = fixture(), identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'settings/virtual.lua' };
	f.sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'settings', source_path: identity.path }]);
	f.model.sync(f.sources.catalog, 'all', EMPTY_CONTENT, 0); const leaf = file(f.model, identity.contextId, identity.path);
	assert.ok(leaf.element.kind === 'file'); const resource = leaf.element.resource;
	f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0); assert.equal(f.model.selectedNode, null);
	const revision = f.sources.catalog.revision, source = createScenarioTestSourceRecord(identity.path, 2, undefined, `carts/first/${identity.path}`);
	registerLuaSourceRecord(f.cart, source); assert.equal(f.sources.catalog.registerLuaResource(identity.contextId, source), resource);
	assert.ok(f.sources.catalog.revision > revision); assert.ok(f.sources.catalog.luaResources.includes(resource));
	assert.equal(f.model.sync(f.sources.catalog, 'lua_only', EMPTY_CONTENT, 0), true);
	assert.equal(file(f.model, identity.contextId, identity.path), leaf);
	assert.equal(resource.source, source);
});
