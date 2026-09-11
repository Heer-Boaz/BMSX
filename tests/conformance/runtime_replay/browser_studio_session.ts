import { setFieldText } from '../../../ide/editor/ui/inline/text_field';
import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { HostPauseReason } from '../../../hosts/common/execution_control';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import type { GPUBackend } from '../../../machine/ts/render/backend/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { createStudioFixture, check, type StudioFixture } from './studio_fixture';
import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { openEditorTab } from '../../../ide/workbench/ui/tabs';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { captureBehaviorLensView } from '../../../ide/workbench/contrib/behavior_lens/view_snapshot';
import { acceptBehaviorGraphSelection } from '../../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { selectSceneOutlineRow } from '../../../ide/workbench/contrib/scene_editor/outline';
import { captureSceneEditorView } from '../../../ide/workbench/contrib/scene_editor/view_snapshot';
import { persistWorkspaceSessionLocally } from '../../../ide/workbench/workspace/storage';
import { workspaceState } from '../../../ide/workbench/workspace/state';
import { BT_TRANSFER_SOURCE } from '../../helpers/behavior_transfer_fixture';
import { SCENE_VIEWPORT_SOURCE } from '../../fixtures/studio/scene_viewport';
import { WORKBENCH_RESOURCE_VIEWER_ID } from '../../../ide/workbench/contrib/resources/editor_input';
import { WORKBENCH_TEXT_EDITOR_ID } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { resolveRuntimeResourceForContext } from '../../../ide/runtime/sources';
import type { SerializedEditorGroup } from '../../../ide/workbench/services/editor/editor_serialization';
import { selectScenarioLabTestRow, toggleScenarioLabTestRow } from '../../../ide/workbench/contrib/scenario_lab/navigation';
import { readLocalWorkspaceRecord, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE } from '../../../ide/workspace/records';
import { joinWorkspacePaths } from '../../../ide/workspace/path';
import type { WorkspaceAutosavePayload } from '../../../ide/workbench/workspace/models';
import { captureCodeEditorView } from '../../../ide/workbench/contrib/code_editor/view_snapshot';
import { inputFocus } from '../../../ide/input/focus';

// A restored source override participates in the normal cold boot, so keep an entry module.
const SOURCE = 'module<entry>\n' + BT_TRANSFER_SOURCE + SCENE_VIEWPORT_SOURCE + `
local machines<const> = require('cartlib/fsm/library')
machines.register('session.machine', {
 initial = 'idle', states = {
  idle = { on = { start = '../active' } },
  active = { on = { stop = '../idle' } },
 },
})
local vblank<const> = require('cartlib/gx/vblank')
while true do vblank.wait() end
`;

type SessionExpectation = { group: SerializedEditorGroup; source: string; scene: ReturnType<typeof captureSceneEditorView>; fsm: ReturnType<typeof captureBehaviorLensView> };

async function prepare(test: StudioFixture): Promise<SessionExpectation> {
	const { ide } = test;
	await test.until(() => test.cycles() > test.runtime.timing.cpuHz * 13, 'session: boot actual machine');
	await test.press('ControlRight', 'ShiftRight');
	await test.runPaletteCommand('Run: Pause');
	ide.editor.setFontVariant('tiny');
	test.harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model!;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: SOURCE }]);
	activeCodeEditor.view!.cursorRow = 2; activeCodeEditor.view!.cursorColumn = 9;
	activeCodeEditor.view!.selectionAnchor = { row: 1, column: 4 };
	const sourceInput = editorTabGroup.activeTab!;
	if (sourceInput.kind !== 'code_editor') throw new Error('session: original source input required');
	const sourceSelection = captureCodeEditorView(sourceInput);
	const scene = new SceneEditorInput(model);
	ide.editor.sceneEditor.refresh(scene); selectSceneOutlineRow(scene, 1);
	openEditorTab(ide.editor.editorPanes, scene); await test.frame();
	for (const [index, presentation] of [[0, 'graph'], [1, 'graph'], [2, 'state-graph']] as const) {
		const input = ide.editor.behaviorLens.createInput(model, presentation);
		selectBehaviorLensDefinition(input.view, input.view.document.definitions[index].rowKey); input.updateLabel();
		openEditorTab(ide.editor.editorPanes, input); await test.frame();
		const graph = input.view.presentation;
		if (graph.kind !== 'graph' && graph.kind !== 'state-graph') throw new Error('session: graph input required');
		if (graph.kind === 'state-graph') await test.until(() => graph.layoutState.kind === 'ready', 'session: actual FSM worker layout');
		else { graph.viewport.selection = graph.viewport.model.nodes[0].children[0].children[1]; acceptBehaviorGraphSelection(input.view, graph); }
		graph.viewport.setZoom(0.75 + index * 0.25); graph.viewport.scrollX = 43 + index * 9; graph.viewport.scrollY = 27 + index * 3;
	}
	const fsm = editorTabGroup.activeTab!;
	if (fsm.kind !== 'behavior_lens') throw new Error('session: active FSM required');
	ide.editor.scenarioLab.open(); await test.frame();
	const scenario = editorTabGroup.activeTab!;
	if (scenario.kind !== 'scenario_lab') throw new Error('session: Scenario Lab input required');
	selectScenarioLabTestRow(scenario.view, 0);
	toggleScenarioLabTestRow(scenario.view, 0);
	// An explicit source viewer and clean preview exercise non-working-copy and clean state.
	const resource = resolveRuntimeResourceForContext(ide.sources, 0, 'constants')!;
	const viewer = await ide.editor.resourceEditors.resolveEditorInput(resource, WORKBENCH_RESOURCE_VIEWER_ID);
	openEditorTab(ide.editor.editorPanes, viewer); await test.frame();
	if (viewer.kind !== 'resource_view') throw new Error('session: source viewer required');
	viewer.resource.scroll = 2;
	const code = await ide.editor.resourceEditors.resolveEditorInput(resource, WORKBENCH_TEXT_EDITOR_ID);
	openEditorTab(ide.editor.editorPanes, code, { pinned: false }); await test.frame();
	if (code.kind !== 'code_editor') throw new Error('session: clean source preview required');
	code.context.view.cursorRow = 5; code.context.view.cursorColumn = 3;
	openEditorTab(ide.editor.editorPanes, fsm); await test.frame();
	check(activeCodeEditor.model === null && activeCodeEditor.view === null, 'session: visual input has no stale attached text widget');
	check(!code.workingCopy.dirty && editorTabGroup.previewTab === code, 'session: clean preview is independent of dirty source backup');
	check(JSON.stringify(captureCodeEditorView(sourceInput)) === JSON.stringify(sourceSelection), 'session: opening visual panes preserves code cursor and selection');
	check(model.buffer.getText() === SOURCE, 'session: creating views never changes the canonical source');
	return { group: editorTabGroup.serialize(ide.editor.editorInputSerializers), source: SOURCE,
		scene: captureSceneEditorView(scene), fsm: captureBehaviorLensView(fsm) };
}

async function restore(test: StudioFixture, expected: SessionExpectation): Promise<void> {
	const { ide } = test;
	check(!test.execution.userPaused && test.history.checkpointCount === 0, 'session: workbench restoration does not restore guest pause or rewind');
	const restored = editorTabGroup.serialize(ide.editor.editorInputSerializers);
	check(JSON.stringify(restored) === JSON.stringify(expected.group), 'session: reload reconstructs exact ordered input values, active and preview');
	const active = editorTabGroup.activeTab;
	if (active?.kind !== 'behavior_lens' || active.view.presentation.kind !== 'state-graph') throw new Error('session: active visual input did not survive reload');
	const model = active.workingCopy;
	check(model.buffer.getText() === expected.source && model.dirty && !model.canUndo, 'session: exact dirty bytes, fresh working copy, no fabricated Undo history');
	const siblings = editorTabGroup.tabs.filter(tab => tab.kind === 'behavior_lens' || tab.kind === 'scene_editor' || (tab.kind === 'code_editor' && tab.workingCopy.resource.path === model.resource.path));
	check(siblings.every(tab => tab.kind !== 'resource_view' && tab.kind !== 'scenario_lab' && tab.workingCopy === model), 'session: views share one resource-owned working copy');
	check([...editorTextModelService.models].filter(candidate => candidate.resource.path === model.resource.path).length === 1, 'session: no shadow editor model');
	check(activeCodeEditor.model === null && activeCodeEditor.view === null, 'session: reload of active visual pane leaves code widget detached');
	test.execution.setPauseReason(HostPauseReason.Requested, true);
	ide.editor.activate();
	await test.until(() => active.view.presentation.kind === 'state-graph' && active.view.presentation.layoutState.kind === 'ready', 'session: cold restored FSM layout');
	check(JSON.stringify(captureBehaviorLensView(active)) === JSON.stringify(expected.fsm), 'session: asynchronous layout consumes the saved FSM pan/zoom once');
	for (let index = 0; index < editorTabGroup.tabs.length; index += 1) {
		const input = editorTabGroup.tabs[index];
		if (input.kind !== 'behavior_lens' || input.view.presentation.kind !== 'graph') continue;
		await test.clickTab(input.id);
		check(ide.editor.editorInputSerializers.behavior_lens.serialize(input) === expected.group.inputs[index].value,
			'session: first BT activation restores the selected occurrence and pan/zoom');
	}
	const scene = editorTabGroup.tabs.find(input => input.kind === 'scene_editor')!;
	if (scene.kind !== 'scene_editor') throw new Error('session: scene input required');
	await test.clickTab(scene.id);
	check(JSON.stringify(captureSceneEditorView(scene)) === JSON.stringify(expected.scene), 'session: cold scene layout preserves selected source member');
	// Pagehide observes accepted model state, not the current inline draft.
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('session: actual SceneEditorPane required');
	const field = pane.controls[0].field;
	field.focusTarget.focus(); setFieldText(field, '-', true); // invalid draft, not an accepted source edit
	const version = model.version;
	persistWorkspaceSessionLocally();
	check(inputFocus.target === field.focusTarget && model.version === version, 'session: checkpoint neither blurs nor commits a widget draft');
	check(workspaceState.localGeneration!.dirtyRecords.size === 1, 'session: one backup regardless of visual input count');
	// Shutdown ends normal focus first, then checkpoints the still-live inputs.
	const topology = editorTabGroup.serialize(ide.editor.editorInputSerializers);
	const root = workspaceState.projectRootPath!;
	const statePath = joinWorkspacePaths(root, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
	await ide.editor.shutdown();
	check(model.version === version && model.buffer.getText() === expected.source, 'session: invalid draft is not promoted on shutdown');
	const record = readLocalWorkspaceRecord(localStorage, root, statePath)!;
	const payload: WorkspaceAutosavePayload = JSON.parse(record.contents);
	check(JSON.stringify(payload.editorGroup) === JSON.stringify(topology), 'session: shutdown persists the actual complete group before disposing its inputs');
	check(payload.dirtyFiles.length === 1, 'session: shutdown retains the resource-owned backup');
}

async function run(canvas: HTMLCanvasElement, backend: GPUBackend, expected?: SessionExpectation) {
	const test = await createStudioFixture(canvas, backend);
	// Same pagehide event and production checkpoint as ide/browser/studio.ts.
	window.addEventListener('pagehide', persistWorkspaceSessionLocally);
	if (expected === undefined) return prepare(test);
	await restore(test, expected);
	return { restored: true };
}

export const studioSessionBackends = {
	software: (canvas: HTMLCanvasElement, expected?: SessionExpectation) => run(canvas, new HeadlessGPUBackend(canvas.width, canvas.height, PSX_MACHINE_SPEC.gxGpuVramBytes), expected),
	webgl2: (canvas: HTMLCanvasElement, expected?: SessionExpectation) => run(canvas, createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes), expected),
	webgpu: async (canvas: HTMLCanvasElement, expected?: SessionExpectation) => run(canvas, await createWebGPUBackend(canvas, await navigator.gpu.requestAdapter(), PSX_MACHINE_SPEC.gxGpuVramBytes), expected),
};
