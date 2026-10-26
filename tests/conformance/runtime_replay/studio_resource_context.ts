import { editorTextModelService } from '../../../ide/editor/model/model_service';

import { buildCodeTabId } from '../../../ide/workbench/ui/tab/id';
import { resolveRuntimeResource } from '../../../ide/runtime/sources';
import { getProblemsPanelBounds, problemsPanel } from '../../../ide/workbench/contrib/problems/panel/controller';
import { resolveTextFileModel } from '../../../ide/workbench/services/working_copy/text_file_model';
import { runBackgroundTasks } from '../../../ide/common/background_tasks';
import { sourcePane, check, type StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';

/** Real visual/code/Problems projections and session teardown; authoring setup is automated. */
export async function runStudioResourceContext(test: StudioFixture) {
	const { ide, runtime, harness, until, frame, press, cycles, title, runMenuCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'resource context: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const actor = title(), position = cycles(), media = ide.sources.currentBlua32Media;
	const resource = resolveRuntimeResource(ide.sources, { domain: 0, path: 'scenes/root.lua' })!;
	check(ide.editor.editorGroup.model.findById(buildCodeTabId(resource)) === undefined, 'resource context: scene has never had a code input');
	ide.editor.sceneEditor.openResource(resource);
	await frame();
	const scene = ide.editor.editorGroup.model.activeTab;
	if (scene.kind !== 'scene_editor') throw new Error('resource context: actual visual editor expected');
	const model = scene.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'local studio_context_probe = missing_from_scene_context\n' }]);
	await until(() => ide.diagnostics.get(model)!.status === 'ready', 'resource context: background analysis of visual-only source');
	const marker = ide.diagnostics.diagnostics.find(item => item.model === model && item.message.includes('missing_from_scene_context'))!;
	check(marker !== undefined && marker.version === model.version, 'resource context: resource marker identifies exact model revision');
	check(ide.editor.editorGroup.model.findById(buildCodeTabId(resource)) === undefined && ide.editor.editorGroup.model.activeTab === scene,
		'resource context: analysis neither requires nor creates a code input');
	const yaml = ide.sources.resources.find(item => item.domain === 0 && item.path.endsWith('nemesis_s_stage.yaml'))!;
	const yamlModel = await resolveTextFileModel(editorTextModelService, ide.sources, yaml);
	check(ide.diagnostics.get(yamlModel)!.status === 'unsupported', 'resource context: YAML is not an empty successful Lua analysis');
	check(editorTextModelService.get({ domain: 0, path: 'scenes/hangar.lua' }) === undefined, 'resource context: unopened source is unrequested coverage');
	await test.runPaletteCommand('View: Problems Panel');
	check(problemsPanel.isVisible && problemsPanel.getDiagnostics().includes(marker), 'resource context: Problems reads the visual resource result');
	await frame();
	await test.capture?.('visual-diagnostics');
	const index = problemsPanel.getDiagnostics().indexOf(marker);
	const bounds = getProblemsPanelBounds()!, layout = problemsPanel.getCachedLayout();
	await test.click({ left: bounds.left + 4, right: bounds.right - 4, top: layout.headerTop + 2, bottom: layout.headerBottom - 2 });
	await press('Home');
	for (let step = 0; step < index; step++) await press('ArrowDown');
	check(problemsPanel.selectedDiagnostic === marker, 'resource context: keyboard selects the actual Problems row');
	await press('Enter');
	check(harness.getActiveEditorDocument().model === model && sourcePane(test).code.view.cursorRow === marker.row,
		'resource context: Problems navigation opens the shared source, not a private buffer');
	await frame();
	await test.capture?.('source-navigation');
	const result = ide.diagnostics.get(model);
	await press('ControlLeft', 'KeyW');
	check(ide.diagnostics.get(model) === result && editorTextModelService.get(resource) === model,
		'resource context: closing a code tab does not close its working copy or discard diagnostics');
	model.undo();
	await until(() => ide.diagnostics.get(model)!.status === 'ready', 'resource context: shared Undo recomputes source results');
	check(!ide.diagnostics.diagnostics.some(item => item.message.includes('missing_from_scene_context')), 'resource context: no stale marker after Undo');
	check(cycles() === position && title() === actor && ide.sources.currentBlua32Media === media,
		'resource context: source analysis never executes, resets or installs guest code');
	await test.clickTab(scene.id);
	await frame();
	await test.capture?.('source-restored');
	let disposed = false;
	model.onWillDispose(() => { disposed = true; });
	// Queue a query and tear down the actual workbench before the background pump.
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- queued diagnostics\n' }]);
	model.undo();
	test.clock.advance(1000);
	await ide.editor.shutdown();
	runBackgroundTasks(test.clock);
	check(disposed && editorTextModelService.get(resource) === undefined && ide.diagnostics.diagnostics.length === 0,
		'resource context: actual shutdown drains source work, disposes models and retires queued results');
	return { hostFrames: test.observations.hostFrames, resourceContext: 'pass', lifetime: 'disposed', guestCycles: position };
}
