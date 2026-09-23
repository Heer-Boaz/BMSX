import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ScenarioLabEditorPane } from '../../../ide/workbench/contrib/scenario_lab/editor_pane';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

/** Actual isolated test execution and visible result/assistant controls; fixture source setup is automated. */
export async function runAssistantTestEvidence(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame, harness, cycles, runPaletteCommand } = test;
	await until(() => cycles() > test.runtime.timing.cpuHz * 13, 'test evidence: boot actual cart');
	await press('ControlRight', 'ShiftRight'); await runPaletteCommand('Run: Pause');
	await runPaletteCommand('Scenario Lab: Open');
	const lab = getActiveTab(); if (lab.kind !== 'scenario_lab') throw new Error('Scenario Lab required');
	const module = ide.scenarioRuns.collection.roots[0].children[0];
	harness.openLuaSource(module.resource.path);
	const document = harness.getActiveEditorDocument().model;
	const source = `return { kind = 'unit',
 teardown = function(t) t:log('cleanup evidence') end,
 tests = {
  failing = function() error('evidence failure') end,
  passing = function() assert(true) end,
 }
}`;
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source }]);
	await runPaletteCommand('Scenario Lab: Open');
	await press('Home'); await press('ArrowDown');
	check(lab.view.testPane.selectedNodeId === module.id, 'test evidence: module selected by keyboard');
	await runPaletteCommand('Scenario Lab: Run Scenarios');
	await until(() => !ide.scenarioRuns.active, 'test evidence: real batch completes');
	const run = ide.scenarioRuns.results.runs[0];
	check(run.state === 'failed' && run.failedCount === 1 && run.passedCount === 1, 'test evidence: actual terminal outcomes');
	await press('Tab'); await press('Home'); await press('ArrowDown');
	await runPaletteCommand('Scenario Lab: Inspect Test Result');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof ScenarioLabEditorPane)) throw new Error('Scenario Lab pane required');
	check(pane.inspector.visible && pane.inspector.model.rows[2].element.value === source, 'ordinary Details owns the same captured suite evidence');
	await renderer.capture!('shared-test-result'); await press('Escape');
	harness.openLuaSource(module.resource.path);
	const current = source.replace("error('evidence failure')", 'assert(true)');
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: current }]);
	const version = document.version, position = cycles(), media = ide.sources.currentBlua32Media;
	await runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	const conversation = ide.editor.assistant;
	await test.click(view.composerBounds); test.clipboard.text = 'Read the recorded test results. They predate my source edit; do not run or change anything.';
	await press('ControlLeft', 'KeyV'); await press('ControlLeft', 'Enter');
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.kind === 'assistant'), 'test evidence: real tool round trip');
	check(ide.scenarioRuns.results.runs.length === 1 && !ide.scenarioRuns.active && run.state === 'failed', 'reads cannot manufacture a rerun or rewrite its outcome');
	check(document.version === version && document.buffer.getText() === current, 'result reads cannot edit or replace the current working copy');
	check(cycles() === position && ide.sources.currentBlua32Media === media && ide.fault.faultSnapshot === null, 'result reads do not execute or replace the authoring machine');
	check(conversation.entries.every(entry => entry.kind !== 'proposal'), 'historical evidence is not edit authority');
	await frame(); await renderer.capture!('response');
	await renderer.finish(); await ide.editor.shutdown();
	return { evidence: 'pass', path: module.resource.path, source, current, states: run.items.map(item => item.state) };
}
