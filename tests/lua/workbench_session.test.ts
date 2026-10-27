import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { resourceIdentityKey } from '../../ide/common/resource';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import { RuntimeBreakpoints } from '../../ide/runtime/breakpoints';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import './test_setup';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { resolveWorkspacePath } from '../../ide/workspace/path';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { createTestRuntimeSourceState, createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { EditorInputSerializers } from '../../ide/workbench/services/editor/editor_serialization';
import { CodeEditorInputSerializer } from '../../ide/workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from '../../ide/workbench/contrib/behavior_lens/editor_serializer';
import { SceneEditorInputSerializer } from '../../ide/workbench/contrib/scene_editor/editor_serializer';
import { ResourceViewerInputSerializer } from '../../ide/workbench/contrib/resources/editor_serializer';
import { BehaviorLensController } from '../../ide/workbench/contrib/behavior_lens/controller';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { selectBehaviorLensDefinition, prepareBehaviorLensLayout } from '../../ide/workbench/contrib/behavior_lens/layout';
import { captureBehaviorLensView, restoreBehaviorLensView } from '../../ide/workbench/contrib/behavior_lens/view_snapshot';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { captureSceneEditorView, restoreSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { layoutSceneEditor } from '../../ide/workbench/contrib/scene_editor/layout';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import { buildWorkspaceDirtyEntryPath } from '../../ide/workspace/files';
import { getTextSnapshotFingerprint } from '../../ide/editor/text/source_text';
import { captureTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { BT_TRANSFER_SOURCE } from '../helpers/behavior_transfer_fixture';
import { ScenarioLabInputSerializer } from '../../ide/workbench/contrib/scenario_lab/editor_serializer';
import { ScenarioLabController } from '../../ide/workbench/contrib/scenario_lab/controller';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { captureScenarioLabTestView } from '../../ide/workbench/contrib/scenario_lab/view_snapshot';
import { updateSelectedScenarioNode } from '../../ide/workbench/contrib/scenario_lab/projection';

const SOURCE = BT_TRANSFER_SOURCE + SCENE_VIEWPORT_SOURCE;

function registry(root: string, text: string): LuaSourceRegistry {
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'definitions.lua', projectRootPath: root, can_boot_from_source: false, revision: 0 };
	for (const [path, src] of [['definitions.lua', text], ['tests/first_assert.lua', '-- test one'], ['tests/second_assert.lua', '-- test two']]) {
		registerLuaSourceRecord(registry, { resid: path === 'definitions.lua' ? path : scenarioTestAssetId(path), type: 'lua', src, base_src: src, base_update_timestamp: 0, update_timestamp: 0,
			source_path: path, normalized_source_path: resolveWorkspacePath(path, root), module_path: toLuaModulePath(path), generated: false, sourceKind: path === 'definitions.lua' ? 'project' : 'source-only', program_module: path === 'definitions.lua' });
	}
	return registry;
}

function fixture(t: TestContext) {
	Object.assign(editorViewState, { font: new EditorFont('tiny'), lineHeight: 6, viewportWidth: 384, viewportHeight: 288, editorAreaTop: 24, editorAreaBottom: 120 });
	const system = registry('system', '-- system');
	for (const module of ['cartlib/behaviour_tree/library', 'cartlib/world/scene_library']) {
		registerLuaSourceRecord(system, createScenarioTestSourceRecord(`${module}.lua`, 0, '', `system/${module}.lua`));
	}
	const sources = createTestRuntimeSourceState(system, [registry('game', SOURCE), registry('extension', '-- second slot')], 0);
	const group = createTestEditorGroup();
	const behavior = new BehaviorLensController(sources, null, null, new BehaviorSourceDocuments(editorTextModelService, sources.catalog), () => assert.fail('metadata must not start an FSM layout worker'), null, null);
	const scene = new SceneEditorController(sources.catalog, null);
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const runs = new ScenarioRunService(editorTextModelService, sources, new Map(), runtime.model, () => assert.fail('session recovery must not create test machines'));
	const scenario = new ScenarioLabController(null, null, group, null, runs, null);
	const unused = { serialize: () => assert.fail('unexpected serialization'), deserialize: () => assert.fail('unexpected reconstruction') };
	const serializers: EditorInputSerializers = {
		home: unused,
		animation: unused,
		aem_editor: unused, cart_map: unused, lua_program: unused, actor_lab: unused, game_view: unused,
		event_viewer: { serialize: () => '', deserialize: () => { throw new Error('Events not used by this session fixture'); } },
		terminal: { serialize: () => '', deserialize: () => { throw new Error('Terminal not used in this source-session fixture'); } },
		code_editor: new CodeEditorInputSerializer(sources.catalog),
		behavior_lens: new BehaviorLensInputSerializer(sources.catalog, behavior),
		scene_editor: new SceneEditorInputSerializer(sources.catalog, scene),
		resource_view: new ResourceViewerInputSerializer(sources.catalog),
		scenario_lab: new ScenarioLabInputSerializer(scenario),
	};
	t.after(() => { group.dispose(); scenario.dispose(); runs.dispose(); editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); workspaceDirtyRecords.clear(); });
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definitions.lua' })!;
	const model = editorTextModelService.retain(resource, 'lua', SOURCE);
	return { sources, group, behavior, scene, scenario, serializers, model, runtime };
}

test('group round-trip restores ordered clean/dirty views, preview and distinct definitions sharing one hydrated model', async t => {
	const f = fixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty 🐉\r\n' }]);
	const code = new CodeEditorInput(f.model);
	code.context.view.cursorRow = 2; code.context.view.cursorColumn = 8;
	code.context.view.selectionAnchor = { row: 1, column: 3 }; code.context.view.scrollRow = 1; code.context.view.scrollLeft = 17.25;
	f.group.model.initialize(code);
	const lenses = [0, 1].map(index => {
		const input = f.behavior.createInput(f.model, 'graph');
		selectBehaviorLensDefinition(input.view, input.view.document.definitions[index].rowKey);
		input.updateDefinition(); prepareBehaviorLensLayout(input.view, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(input.view.presentation.kind === 'graph');
		input.view.presentation.position = { scrollX: 37 + index, scrollY: 25 + index, zoom: 0.75 };
		f.group.model.add(input); return input;
	});
	const scene = new SceneEditorInput(f.model); f.scene.refresh(scene); selectSceneOutlineRow(scene, 1);
	scene.position = { outlineScroll: 1, detailsScroll: 17 }; f.group.model.add(scene);
	const cleanResource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'definitions.lua' })!;
	const cleanModel = editorTextModelService.retain(cleanResource, 'lua', '-- second slot');
	const clean = new CodeEditorInput(cleanModel); f.group.model.add(clean, { pinned: false });
	f.group.model.activate(lenses[1]);
	const before = f.group.model.serialize(f.serializers);
	assert.equal(f.group.model.serialize(f.serializers, before), before, 'unchanged checkpoint reuses immutable group');
	const dirtySource = f.model.buffer.getText();
	workspaceDirtyRecords.set(buildWorkspaceDirtyEntryPath('game', TEST_CARTRIDGE_CONTEXT_IDS[0], 'definitions.lua'), { contents: dirtySource, updatedAt: 50 });
	const generation = JSON.parse(JSON.stringify({ dirtyFiles: [{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definitions.lua', updatedAt: 50 }], editorGroup: before, fontVariant: 'tiny', breakpoints: [] }));
	await applyWorkspaceAutosavePayload({ editorGroup: f.group, editorInputSerializers: f.serializers, setFontVariant() {} },
		f.sources.catalog, { breakpoints: new RuntimeBreakpoints(f.sources, () => {}) }, generation);
	const after = f.group.model.serialize(f.serializers);
	assert.deepEqual(after, before);
	assert.deepEqual(f.group.model.tabs.map(input => input.kind), ['code_editor', 'behavior_lens', 'behavior_lens', 'scene_editor', 'code_editor']);
	const [newCode, first, second, newScene, newClean] = f.group.model.tabs;
	assert.ok(newCode.kind === 'code_editor' && first.kind === 'behavior_lens' && second.kind === 'behavior_lens' && newScene.kind === 'scene_editor' && newClean.kind === 'code_editor');
	assert.equal(f.group.model.activeTab, second); assert.equal(f.group.model.previewTab, newClean);
	assert.equal(newCode.context.view.scrollLeft, 17.25, 'workspace recovery preserves the code view pixel origin without glyph conversion');
	assert.notEqual(first.id, second.id); assert.notEqual(first.id, lenses[0].id);
	assert.notEqual(first.workingCopy, f.model);
	assert.equal(first.workingCopy, newCode.workingCopy); assert.equal(first.workingCopy, second.workingCopy); assert.equal(first.workingCopy, newScene.workingCopy);
	assert.equal(first.workingCopy.buffer.getText(), dirtySource); assert.equal(first.workingCopy.dirty, true);
	assert.equal(first.workingCopy.canUndo, false, 'source backup is not an Undo journal');
	assert.equal(newClean.workingCopy.dirty, false); assert.equal([...editorTextModelService.models].length, 2);
	prepareBehaviorLensLayout(second.view, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
	assert.ok(second.view.presentation.kind === 'graph');
	assert.equal(second.view.presentation.viewport.scrollX, 38); assert.equal(second.view.presentation.viewport.zoom, 0.75);
});

test('changed canonical bytes retain topology but cannot adopt a same-length namesake source occurrence', async t => {
	const f = fixture(t);
	const input = f.behavior.createInput(f.model, 'graph');
	selectBehaviorLensDefinition(input.view, input.view.document.definitions[1].rowKey); input.updateDefinition();
	f.group.model.initialize(input);
	const value = f.group.model.serialize(f.serializers);
	const record = f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources.records[0];
	record.src = record.base_src = SOURCE.replaceAll('fixture.second', 'another.second');
	f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources.revision += 1;
	f.group.panes.clearEditor(); f.group.model.clear(); editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	await f.group.model.deserialize(value, f.serializers);
	const restored = f.group.model.activeTab;
	assert.ok(restored?.kind === 'behavior_lens');
	assert.equal(restored.view.definitionRowKey, null); assert.equal(restored.view.selection, null);
	assert.equal(restored.workingCopy.dirty, false); assert.equal(f.group.model.tabs.length, 1);
});

for (const changeProvider of [false, true]) test(`behavior mementos fingerprint every source resource (provider changed: ${changeProvider})`, async t => {
	const f = fixture(t);
	const dependencyResource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'tests/first_assert.lua' })!;
	const provider = editorTextModelService.retain(dependencyResource, 'lua', '-- test one');
	const document = buildBehaviorSourceDocument(f.model.identity, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(SOURCE, f.model.resource)], ['cartlib/behaviour_tree/library', 'cartlib/world/scene_library'])));
	// Exercise the serializer's read-many contract independently of recognizer coverage.
	const dependency = buildResourceLuaSemanticFixtureFile(provider.buffer.getText(), provider.resource);
	const files = [...document.files, { file: dependency.file, revision: dependency.revision }];
	const view = createBehaviorLensViewState({ ...document, files }, f.model, 'graph', path => {
		assert.equal(path, resourceIdentityKey(provider.resource)); return provider;
	});
	const input = new BehaviorLensInput(f.model, view, new Set(f.sources.catalog.getSourceContexts(f.model.identity.contextId).map(context => context.id)), assert.fail);
	selectBehaviorLensDefinition(view, document.definitions[1].rowKey);
	f.group.model.initialize(input);
	const serialized = f.serializers.behavior_lens.serialize(input);
	const state = JSON.parse(serialized);
	assert.equal(state.dependencies.length, 1);
	assert.deepEqual(state.dependencies[0].resource, provider.identity);
	assert.deepEqual(Object.keys(state.view.definition.path[0].resource).sort(), ['contextId', 'path']);
	if (changeProvider) {
		const record = f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources.records.find(record => record.source_path === provider.resource.path)!;
		record.src = record.base_src = '-- test two';
		f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources.revision += 1;
	}
	f.group.model.clear(); editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	const restored = await f.serializers.behavior_lens.deserialize(serialized);
	t.after(() => restored.dispose());
	assert.equal(restored.workingCopy.buffer.getText(), SOURCE);
	assert.equal(restored.workingCopy.dirty, false);
	if (changeProvider) {
		assert.equal(restored.view.definitionRowKey, null);
		assert.equal(restored.view.selection, null, 'equal primary bytes cannot authenticate a foreign source bookmark');
	} else assert.equal(restored.view.definitionRowKey, document.definitions[1].rowKey);
	assert.equal(editorTextModelService.get(provider.identity)!.buffer.getText(), changeProvider ? '-- test two' : '-- test one');
});

test('source fingerprint is retained by buffer version and shared by views, not recomputed on cursor movement', t => {
	const { model } = fixture(t);
	const first = getTextSnapshotFingerprint(model.buffer);
	const input = new CodeEditorInput(model);
	const getText = t.mock.method(model.buffer, 'getText', () => assert.fail('stable snapshot reread source'));
	for (let index = 0; index < 1000; index += 1) {
		input.context.view.cursorColumn = index % 20;
		captureCodeEditorView(input);
		assert.equal(captureTextFileModel(model).fingerprint, first);
	}
	getText.mock.restore();
	model.pushEditOperations([{ offset: 0, deleteLength: 1, text: 'L' }]);
	const changed = getTextSnapshotFingerprint(model.buffer);
	assert.notEqual(changed, first); assert.equal(changed.length, first.length); assert.notEqual(changed.hash, first.hash);
	input.dispose();
});

test('scene memento survives first layout and retains pending coordinates before its pane is attached', t => {
	const f = fixture(t);
	const old = new SceneEditorInput(f.model); f.scene.refresh(old); selectSceneOutlineRow(old, 1); layoutSceneEditor(old, true, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
	old.details.scrollbar.setScroll(17); old.outline.scroll = 1;
	const snapshot = JSON.parse(JSON.stringify(captureSceneEditorView(old)));
	const fresh = new SceneEditorInput(f.model); f.scene.refresh(fresh); restoreSceneEditorView(fresh, snapshot);
	assert.deepEqual(captureSceneEditorView(fresh), snapshot, 'no hidden default geometry overwrites the pending memento');
	layoutSceneEditor(fresh, true, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
	assert.equal(fresh.position, undefined); assert.equal(fresh.details.scrollTop, old.details.scrollTop);
	assert.equal(fresh.outline.selectionIndex, 1); assert.deepEqual(fresh.properties.map(p => p.value), [11, -22, 33]);
	assert.equal(f.model.dirty, false); old.dispose(); fresh.dispose();
});

test('resource viewer restoration uses its admitted source context, not the active cart package', t => {
	const f = fixture(t);
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'values.data', location: { kind: 'workspace' as const, path: 'values.data' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'values.data', source: { resid: 'values', type: 'data' as const } };
	f.sources.catalog.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).previewPackage.data.values = { owner: 'game' };
	f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[1]).previewPackage.data.values = { owner: 'extension' };
	const input = new ResourceViewerInput(f.sources.catalog, resource); input.view.scroll = 3;
	const restored = f.serializers.resource_view.deserialize(f.serializers.resource_view.serialize(input));
	assert.ok(restored instanceof ResourceViewerInput);
	assert.equal(restored.view.content.resource, resource); assert.equal(restored.view.scroll, 3);
	assert.match(restored.view.content.lines.join('\n'), /extension/); assert.doesNotMatch(restored.view.content.lines.join('\n'), /game/);
	input.dispose(); restored.dispose();
});

test('Scenario Lab persists only test identity and scope expansion, not run/result execution', t => {
	const f = fixture(t);
	const input = f.scenario.resolveInput();
	input.view.testPane.selectionIndex = 2; updateSelectedScenarioNode(input.view);
	input.view.testPane.scroll = 1; input.view.runActive = true;
	input.view.focus = 'results'; input.view.resultPane.expandedResultIds.add('run:previous');
	const value = f.serializers.scenario_lab.serialize(input);
	assert.deepEqual(JSON.parse(value), captureScenarioLabTestView(input.view));
	assert.doesNotMatch(value, /results|runActive|focus|previous/);
	const runs = new ScenarioRunService(editorTextModelService, f.sources, new Map(), f.runtime.model, () => assert.fail('session recovery must not create test machines'));
	const next = new ScenarioLabController(null, null, f.group, null, runs, null);
	const fresh = new ScenarioLabInputSerializer(next).deserialize(value);
	assert.deepEqual(captureScenarioLabTestView(fresh.view), captureScenarioLabTestView(input.view));
	assert.equal(fresh.view.runActive, false); assert.equal(fresh.view.focus, 'tests'); assert.equal(fresh.view.resultPane.rows.length, 0);
	input.dispose(); fresh.dispose(); next.dispose(); runs.dispose();
});

test('a persisted behavior snapshot is immutable across later model edits', t => {
	const f = fixture(t);
	const input = f.behavior.createInput(f.model, 'graph');
	selectBehaviorLensDefinition(input.view, input.view.document.definitions[1].rowKey); f.group.model.initialize(input);
	const captured = captureBehaviorLensView(input); const json = JSON.stringify(captured);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]);
	assert.equal(JSON.stringify(captured), json);
	const now = captureBehaviorLensView(input);
	assert.notEqual(now.definition!.path[0].start, captured.definition!.path[0].start);
	f.behavior.updateView(input);
	restoreBehaviorLensView(input, now);
	assert.equal(input.view.definitionRowKey, input.view.document.definitions[1].rowKey);
});

test('resource refresh replaces content, not the retained viewport or group membership', t => {
	const f = fixture(t);
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'refresh.data', location: { kind: 'workspace' as const, path: 'refresh.data' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'refresh.data', source: { resid: 'refresh', type: 'data' as const } };
	const data = f.sources.cartridgeSlots[1]!.package.data;
	data.refresh = { revision: 'before' };
	const input = new ResourceViewerInput(f.sources.catalog, resource);
	f.group.openEditor(input);
	const view = input.view, content = view.content;
	view.scroll = 3;
	data.refresh = { revision: 'after' };
	f.group.openEditor(new ResourceViewerInput(f.sources.catalog, resource));
	const reopened = f.group.model.activeTab!;
	assert.ok(reopened.kind === 'resource_view');
	assert.equal(reopened, input);
	assert.equal(reopened.view, view, 'content resolution cannot replace view state');
	assert.equal(view.scroll, 3, 'no resetting then restoring the cursor at a callsite');
	assert.notEqual(view.content, content, 'resolution still refreshes content');
	assert.match(view.content.lines.join('\n'), /after/);
	assert.doesNotMatch(view.content.lines.join('\n'), /before/);
	assert.equal(f.group.model.tabs.length, 1, 'refreshing the admitted resource cannot add another group member');
	assert.equal(input.toResourceEditor().resource, resource);
});
