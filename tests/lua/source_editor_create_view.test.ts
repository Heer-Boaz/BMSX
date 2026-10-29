import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects, getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { HostRewind } from '../../hosts/common/rewind';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { captureSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { LuaProgramController } from '../../ide/workbench/contrib/lua_program/controller';
import { collectLuaPrograms } from '../../ide/workbench/contrib/lua_program/source';
import { BehaviorLensController } from '../../ide/workbench/contrib/behavior_lens/controller';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { captureBehaviorLensView } from '../../ide/workbench/contrib/behavior_lens/view_snapshot';
import { BehaviorRuntimeInspection } from '../../ide/workbench/contrib/behavior_lens/runtime_inspection';
import { captureWorkbenchTreeView } from '../../ide/workbench/ui/tree_view';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createTestRuntime, createTestRuntimeRomPayload, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

beforeEach(() => configureFontVariant('tiny'));
afterEach(() => {
	inputFocus.setTarget(null);
	editorTextModelService.clear();
	resetSemanticProjects(editorTextModelService);
});

test('Scene fresh views preserve the selected source occurrence while retaining independent presentation and construction', t => {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scene.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const controller = new SceneEditorController(sources.catalog, new SceneSourceDocuments(editorTextModelService, sources.catalog));
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	controller.openResource(group, resource);
	const source = group.model.activeTab;
	assert.ok(source instanceof SceneEditorInput);
	source.view.refresh(); selectSceneOutlineRow(source.view.hierarchy, 1);
	source.view.section = 'details'; source.view.hierarchy.position = 2; source.view.details.position = 7;
	const before = captureSceneEditorView(source.view), input = source.createView!();
	t.after(() => input.dispose());
	assert.ok(input !== source && input.workingCopy === source.workingCopy);
	assert.deepEqual(captureSceneEditorView(input.view), before, 'the selected member and reading position, not a namesake/default scene, are copied');
	assert.ok(input.view.hierarchy.outline !== source.view.hierarchy.outline && input.view.details !== source.view.details && input.view.authoring.selectionRange !== source.view.authoring.selectionRange);
	selectSceneOutlineRow(input.view.hierarchy, 0);
	assert.deepEqual(captureSceneEditorView(source.view), before, 'the new view cannot change its sibling selection');
	source.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared\n' }]);
	source.view.refresh(); input.view.refresh();
	assert.equal(input.isDirty(), true); assert.equal(source.isDirty(), true);
	const again = input.createView!(); t.after(() => again.dispose());
	assert.ok(again !== input && again.workingCopy === source.workingCopy, 'a fresh view retains the real contribution factory');
	assert.equal(source.workingCopy.buffer.getText(), `-- shared\n${SCENE_VIEWPORT_SOURCE}`);
});

test('Animation fresh views retain their exact imported subject and deep-copy source selections and numeric viewport', t => {
	const text = "return {duration_ms=100,tracks=require('tracks')}";
	const imported = "return {{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=1}}}}";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('animation.lua', 1, text), createScenarioTestSourceRecord('tracks.lua', 1, imported),
	]);
	const controller = new AnimationEditorController(sources.catalog), group = createTestEditorGroup();
	t.after(() => group.dispose());
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua' })!;
	const source = controller.openResource(group, resource);
	assert.ok(source !== undefined);
	controller.selectTrack(source, 1); controller.selectKey(source, 1); controller.selectProperty(source, 0);
	source.activeClient = 'keys'; source.keys.setView(20, 120); source.keys.setCursor(37); source.keys.snap = false;
	source.columnSplit.ratio = 0.4; source.rowSplit.ratio = 0.6; source.tracks.scroll = 3; source.details.scroll = 4;
	const selected = { track: structuredClone(source.trackSelection), key: structuredClone(source.keySelection), detail: structuredClone(source.detailSelection) };
	const input = source.createView!(); t.after(() => input.dispose());
	assert.ok(input !== source && input.workingCopy === source.workingCopy);
	assert.ok(input instanceof AnimationEditorInput);
	assert.deepEqual([...input.sourceModels.values()], [...source.sourceModels.values()], 'imported edit targets are the same canonical models');
	assert.deepEqual({ track: input.trackSelection, key: input.keySelection, detail: input.detailSelection }, selected);
	assert.ok(input.trackSelection!.range !== source.trackSelection!.range && input.keySelection!.range !== source.keySelection!.range);
	assert.ok(input.keys !== source.keys && input.framePreview !== source.framePreview && input.details !== source.details);
	assert.deepEqual([input.keys.range.minimum, input.keys.range.maximum, input.keys.cursor, input.keys.snap, input.activeClient,
		input.columnSplit.ratio, input.rowSplit.ratio, input.tracks.scroll, input.details.scroll], [20, 120, 37, false, 'keys', 0.4, 0.6, 3, 4]);
	controller.selectKey(input, 0); input.keys.setView(0, 10);
	assert.deepEqual(source.keySelection, selected.key); assert.equal(source.keys.range.minimum, 20);
	const model = source.sourceModels.get(resourceIdentityKey({ contextId: resource.contextId, path: 'tracks.lua' }))!;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared\n' }]);
	assert.deepEqual(input.trackSelection!.range, source.trackSelection!.range, 'each view maps its own selection exactly once');
	assert.equal(input.isDirty(), true); assert.equal(source.isDirty(), true);
	assert.equal(source.workingCopy.buffer.getText(), text);
});

test('Animation fresh views keep the selected definition and its consuming source instead of reopening the first animation', t => {
	const text = "local c=require('cartlib/component/sprite_animation_component'); c.factory({animations={first=require('first'),second=require('second')}})";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('consumer.lua', 1, text),
		createScenarioTestSourceRecord('first.lua', 1, 'return {duration_frames=1}'),
		createScenarioTestSourceRecord('second.lua', 1, 'return {duration_frames=2}'),
		createScenarioTestSourceRecord('cartlib/component/sprite_animation_component.lua', 1, ''),
	]);
	const controller = new AnimationEditorController(sources.catalog), group = createTestEditorGroup(); t.after(() => group.dispose());
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'consumer.lua' })!;
	const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId); project.synchronizeSources(sources.catalog);
	const definition = collectAnimationDefinitions(resource, project.getSnapshot()).find(candidate => candidate.file.file === resourceIdentityKey({ contextId: resource.contextId, path: 'second.lua' }))!;
	const source = controller.openDefinition(group, resource.contextId, definition);
	assert.ok(source !== undefined);
	const input = source.createView!(); t.after(() => input.dispose());
	assert.ok(input.workingCopy === source.workingCopy);
	assert.deepEqual(input.definitionRange, source.definitionRange); assert.ok(input.definitionRange !== source.definitionRange);
	assert.equal(input.consumerPath, resourceIdentityKey(resource)); assert.equal(input.document!.family, source.document!.family);
	assert.ok(input.sourceModels.get(input.consumerPath!) === source.sourceModels.get(source.consumerPath!));
	assert.equal(input.document!.durationFrames, 2, 'source occurrence, not display title or resource default, selects the new view subject');
	const offset = source.definitionRange!.start;
	source.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared\n' }]);
	assert.equal(input.definitionRange!.start, offset + 10); assert.equal(source.definitionRange!.start, offset + 10);
	assert.equal(source.workingCopy.buffer.getText(), '-- shared\nreturn {duration_frames=2}');
});

test('LuaProgram fresh views share authored imported working copies but never copy a live instance or execution authority', t => {
	const text = "local p=require('cartlib/progression'); p.compile_program(require('spec'))";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('program.lua', 1, text), createScenarioTestSourceRecord('spec.lua', 1, "return {rules={{id='kept',on='hit'}},filters={},handlers={}}"),
		createScenarioTestSourceRecord('cartlib/progression.lua', 1, ''),
	]);
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), guest = new SuspendedGuestSession(runtime);
	const transport = new RuntimeTransport(runtime, null!, null!, null!, () => true);
	const controller = new LuaProgramController(sources, guest, null!, transport), group = createTestEditorGroup();
	t.after(() => group.dispose());
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'program.lua' })!;
	const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId); project.synchronizeSources(sources.catalog);
	const occurrence = collectLuaPrograms(resource, project.getSnapshot())[0];
	const source = controller.openOccurrence(group, occurrence);
	assert.ok(source !== undefined);
	source.tree.selectionIndex = source.tree.rows.findIndex(row => row.element.path.join('/') === 'rules/1/on'); source.tree.scroll = 2;
	const before = captureWorkbenchTreeView(source.tree, element => element.key);
	source.inspectRuntime(transport); source.interaction.running = true;
	source.instance = { tag: ValueTag.Table, scalar: 17 }; source.runtimeDomain = 0;
	source.programHashId = 13; source.stateHashId = 19; source.stateRevision = 5;
	const cycles = runtime.machine.scheduler.nowCycles, input = source.createView!(); t.after(() => input.dispose());
	assert.ok(input !== source && input.workingCopy === source.workingCopy && input.tree !== source.tree);
	assert.deepEqual(input.occurrenceRange, source.occurrenceRange); assert.ok(input.occurrenceRange !== source.occurrenceRange);
	assert.deepEqual([...input.sourceModels.values()], [...source.sourceModels.values()]);
	assert.deepEqual(captureWorkbenchTreeView(input.tree, element => element.key), before);
	assert.equal(input.liveVisible, false); assert.equal(input.instance, undefined); assert.equal(input.runtimeDomain, undefined);
	assert.equal(input.runtimeImage, undefined); assert.equal(input.interaction.transport, null); assert.equal(input.interaction.running, false);
	assert.deepEqual([input.programHashId, input.stateHashId, input.stateRevision, input.live.rows.length], [0, 0, -1, 0]);
	assert.equal(source.liveVisible, true); assert.equal(source.interaction.running, true);
	source.tree.selectionIndex = 0; assert.equal(captureWorkbenchTreeView(input.tree, element => element.key).selected, before.selected);
	assert.equal(runtime.machine.scheduler.nowCycles, cycles, 'constructing a source view performs no guest execution');
	assert.equal(source.workingCopy.buffer.getText(), text);
});

test('Behavior fresh views acquire their own source lease and graph state without inheriting visible runtime inspection', t => {
	const text = "local t=require('cartlib/behaviour_tree/library'); t.register('kept',{root={type='sequence',children={{type='wait',duration_ticks=1}}}})";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('tree.lua', 1, text), createScenarioTestSourceRecord('cartlib/behaviour_tree/library.lua', 1, ''),
	]);
	const controller = new BehaviorLensController(sources, null!, new BehaviorSourceDocuments(editorTextModelService, sources.catalog),
		() => assert.fail('copying source does not run an FSM layout'), null!, null!, null!);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'tree.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource), source = controller.createInput(model, 'graph');
	const group = createTestEditorGroup(); group.openEditor(source); t.after(() => group.dispose());
	selectBehaviorLensDefinition(source.view, source.view.document.definitions[0].rowKey); source.updateDefinition();
	assert.ok(source.view.presentation.kind === 'graph');
	source.view.selectionState.select({ kind: 'node', rowKey: source.view.source.nodes.at(-1)!.rowKey });
	source.view.presentation.position = { scrollX: 23, scrollY: 41, zoom: 1.5 };
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), guest = new SuspendedGuestSession(runtime);
	const rewind = new HostRewind(runtime, null!, null!, null!, null!, null!);
	const inspection = new BehaviorRuntimeInspection(sources, guest, rewind, 0, sources.currentBlua32Media.cartridgeSlots[0]!, undefined,
		new RuntimeTransport(runtime, null!, null!, null!, () => true));
	source.runtimeInspection = inspection; t.after(() => inspection.dispose());
	const before = captureBehaviorLensView(source), input = source.createView!(); t.after(() => input.dispose());
	assert.ok(input !== source && input.workingCopy === model && input.view !== source.view);
	assert.ok(input.view.document === source.view.document && input.view.source === source.view.source, 'immutable source generations are acquired, not copied');
	assert.ok(input.graphLayout !== source.graphLayout && input.view.presentation !== source.view.presentation);
	assert.deepEqual(captureBehaviorLensView(input), before);
	assert.equal(input.runtimeInspection, undefined); assert.ok(source.runtimeInspection === inspection);
	const index = input.view.source, span = index.ranges.get(input.view.selectionState.selected!.rowKey)!;
	const start = span.start;
	group.removeEditor(source);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared\n' }]);
	assert.equal(span.start, start + 10, 'closing the original view cannot release its sibling source-index lease');
	controller.updateView(input); assert.equal(input.isDirty(), true);
	assert.equal(model.buffer.getText(), `-- shared\n${text}`);
});

test('Behavior copied views retain dirty imported edit targets after their source occurrence is removed and the original window closes', async t => {
	const primary = "local trees=require('cartlib/behaviour_tree/library'); trees.register('kept',{root={type='sequence',children={require('child')}}})";
	const child = "return {type='wait',duration_ticks=1}";
	const f = createActualSourcePanes(t, false, [
		['tree.lua', primary], ['child.lua', child], ['cartlib/behaviour_tree/library.lua', ''],
	]);
	const controller = f.editor.behaviorLens;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'tree.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const source = controller.createInput(model, 'graph'); f.firstGroup.openEditor(source);
	selectBehaviorLensDefinition(source.view, source.view.document.definitions[0].rowKey); source.updateDefinition(); f.update();
	const importedResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'child.lua' })!;
	const imported = editorTextModelService.get(importedResource)!;
	assert.ok(source.getWorkingCopies().includes(imported));
	imported.pushEditOperations([{ offset: child.indexOf('1'), deleteLength: 1, text: '2' }]);
	const start = primary.indexOf("require('child')");
	model.pushEditOperations([{ offset: start, deleteLength: "require('child')".length, text: '' }]);
	controller.updateView(source); f.update();
	assert.equal(source.view.source.models.has(resourceIdentityKey(importedResource)), false,
		'the current source graph no longer supplies the previously edited import');
	assert.ok(source.getWorkingCopies().includes(imported), 'authored participation outlives the removed occurrence');
	const selected = captureBehaviorLensView(source), text = model.buffer.getText(), importedText = imported.buffer.getText();
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('window.copyEditor', f.firstGroup.panes.activePane!.commandTarget); await setImmediate(); f.update();
	const document = f.editor.editorParts.activePart, input = document.activeGroup.model.activeTab;
	assert.ok(input?.kind === 'behavior_lens' && input !== source);
	const copiedSelection = captureBehaviorLensView(input);
	assert.deepEqual(copiedSelection.definition, selected.definition);
	assert.deepEqual(copiedSelection.selected, selected.selected);
	const closing = f.editor.editorParts.close(f.firstPart);
	assert.equal(f.firstPart.actionPrompt.visible, false,
		'the copied source view must remain an owner of the dirty import during close admission');
	assert.equal(await closing, true);
	assert.ok(input.getWorkingCopies().includes(imported));
	assert.equal(input.isDirty(), true); assert.ok(editorTextModelService.get(importedResource) === imported);
	assert.equal(model.buffer.getText(), text); assert.equal(imported.buffer.getText(), importedText);
	assert.equal(imported.canUndo, true); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});
