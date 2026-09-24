import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ScenarioLabEditorPane } from '../../../ide/workbench/contrib/scenario_lab/editor_pane';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

export async function runAssistantTestInspection(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame, harness, cycles, runPaletteCommand } = test;
	await until(() => cycles() > test.runtime.timing.cpuHz * 13, 'test inspection: boot authoring target');
	await press('ControlRight', 'ShiftRight'); await runPaletteCommand('Run: Pause');
	ide.scenarioRuns.refreshSources();
	const module = ide.scenarioRuns.collection.roots[0].children[0];
	harness.openLuaSource(module.resource.path);
	const document = harness.getActiveEditorDocument().model;
	const source = `return { kind = 'unit',
 teardown = function() test_probe.answer = 99 end,
 tests = { codex_probe = function()
  local probe<const> = { answer = 41 }
  test_probe = probe
  error('inspect my failed thread')
  return probe
 end }
}`;
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source }]);
	const remove = ide.scenarioRuns.onDidChangeRun(event => {
		if (event.type !== 'started') return;
		remove(); document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source.replace('41', '500') }]);
	});
	const position = cycles(), media = ide.sources.currentBlua32Media;
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Run codex_probe. Attach its failed test target and inspect the original frame, local probe table, and compiled source. Do not rerun it or use the authoring game.');
	await until(() => ide.editor.assistant.state === 'ready', 'model inspects actual retained failed target');
	const result = ide.scenarioRuns.results.runs[0].items[0];
	check(result.state === 'failed' && ide.scenarioRuns.canInspect(result), 'a physical failed test target remains after prompt completion');
	await frame(); await renderer.capture!('conversation-values');
	await runPaletteCommand('Scenario Lab: Open'); await frame();
	const lab = getActiveTab(); if (lab.kind !== 'scenario_lab') throw new Error('Scenario Lab required');
	await press('Tab'); await press('Home');
	const index = lab.view.resultPane.rows.findIndex(row => row.id === result.id);
	for (let i = 0; i < index; i++) await press('ArrowDown');
	await runPaletteCommand('Scenario Lab: Inspect Retained Test Target'); await frame();
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof ScenarioLabEditorPane)) throw new Error('Scenario Lab pane required');
	const model = pane.targetInspection.model!;
	check(model !== undefined && model.tree.roots[0].children.length === 0, 'ordinary inspection lazily binds same target without reading values during paint');
	await press('ArrowRight');
	const frameNode = model.tree.rows.find(node => node.element.frame !== undefined && node.element.value.startsWith(module.resource.path))!;
	check(frameNode !== undefined, 'compiled test frame visible in ordinary UI');
	for (let remaining = model.tree.rows.indexOf(frameNode) - model.tree.selectionIndex; remaining > 0; remaining--) await press('ArrowDown');
	check(model.tree.rows[model.tree.selectionIndex] === frameNode, 'keyboard selects failed frame');
	await press('Enter'); await frame(); await renderer.capture!('compiled-source'); await press('Escape');
	await press('ArrowRight'); await press('ArrowDown'); await press('ArrowRight');
	const probe = model.tree.rows.find(node => node.element.label === 'probe <const> [string]')!;
	check(probe !== undefined && probe.expandable, 'actual failed frame local, not a historical string');
	for (let remaining = model.tree.rows.indexOf(probe) - model.tree.selectionIndex; remaining > 0; remaining--) await press('ArrowDown');
	check(model.tree.rows[model.tree.selectionIndex] === probe, 'keyboard selects local table');
	await press('ArrowRight'); await frame();
	check(probe.children.some(node => node.element.label === 'answer [string]' && node.element.value === '99'), 'ordinary target tree sees after-cleanup value, same as Codex');
	await renderer.capture!('ordinary-target-values');
	const retained = model.inspection;
	await press('Tab'); await press('ArrowRight'); await press('Enter');
	check(pane.targetInspection.model === undefined && !retained.available && ide.scenarioRuns.canInspect(result), 'closing ordinary inspector detaches only its borrow');
	await runPaletteCommand('Scenario Lab: Inspect Retained Test Target');
	const nextInspection = pane.targetInspection.model!.inspection;
	await runPaletteCommand('Scenario Lab: Rerun Scenarios');
	check(!nextInspection.available && pane.targetInspection.model === undefined, 'new run expires the actual target and closes its inspector');
	await until(() => !ide.scenarioRuns.active, 'ordinary rerun completes without authoring target');
	check(!ide.scenarioRuns.canInspect(result) && result.source === source, 'old result retains evidence, not attachment rights');
	check(cycles() === position && ide.sources.currentBlua32Media === media && document.dirty, 'inspection never runs authoring game, saves or installs');
	await renderer.finish(); await ide.editor.shutdown();
	return { inspection: 'pass', path: module.resource.path, source, position };
}
