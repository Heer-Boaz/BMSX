import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ScenarioLabEditorPane } from '../../../ide/workbench/contrib/scenario_lab/editor_pane';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

export async function runAssistantTestDebugger(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>, releaseModel: () => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame, harness, cycles, runPaletteCommand } = test;
	await until(() => cycles() > test.runtime.timing.cpuHz * 13, 'test debugger: boot authoring');
	await press('ControlRight', 'ShiftRight'); await runPaletteCommand('Run: Pause');
	ide.scenarioRuns.refreshSources();
	const module = ide.scenarioRuns.collection.roots[0].children[0];
	harness.openLuaSource(module.resource.path);
	const document = harness.getActiveEditorDocument().model;
	const source = `local shared = { value = 0 }
test_global = shared
local child<const> = function(amount)
 shared.value = amount
 shared.value = shared.value + 1
 return shared.value
end
return { kind = 'unit',
 setup = function() shared.value = 10 end,
 teardown = function(t) t:log('cleanup') end,
 tests = { codex_probe = function()
  local result = child(20)
  shared.value = result + 1
  assert(shared.value == 22)
 end },
}`;
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source }]);
	const remove = ide.scenarioRuns.onDidChangeRun(event => {
		if (event.type !== 'started') return;
		remove(); document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source.replace('child(20)', 'child(500)') }]);
	});
	const position = cycles(), media = ide.sources.currentBlua32Media;
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Debug codex_probe on its own test target. Set a compiled-source breakpoint, step into child, inspect the actual amount local and compiled source, then step and finish. Do not install or run the authoring game.');
	await until(() => ide.scenarioRuns.debugger?.reason === 'step', 'model reaches the source step on the isolated physical test');
	const debug = ide.scenarioRuns.debugger!, revision = debug.revision;
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Scenario Lab: Inspect Stopped Test'); await frame();
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof ScenarioLabEditorPane)) throw new Error('Scenario Lab required');
	const model = pane.targetInspection.model!;
	check(model.inspection.state.target === debug.id && model.inspection.state.role === 'live-test', 'ordinary UI borrows exactly the model-controlled test stop');
	await press('ArrowRight'); await press('ArrowDown');
	check(model.tree.rows[model.tree.selectionIndex].element.value === `${module.resource.path}:4:2`, 'source-stepped frame visible in ordinary inspector');
	await press('Enter'); await frame(); await renderer.capture!('compiled-source'); await press('Escape');
	await press('ArrowRight'); await press('ArrowDown'); await press('ArrowRight');
	check(model.tree.rows.some(node => node.element.label === 'amount [string]' && node.element.value === '20'), 'ordinary inspector sees same actual local as model, not later editor text');
	await frame(); await renderer.capture!('ordinary-shared-stop');
	const borrowed = model.inspection;
	check(debug.revision === revision, 'opening, expanding and reading never executes a test grant');
	await releaseModel();
	await until(() => ide.editor.assistant.state === 'ready', 'model finishes stepping the same target');
	check(!borrowed.available && pane.targetInspection.model === undefined, 'model resume retires UI frame and value borrows');
	check(ide.scenarioRuns.results.runs[0].state === 'passed', 'model-controlled test really completed');
	await runPaletteCommand('View: Codex Assistant'); await frame(); await renderer.capture!('conversation-debugged');

	// Independent ordinary UI workflow: no tools or debugger methods are invoked by the driver.
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source }]);
	await runPaletteCommand('Scenario Lab: Open');
	const lab = getActiveTab(); if (lab.kind !== 'scenario_lab') throw new Error('Scenario Lab input required');
	const caseIndex = lab.view.testPane.rows.findIndex(row => row.kind === 'test' && row.test.caseName === 'codex_probe');
	check(caseIndex >= 0, 'named case visible');
	const list = lab.view.testPane.layout;
	await test.click({ left: list.contentLeft + 40, right: list.contentLeft + 100,
		top: list.contentTop + caseIndex * list.rowHeight, bottom: list.contentTop + (caseIndex + 1) * list.rowHeight });
	await runPaletteCommand('Scenario Lab: Debug Selected Test Case');
	await until(() => ide.scenarioRuns.debugger?.reason === 'entry', 'ordinary Debug admits one case and stops before bind');
	await runPaletteCommand('Scenario Lab: Compiled Test Sources and Breakpoints');
	test.clipboard.text = module.resource.path; await press('ControlLeft', 'KeyV'); await press('Enter');
	test.clipboard.text = 'local result = child(20)'; await press('ControlLeft', 'KeyV'); await press('Enter');
	await runPaletteCommand('Scenario Lab: Continue Test');
	await until(() => ide.scenarioRuns.debugger?.reason === 'breakpoint', 'ordinary compiled breakpoint stops the test');
	await frame(); await renderer.capture!('ordinary-breakpoint');
	await runPaletteCommand('Scenario Lab: Step Into Test');
	await until(() => ide.scenarioRuns.debugger?.reason === 'step', 'ordinary Step Into reaches child');
	await runPaletteCommand('Scenario Lab: Inspect Stopped Test');
	await press('ArrowRight'); await press('ArrowDown'); await press('ArrowRight'); await press('ArrowDown'); await press('ArrowRight');
	const ordinary = pane.targetInspection.model!;
	check(ordinary.tree.rows.some(node => node.element.label === 'amount [string]' && node.element.value === '20'), 'ordinary Debug/Breakpoint/Into/Inspect uses the same actual inspection core');
	await frame(); await renderer.capture!('ordinary-step-locals');
	await runPaletteCommand('Scenario Lab: Step Over Test');
	await until(() => ide.scenarioRuns.debugger?.stopped === true, 'ordinary Step Over stops');
	check(!ordinary.inspection.available, 'ordinary resume also expires its old stack');
	await runPaletteCommand('Scenario Lab: Continue Test');
	await until(() => !ide.scenarioRuns.active, 'ordinary Continue really finishes');
	check(ide.scenarioRuns.results.runs[0].state === 'passed', 'ordinary debug run passes');

	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Start another debug case and wait at its admission stop.');
	await until(() => ide.scenarioRuns.debugger?.reason === 'entry', 'second prompt owns another paused debug run');
	const last = ide.scenarioRuns.results.liveRun!, inspector = ide.scenarioRuns.debugger!.inspect();
	const chat = getActiveTab(); if (chat.kind !== 'assistant') throw new Error('Assistant required');
	await test.click(chat.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	check(!inspector.available, 'visible conversation Stop expires the run borrow synchronously');
	await until(() => ide.editor.assistant.state === 'ready' && !ide.scenarioRuns.active, 'Stop completes provider interruption and bounded test cleanup');
	check(last.state === 'cancelled', 'Stop cancels only its owned test run');
	await frame(); await renderer.capture!('conversation-stopped');
	check(cycles() === position && ide.sources.currentBlua32Media === media && document.dirty, 'no debug operation ran, installed or saved the authoring cart');
	await renderer.finish(); await ide.editor.shutdown();
	return { debugger: 'pass', path: module.resource.path, source, position };
}
