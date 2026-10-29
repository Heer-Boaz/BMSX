import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { createActualSourcePanes } from '../helpers/source_panes';

const API_MODULES = [
	'cartlib/world/scene_library', 'cartlib/behaviour_tree/library', 'cartlib/fsm/library', 'cartlib/actioneffects',
	'cartlib/progression', 'cartlib/input/actioneffect/actioneffect_component', 'cartlib/timeline/program',
];
const ALL_CONTENT_SOURCE = `local scenes = require('cartlib/world/scene_library')
local trees = require('cartlib/behaviour_tree/library')
local machines = require('cartlib/fsm/library')
local effects = require('cartlib/actioneffects')
local progression = require('cartlib/progression')
local input = require('cartlib/input/actioneffect/actioneffect_component')
local timeline = require('cartlib/timeline/program')
scenes.register('same', { objects = { { member_id = 'first', definition_id = 'actor' } } })
scenes.register('same', { objects = { { member_id = 'second', definition_id = 'actor' } } })
trees.register('tree', { root = { type = 'wait', duration_ticks = 2 } })
machines.register('machine', { initial = 'idle', states = { idle = {}, active = {} } })
effects.register_effect('effect', { cooldown_ms = 10 })
progression.compile_program({ initial = 'start', states = { start = {} } })
input.factory({ program = { bindings = {} } })
timeline.compile({ duration_frames = 4 })
`;

type DefinitionNode = WorkbenchTreeNode<FileElement> & { readonly element: Extract<FileElement, { kind: 'definition' }> };

function fixture(t: TestContext, source = ALL_CONTENT_SOURCE, additionalSources: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [
		...API_MODULES.map(module => [`${module}.lua`, 'return {}'] as const), ['content.lua', source], ...additionalSources,
	], () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'content.lua' })!;
	const panel = f.editor.resourcePanel;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection();
	const file = panel.files.selectedNode!;
	assert.ok(file.element.kind === 'file'); assert.equal(file.element.resource, resource);
	panel.navigateFiles('right');
	const definitions = () => file.children.filter((node): node is DefinitionNode => node.element.kind === 'definition');
	const activate = (node: DefinitionNode) => {
		panel.setFocused(true);
		const index = panel.files.tree.rows.indexOf(node); assert.ok(index >= 0);
		panel.setSelectionIndex(index); f.key('Enter');
		return f.editor.editorParts.activeGroup;
	};
	return { ...f, panel, file, definitions, activate, resource };
}

test('the real project tree activates all authored kinds and reveals each retained document after unrelated MRU changes', async t => {
	const f = fixture(t), parts = f.editor.editorParts, chosen = parts.activeGroup;
	const nodes = f.definitions();
	assert.deepEqual(new Set(nodes.map(node => node.element.content.kind)),
		new Set(['scene', 'behavior_tree', 'state_machine', 'action_effect', 'progression', 'input', 'animation']));
	assert.ok(nodes.every(node => node.parent === f.file));
	assert.equal(editorTextModelService.get(f.resource), undefined, 'project discovery does not open every source working copy');
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	const secondScene = nodes.filter(node => node.element.content.kind === 'scene')[1];
	const sceneGroup = f.activate(secondScene), scene = sceneGroup.model.activeTab;
	assert.ok(sceneGroup === chosen); assert.ok(scene instanceof SceneEditorInput);
	assert.deepEqual(scene.view.authoring.selectionRange, secondScene.element.content.range);
	const sceneRoot = scene.view.hierarchy.outline.rows[scene.view.hierarchy.outline.selectionIndex];
	assert.equal(sceneRoot.element.kind, 'scene');
	const memberIndex = scene.view.hierarchy.outline.rows.findIndex(node => node.parent === sceneRoot);
	assert.ok(memberIndex >= 0); selectSceneOutlineRow(scene.view.hierarchy, memberIndex); f.update();
	const sceneSelection = { ...scene.view.authoring.selectionRange };
	for (const node of nodes) {
		const entry = node.element.content;
		if (entry.kind === 'scene') continue;
		const group = f.activate(node), input = group.model.activeTab;
		assert.ok(parts.groups.includes(group));
		assert.ok(input !== null && 'workingCopy' in input);
		assert.ok(input.workingCopy === editorTextModelService.get(entry.ownerResource));
		switch (entry.kind) {
			case 'behavior_tree': case 'state_machine': case 'action_effect': {
				assert.ok(input instanceof BehaviorLensInput);
				assert.equal(input.view.definitionRowKey, entry.registration.rowKey);
				const range = input.view.source.ranges.get(input.view.definitionRowKey!)!;
				assert.deepEqual({ start: range.start, end: range.end }, entry.range);
				assert.equal(resourceIdentityKey(range.resource), resourceIdentityKey(entry.ownerResource));
				assert.equal(input.view.presentation.kind, entry.kind === 'behavior_tree' ? 'graph' : entry.kind === 'state_machine' ? 'state-graph' : 'properties');
				if (entry.kind === 'state_machine') {
					await input.graphLayout.settled; f.update();
					assert.equal(input.graphLayout.state.kind, 'ready');
				}
				break;
			}
			case 'progression': case 'input':
				assert.ok(input instanceof LuaProgramInput); assert.equal(input.programKind, entry.kind);
				assert.deepEqual(input.occurrenceRange, entry.range); assert.ok(input.occurrence !== undefined);
				assert.equal(resourceIdentityKey(input.occurrence.resource), resourceIdentityKey(entry.ownerResource));
				break;
			case 'animation':
				assert.ok(input instanceof AnimationEditorInput);
				assert.deepEqual(input.definitionRange, entry.range); assert.equal(input.projectContextId, entry.projectContextId);
				assert.equal(input.consumerPath, entry.definition.consumer?.file); assert.ok(input.document !== undefined);
				break;
		}
		const part = parts.partForGroup(group), total = group.model.tabs.length;
		const unrelated = parts.createDocument();
		unrelated.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.secondInput.workingCopy.resource));
		parts.minimize(part); unrelated.focus(); f.update();
		assert.ok(parts.activeGroup !== group); assert.equal(part.window!.model.minimized, true);
		assert.ok(f.activate(node) === group);
		assert.ok(group.model.activeTab === input); assert.equal(group.model.tabs.length, total);
		assert.equal(part.window!.model.minimized, false);
		assert.ok(sceneGroup.model.tabs.includes(scene)); assert.deepEqual(scene.view.authoring.selectionRange, sceneSelection);
	}
	assert.ok(f.activate(secondScene) === sceneGroup); assert.ok(sceneGroup.model.activeTab === scene);
	assert.deepEqual(scene.view.authoring.selectionRange, sceneSelection, 'reopening the same scene preserves its selected member');
	assert.equal(scene.workingCopy.buffer.getText(), ALL_CONTENT_SOURCE);
	assert.equal(scene.workingCopy.dirty, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles, 'source discovery and navigation never execute authored Lua');
});

test('dirty source edits reconcile real declaration children while retirement prevents stale namesake activation', t => {
	const source = `local effects = require('cartlib/actioneffects')
effects.register_effect('same', { cooldown_ms = 10 })
effects.register_effect('same', { cooldown_ms = 20 })
`;
	const f = fixture(t, source), original = f.definitions();
	assert.equal(original.length, 2);
	const selected = original[1], first = original[0];
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(selected));
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
	const start = selected.element.content.range.start;
	const inserted = "effects.register_effect('same', { cooldown_ms = 30 })\n";
	model.pushEditOperations([{ offset: first.element.content.range.start, deleteLength: 0, text: inserted }]);
	f.panel.refresh();
	assert.equal(model.dirty, true); assert.equal(f.definitions().length, 3);
	assert.equal(f.panel.files.selectedNode, selected); assert.equal(f.definitions()[2], selected);
	assert.equal(selected.element.content.range.start, start + inserted.length);
	model.undo(); f.panel.refresh();
	assert.equal(f.definitions().length, 2); assert.equal(f.panel.files.selectedNode, selected);
	assert.equal(selected.element.content.range.start, start);
	const active = f.editor.editorParts.activeGroup, input = active.model.activeTab;
	const range = { ...selected.element.content.range };
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '' }]);
	// Command admission must reject this old payload before a frame rebuilds the tree.
	f.panel.openSelected();
	assert.ok(f.editor.editorParts.activeGroup === active); assert.ok(active.model.activeTab === input);
	f.panel.refresh();
	assert.equal(f.panel.files.selectedNode, null); assert.deepEqual(f.definitions(), [first]);
	model.undo(); f.panel.refresh();
	assert.equal(f.definitions().length, 2); assert.equal(f.definitions()[0], first);
	assert.notEqual(f.definitions()[1], selected); assert.equal(f.panel.files.selectedNode, null);
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
});

test('canonical provenance reparenting replaces the file projection but preserves the selected authored occurrence', t => {
	const f = fixture(t), selected = f.definitions()[0], entry = selected.element.content;
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(selected));
	const registry = f.sources.catalog.getContext(f.resource.contextId).luaSources;
	const source = registry.path2lua[f.resource.path];
	const relocated = { ...source, normalized_source_path: 'relocated/content.lua' };
	registerLuaSourceRecord(registry, relocated);
	assert.equal(f.sources.catalog.registerLuaResource(f.resource.contextId, relocated), f.resource);
	f.panel.refresh();
	const current = f.panel.files.selectedNode!;
	assert.ok(current.element.kind === 'definition'); assert.equal(current.element.content, entry);
	assert.notEqual(current, selected); assert.notEqual(current.parent, f.file);
	const file = current.parent!;
	assert.ok(file.element.kind === 'file'); assert.equal(file.element.resource, f.resource);
	assert.equal(file.element.location.path, 'relocated/content.lua');
	assert.ok(file.parent!.element.kind === 'directory'); assert.equal(file.parent!.element.path, 'relocated');
	assert.ok(f.panel.files.tree.rows.includes(current)); assert.equal(file.collapsed, false);
	assert.equal(editorTextModelService.get(f.resource), undefined, 'a provenance publication does not open a source working copy');
});

test('source retirement and file filtering clear selection without choosing a surviving namesake or resurrecting its old occurrence', t => {
	const source = "local effects=require('cartlib/actioneffects'); effects.register_effect('same', {})";
	const f = fixture(t, source, [['other.lua', source]]), selected = f.definitions()[0], entry = selected.element.content;
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(selected));
	const registry = f.sources.catalog.getContext(f.resource.contextId).luaSources, record = registry.path2lua[f.resource.path];
	registry.records.splice(registry.records.indexOf(record), 1);
	delete registry.path2lua[record.source_path]; delete registry.module2lua[record.module_path];
	f.sources.catalog.rebuildResources(); f.panel.refresh();
	assert.equal(f.panel.files.selectedNode, null); assert.equal(f.panel.files.tree.rows.includes(selected), false);
	const survivor = f.panel.files.tree.rows.find(node => node.element.kind === 'file' && node.element.path === 'other.lua')!;
	assert.ok(survivor.children.some(node => node.element.kind === 'definition' && node.element.content.kind === 'action_effect'));
	registerLuaSourceRecord(registry, record); f.sources.catalog.registerLuaResource(f.resource.contextId, record); f.panel.refresh();
	const returned = f.panel.files.tree.rows.find(node => node.element.kind === 'file' && node.element.path === f.resource.path)!;
	assert.equal(f.panel.files.selectedNode, null); assert.notEqual(returned, f.file);
	assert.ok(returned.children[0].element.kind === 'definition'); assert.notEqual(returned.children[0].element.content, entry);
	const identity = { contextId: f.resource.contextId, path: 'settings.yaml' };
	f.sources.catalog.registerTextSources(identity.contextId, [{ type: 'data', resid: 'settings', source_path: identity.path, sourcemeta: { text: 'enabled: true\n' } }]);
	f.panel.toggleFilterMode(); f.panel.queuePendingSelection(identity); f.panel.applyPendingSelection();
	const filtered = f.panel.files.selectedNode!; assert.ok(filtered.element.kind === 'file');
	assert.equal(filtered.element.resource, f.sources.catalog.resolveResource(identity));
	f.panel.toggleFilterMode();
	assert.equal(f.panel.files.selectedNode, null); assert.equal(f.panel.files.tree.rows.includes(filtered), false);
	f.panel.toggleFilterMode();
	assert.equal(f.panel.files.selectedNode, null); assert.ok(f.panel.files.tree.rows.includes(filtered));
});

test('a warmed project panel refresh does no catalog scanning, semantic snapshotting or text remeasurement', t => {
	const f = fixture(t), selected = f.definitions()[0];
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(selected)); f.panel.refresh();
	const rows = f.panel.files.tree.rows, revision = f.panel.files.revision;
	const slots = rows.map((_, index) => f.panel.getItemMetrics(index));
	const project = getOrCreateSemanticProject(editorTextModelService, f.resource.contextId);
	const snapshot = t.mock.method(project, 'getSnapshot');
	const resources = t.mock.method(f.sources.catalog.resourceByIdentity, Symbol.iterator);
	const iterate = f.sources.catalog.luaResources[Symbol.iterator], luaResources = t.mock.fn(iterate);
	f.sources.catalog.luaResources[Symbol.iterator] = luaResources;
	t.after(() => { f.sources.catalog.luaResources[Symbol.iterator] = iterate; });
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) { f.panel.refresh(); f.panel.prepareLayout(); }
	assert.equal(snapshot.mock.callCount(), 0); assert.equal(resources.mock.callCount(), 0); assert.equal(luaResources.mock.callCount(), 0);
	assert.equal(advance.mock.callCount(), 0); assert.equal(f.panel.files.tree.rows, rows);
	assert.equal(f.panel.files.revision, revision); assert.equal(f.panel.files.selectedNode, selected);
	for (let index = 0; index < slots.length; index++) assert.equal(f.panel.getItemMetrics(index), slots[index]);
});

test('file activation still opens Source or the registered YAML Map rather than an authored child', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t);
	t.after(async () => { clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const navigation = f.editor.navigation, original = navigation.openResource.bind(navigation);
	let pending: ReturnType<typeof navigation.openResource> | undefined;
	t.mock.method(navigation, 'openResource', (...args: Parameters<typeof navigation.openResource>) => {
		pending = original(...args); return pending;
	});
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(f.file));
	f.panel.openSelected(); await pending; f.update();
	const source = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(source instanceof CodeEditorInput); assert.equal(source.workingCopy.resource, f.resource);
	assert.equal(source.workingCopy.buffer.getText(), ALL_CONTENT_SOURCE);
	const identity = { contextId: f.sources.systemContextId, path: 'res/data/castle_map.yaml' };
	const yaml = '# authored map\n1: { map: [".."], objects: [] }\n';
	f.sources.catalog.registerTextSources(identity.contextId, [{ type: 'data', resid: 'map', source_path: identity.path, sourcemeta: { text: yaml } }]);
	f.panel.toggleFilterMode(); f.panel.queuePendingSelection(identity); f.panel.applyPendingSelection();
	f.panel.openSelected(); await pending; f.update();
	const map = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(map instanceof CartMapInput); assert.equal(map.mapKind, 'pietious');
	assert.equal(map.workingCopy, editorTextModelService.get(identity));
	assert.equal(map.workingCopy.buffer.getText(), yaml);
	map.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# unsaved\n' }]);
	f.panel.openSelected(); await pending; f.update();
	assert.equal(f.editor.editorParts.activeGroup.model.activeTab, map);
	assert.equal(map.workingCopy.buffer.getText(), '# unsaved\n' + yaml);
	assert.equal(map.workingCopy.dirty, true);
	assert.equal(resourceIdentityKey(map.workingCopy.resource), resourceIdentityKey(identity));
});
