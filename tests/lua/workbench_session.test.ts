import { semanticSnapshot } from './semantic_test_harness';
import { resolveResourceViewerInput } from '../../ide/workbench/contrib/resources/view_tabs';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import './test_setup';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { resolveRuntimeResource } from '../../ide/runtime/sources';
import { resolveWorkspacePath } from '../../ide/workspace/path';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { createTestRuntimeSourceState, createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { clearCodeEditorInputs, resolveCodeEditorInput, retainModelCodeTabContext } from '../../ide/workbench/ui/code_tab/contexts';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import type { EditorInputSerializers } from '../../ide/workbench/services/editor/editor_serialization';
import { CodeEditorInputSerializer } from '../../ide/workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from '../../ide/workbench/contrib/behavior_lens/editor_serializer';
import { SceneEditorInputSerializer } from '../../ide/workbench/contrib/scene_editor/editor_serializer';
import { ResourceViewerInputSerializer } from '../../ide/workbench/contrib/resources/editor_serializer';
import { BehaviorLensController } from '../../ide/workbench/contrib/behavior_lens/controller';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { buildResourceViewerContent } from '../../ide/workbench/contrib/resources/viewer';
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
import { ScenarioRunService } from '../../ide/workbench/contrib/scenario_lab/run_service';
import { ScenarioTestCollection } from '../../ide/testing/scenario/test_collection';
import { captureScenarioLabTestView } from '../../ide/workbench/contrib/scenario_lab/view_snapshot';
import { updateSelectedScenarioNode } from '../../ide/workbench/contrib/scenario_lab/projection';

const SOURCE = BT_TRANSFER_SOURCE + SCENE_VIEWPORT_SOURCE;

function registry(root: string, text: string): LuaSourceRegistry {
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'definitions.lua', projectRootPath: root, can_boot_from_source: false, revision: 0 };
	for (const [path, src] of [['definitions.lua', text], ['tests/first_assert.lua', '-- test one'], ['tests/second_assert.lua', '-- test two']]) {
		registerLuaSourceRecord(registry, { resid: path === 'definitions.lua' ? path : scenarioTestAssetId(path), type: 'lua', src, base_src: src, base_update_timestamp: 0, update_timestamp: 0,
			source_path: path, normalized_source_path: resolveWorkspacePath(path, root), module_path: toLuaModulePath(path), generated: false, program_module: path === 'definitions.lua' });
	}
	return registry;
}

function fixture(t: TestContext) {
	Object.assign(editorViewState, { font: new EditorFont('tiny'), lineHeight: 6, viewportWidth: 384, viewportHeight: 288, codeAreaTop: 24, codeAreaBottom: 120 });
	const sources = createTestRuntimeSourceState(registry('system', '-- system'), [registry('game', SOURCE), registry('extension', '-- second slot')], 0);
	const panes = createTestEditorPanes();
	const behavior = new BehaviorLensController(sources, null, panes, null, null, () => assert.fail('metadata must not start an FSM layout worker'));
	const scene = new SceneEditorController(sources, panes, null);
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const runs = new ScenarioRunService(runtime, sources, null, null, null, null, null, null, null);
	const scenario = new ScenarioLabController(null, sources, null, panes, null, new ScenarioTestCollection(sources), runs, null, null, null, null);
	const serializers: EditorInputSerializers = {
		code_editor: new CodeEditorInputSerializer(null, sources),
		behavior_lens: new BehaviorLensInputSerializer(null, sources, behavior),
		scene_editor: new SceneEditorInputSerializer(null, sources, scene),
		resource_view: new ResourceViewerInputSerializer(sources),
		scenario_lab: new ScenarioLabInputSerializer(scenario),
	};
	const unsubscribe = editorTextModelService.onDidChangeContent((model, event) => {
		behavior.onDidChangeContent(model, event); scene.onDidChangeContent(model, event);
	});
	t.after(() => { panes.dispose(); scenario.dispose(); unsubscribe(); editorTabGroup.clear(); clearCodeEditorInputs(); editorTextModelService.clear(); resetSemanticProjects(); workspaceDirtyRecords.clear(); });
	const resource = resolveRuntimeResource(sources, { domain: 0, path: 'definitions.lua' })!;
	const model = editorTextModelService.retain(resource, 'lua', SOURCE);
	return { sources, panes, behavior, scene, scenario, serializers, model, runtime };
}

test('group round-trip restores ordered clean/dirty views, preview and distinct definitions sharing one hydrated model', async t => {
	const f = fixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty 🐉\r\n' }]);
	const code = resolveCodeEditorInput(retainModelCodeTabContext(f.model));
	code.context.view.cursorRow = 2; code.context.view.cursorColumn = 8;
	code.context.view.selectionAnchor = { row: 1, column: 3 }; code.context.view.scrollRow = 1;
	editorTabGroup.initialize(code);
	const lenses = [0, 1].map(index => {
		const input = f.behavior.createInput(f.model, 'graph');
		selectBehaviorLensDefinition(input.view, input.view.document.definitions[index].rowKey);
		input.updateLabel(); prepareBehaviorLensLayout(input.view);
		assert.ok(input.view.presentation.kind === 'graph');
		input.view.presentation.position = { scrollX: 37 + index, scrollY: 25 + index, zoom: 0.75 };
		editorTabGroup.add(input); return input;
	});
	const scene = new SceneEditorInput(f.model); f.scene.refresh(scene); selectSceneOutlineRow(scene, 1);
	scene.position = { outlineScroll: 1, detailsScroll: 17 }; editorTabGroup.add(scene);
	const cleanResource = resolveRuntimeResource(f.sources, { domain: 1, path: 'definitions.lua' })!;
	const cleanModel = editorTextModelService.retain(cleanResource, 'lua', '-- second slot');
	const clean = resolveCodeEditorInput(retainModelCodeTabContext(cleanModel)); editorTabGroup.add(clean, { pinned: false });
	editorTabGroup.activate(lenses[1]);
	const before = editorTabGroup.serialize(f.serializers);
	assert.equal(editorTabGroup.serialize(f.serializers, before), before, 'unchanged checkpoint reuses immutable group');
	const dirtySource = f.model.buffer.getText();
	workspaceDirtyRecords.set(buildWorkspaceDirtyEntryPath('game', 0, 'definitions.lua'), { contents: dirtySource, updatedAt: 50 });
	const generation = JSON.parse(JSON.stringify({ dirtyFiles: [{ domain: 0, path: 'definitions.lua', updatedAt: 50 }], editorGroup: before, fontVariant: 'tiny', breakpoints: [] }));
	await applyWorkspaceAutosavePayload({ editorPanes: f.panes, editorInputSerializers: f.serializers, setFontVariant() {} },
		f.sources, { breakpoints: [new Map(), new Map(), new Map()] }, generation, null);
	const after = editorTabGroup.serialize(f.serializers);
	assert.deepEqual(after, before);
	assert.deepEqual(editorTabGroup.tabs.map(input => input.kind), ['code_editor', 'behavior_lens', 'behavior_lens', 'scene_editor', 'code_editor']);
	const [newCode, first, second, newScene, newClean] = editorTabGroup.tabs;
	assert.ok(newCode.kind === 'code_editor' && first.kind === 'behavior_lens' && second.kind === 'behavior_lens' && newScene.kind === 'scene_editor' && newClean.kind === 'code_editor');
	assert.equal(editorTabGroup.activeTab, second); assert.equal(editorTabGroup.previewTab, newClean);
	assert.notEqual(first.id, second.id); assert.notEqual(first.id, lenses[0].id);
	assert.notEqual(first.workingCopy, f.model);
	assert.equal(first.workingCopy, newCode.workingCopy); assert.equal(first.workingCopy, second.workingCopy); assert.equal(first.workingCopy, newScene.workingCopy);
	assert.equal(first.workingCopy.buffer.getText(), dirtySource); assert.equal(first.workingCopy.dirty, true);
	assert.equal(first.workingCopy.canUndo, false, 'source backup is not an Undo journal');
	assert.equal(newClean.workingCopy.dirty, false); assert.equal([...editorTextModelService.models].length, 2);
	prepareBehaviorLensLayout(second.view);
	assert.ok(second.view.presentation.kind === 'graph');
	assert.equal(second.view.presentation.viewport.scrollX, 38); assert.equal(second.view.presentation.viewport.zoom, 0.75);
});

test('changed canonical bytes retain topology but cannot adopt a same-length namesake source occurrence', async t => {
	const f = fixture(t);
	const input = f.behavior.createInput(f.model, 'graph');
	selectBehaviorLensDefinition(input.view, input.view.document.definitions[1].rowKey); input.updateLabel();
	editorTabGroup.initialize(input);
	const value = editorTabGroup.serialize(f.serializers);
	const record = f.sources.cartridgeSlots[0]!.luaSources.records[0];
	record.src = record.base_src = SOURCE.replaceAll('fixture.second', 'another.second');
	f.sources.cartridgeSlots[0]!.luaSources.revision += 1;
	f.panes.clearEditor(); editorTabGroup.clear(); clearCodeEditorInputs(); editorTextModelService.clear(); resetSemanticProjects();
	await editorTabGroup.deserialize(value, f.serializers);
	const restored = editorTabGroup.activeTab;
	assert.ok(restored?.kind === 'behavior_lens');
	assert.equal(restored.view.definitionRowKey, null); assert.equal(restored.view.selection, null);
	assert.equal(restored.workingCopy.dirty, false); assert.equal(editorTabGroup.tabs.length, 1);
	assert.ok(!restored.title.includes('removed'), 'a fresh unresolved view never claimed to select the old definition');
});

for (const changeProvider of [false, true]) test(`behavior mementos fingerprint every source resource (provider changed: ${changeProvider})`, async t => {
	const f = fixture(t);
	const dependencyResource = resolveRuntimeResource(f.sources, { domain: 0, path: 'tests/first_assert.lua' })!;
	const provider = editorTextModelService.retain(dependencyResource, 'lua', '-- test one');
	const document = buildBehaviorSourceDocument(f.model.identity, semanticSnapshot(buildLuaFileSemanticData(SOURCE, f.model.resource.path)));
	// Exercise the serializer's read-many contract independently of recognizer coverage.
	const dependency = buildLuaFileSemanticData(provider.buffer.getText(), provider.resource.path);
	const files = [...document.files, { file: dependency.file, revision: dependency.revision }];
	const view = createBehaviorLensViewState({ ...document, files }, f.model, 'graph', path => {
		assert.equal(path, provider.resource.path); return provider;
	});
	const input = new BehaviorLensInput(f.model, view, assert.fail);
	selectBehaviorLensDefinition(view, document.definitions[1].rowKey);
	editorTabGroup.initialize(input);
	const serialized = f.serializers.behavior_lens.serialize(input);
	const state = JSON.parse(serialized);
	assert.equal(state.dependencies.length, 1);
	assert.deepEqual(state.dependencies[0].resource, provider.identity);
	assert.deepEqual(Object.keys(state.view.definition.path[0].resource).sort(), ['domain', 'path']);
	if (changeProvider) {
		const record = f.sources.cartridgeSlots[0]!.luaSources.records.find(record => record.source_path === provider.resource.path)!;
		record.src = record.base_src = '-- test two';
		f.sources.cartridgeSlots[0]!.luaSources.revision += 1;
	}
	editorTabGroup.clear(); editorTextModelService.clear(); resetSemanticProjects();
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
	const input = resolveCodeEditorInput(retainModelCodeTabContext(model));
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
	const old = new SceneEditorInput(f.model); f.scene.refresh(old); selectSceneOutlineRow(old, 1); layoutSceneEditor(old, true);
	old.details.scrollbar.setScroll(17); old.outline.scroll = 1;
	const snapshot = JSON.parse(JSON.stringify(captureSceneEditorView(old)));
	const fresh = new SceneEditorInput(f.model); f.scene.refresh(fresh); restoreSceneEditorView(fresh, snapshot);
	assert.deepEqual(captureSceneEditorView(fresh), snapshot, 'no hidden default geometry overwrites the pending memento');
	layoutSceneEditor(fresh, true);
	assert.equal(fresh.position, undefined); assert.equal(fresh.details.scrollTop, old.details.scrollTop);
	assert.equal(fresh.outline.selectionIndex, 1); assert.deepEqual(fresh.properties.map(p => p.value), [11, -22, 33]);
	assert.equal(f.model.dirty, false); old.dispose(); fresh.dispose();
});

test('resource viewer restoration uses the resource socket, not the active cart package', t => {
	const f = fixture(t);
	const resource = { domain: 1 as const, path: 'values.data', source: { resid: 'values', type: 'data' as const } };
	f.sources.resourceByIdentity.set('1\0values.data', resource);
	f.sources.cartridgeSlots[0]!.package.data.values = { owner: 'game' };
	f.sources.cartridgeSlots[1]!.package.data.values = { owner: 'extension' };
	const input = new ResourceViewerInput(buildResourceViewerContent(f.sources, resource)); input.view.scroll = 3;
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
	const next = new ScenarioLabController(null, f.sources, null, f.panes, null, new ScenarioTestCollection(f.sources),
		new ScenarioRunService(f.runtime, f.sources, null, null, null, null, null, null, null), null, null, null, null);
	const fresh = new ScenarioLabInputSerializer(next).deserialize(value);
	assert.deepEqual(captureScenarioLabTestView(fresh.view), captureScenarioLabTestView(input.view));
	assert.equal(fresh.view.runActive, false); assert.equal(fresh.view.focus, 'tests'); assert.equal(fresh.view.resultPane.rows.length, 0);
	input.dispose(); fresh.dispose(); next.dispose();
});

test('a persisted behavior snapshot is immutable across later model edits', t => {
	const f = fixture(t);
	const input = f.behavior.createInput(f.model, 'graph');
	selectBehaviorLensDefinition(input.view, input.view.document.definitions[1].rowKey); editorTabGroup.initialize(input);
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
	const resource = { domain: 1 as const, path: 'refresh.data', source: { resid: 'refresh', type: 'data' as const } };
	const data = f.sources.cartridgeSlots[1]!.package.data;
	data.refresh = { revision: 'before' };
	const input = resolveResourceViewerInput(f.sources, resource);
	editorTabGroup.initialize(input);
	const view = input.view, content = view.content;
	view.scroll = 3;
	const revision = editorTabGroup.revision;
	data.refresh = { revision: 'after' };
	const reopened = resolveResourceViewerInput(f.sources, resource);
	assert.equal(reopened, input);
	assert.equal(reopened.view, view, 'content resolution cannot replace view state');
	assert.equal(view.scroll, 3, 'no resetting then restoring the cursor at a callsite');
	assert.notEqual(view.content, content, 'resolution still refreshes content');
	assert.match(view.content.lines.join('\n'), /after/);
	assert.doesNotMatch(view.content.lines.join('\n'), /before/);
	assert.equal(editorTabGroup.revision, revision, 'unchanged labels and membership emit no group change');
	assert.equal(input.toResourceEditor().resource, resource);
});
