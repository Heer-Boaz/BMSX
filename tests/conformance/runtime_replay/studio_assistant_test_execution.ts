import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Real model transport selects and runs tests; fixture source edits are automated, not UI-only evidence. */
export async function runAssistantTestExecution(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame, harness, cycles, runPaletteCommand } = test;
	await until(() => cycles() > test.runtime.timing.cpuHz * 13, 'test tools: boot actual authoring cart');
	await press('ControlRight', 'ShiftRight'); await runPaletteCommand('Run: Pause');
	// No Scenario Lab pane is opened to discover or execute these runs.
	ide.scenarioRuns.refreshSources();
	const module = ide.scenarioRuns.collection.roots[0].children[0];
	harness.openLuaSource(module.resource.path);
	const document = harness.getActiveEditorDocument().model;
	const source = `return { kind = 'integration',
 teardown = function(t) t:log('cleanup begins'); t:wait_ticks(2); t:log('cleanup ends') end,
 tests = {
  codex_probe = function(t) t:wait_ticks(2); error('tool failure before edit') end,
  codex_waiting = function(t) t:log('waiting body entered'); t:wait_ticks(2900) end,
 }
}`;
	const current = source.replace("error('tool failure before edit')", 'assert(true)');
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source }]);
	const acceptedVersion = document.version;
	const remove = ide.scenarioRuns.onDidChangeRun(event => {
		if (event.type !== 'started') return;
		remove();
		// A later editor change must not alter already accepted source or dependency snapshots.
		document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: current }]);
	});
	const position = cycles(), media = ide.sources.currentBlua32Media;
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Discover codex_probe, run it and wait for the outcome. Read its failure. Rerun the same case from the current source and inspect that outcome. Start codex_waiting and explicitly cancel that run.');
	const conversation = ide.editor.assistant;
	await until(() => conversation.state === 'ready', 'test tools: model discovers, starts, waits, inspects, reruns and cancels');
	const runs = ide.scenarioRuns.results.runs;
	check(runs.length === 3 && runs[2].state === 'failed' && runs[1].state === 'passed' && runs[0].state === 'cancelled', 'actual per-run outcomes, not start acknowledgements');
	check(runs[2].items[0].source === source && runs[2].items[0].sourceRevision === acceptedVersion && runs[1].items[0].source === current,
		'first accepted suite is preserved; explicit rerun consumes newer working copy');
	check(cycles() === position && ide.sources.currentBlua32Media === media && test.execution.userPaused, 'isolated test tools never execute or replace authoring media');
	check(document.dirty && document.buffer.getText() === current && conversation.entries.every(entry => entry.kind !== 'proposal'), 'execution is neither save/install nor source-edit authority');
	await frame(); await renderer.capture!('conversation-results');
	await runPaletteCommand('Scenario Lab: Open'); await frame();
	const lab = getActiveTab(); if (lab.kind !== 'scenario_lab') throw new Error('Scenario Lab required');
	check(lab.view.resultService === ide.scenarioRuns.results, 'ordinary Scenario Lab and conversation share one result owner');
	await renderer.capture!('ordinary-scenario-history');
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Start codex_waiting and wait for it. I will stop your work while it is executing.');
	await until(() => runs.length === 4 && runs[0].items[0].logs.length > 0, 'test tools: actual isolated waiting case enters its body');
	const own = runs[0];
	for (let i = 0; i < 3; i++) await frame();
	check(own.state === 'running' && ide.scenarioRuns.session!.execution!.target.runtime !== test.runtime, 'test target is physically separate from authoring');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	await until(() => conversation.state === 'ready' && !ide.scenarioRuns.active, 'test tools: visible Stop retires wait and finishes bounded test cleanup');
	check(own.state === 'cancelled' && own.items[0].logs.at(own.items[0].logs.length - 1).text === 'cleanup ends', 'chat Stop cancels its own test without dropping cooperative teardown');
	check(own.items[0].failures.length === 0 && own.cancelledCount === 1, 'cancellation is not an invented failure or double completion');
	check(cycles() === position && ide.sources.currentBlua32Media === media && ide.fault.faultSnapshot === null, 'authoring CPU, installed code and fault state remain unchanged');
	await renderer.capture!('stopped-test');
	await renderer.finish(); await ide.editor.shutdown();
	return { execution: 'pass', path: module.resource.path, source, current, position, states: runs.map(run => run.state), acceptedVersion };
}
