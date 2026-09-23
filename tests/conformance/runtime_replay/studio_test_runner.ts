import { testStudioScenarioExecution } from './studio_scenario_execution';
import { testStudioScenarioOutput } from './studio_scenario_output';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';
import { ScenarioLabEditorPane } from '../../../ide/workbench/contrib/scenario_lab/editor_pane';

/** Real Studio commands, source models and isolated physical execution targets. */
export async function runStudioTestRunner(test: StudioFixture) {
	const { ide, runtime, harness, press, until, frame, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'test runner: cartridge boot');
	await press('ControlRight', 'ShiftRight');
	await runPaletteCommand('Scenario Lab: Open');
	const tab = getActiveTab();
	if (tab.kind !== 'scenario_lab') throw new Error('Scenario Lab expected');
	const moduleRow = tab.view.testPane.rows.find(row => row.kind === 'module')!;
	if (moduleRow.kind !== 'module') throw new Error('Packaged test module expected');
	harness.openLuaSource(moduleRow.module.resource.path);
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const authored = [
		"return { kind = 'unit',",
		" teardown = function(t) t:log('cleanup') end,",
		' tests = {',
		'  failure = function()',
		"   error('isolated assertion')",
		'  end,',
		'  success = function() return false end,',
		' }',
		'}',
	].join('\n');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: authored }]);
	await runPaletteCommand('Scenario Lab: Open');
	const moduleIndex = tab.view.testPane.rows.findIndex(row => row.id === moduleRow.id);
	tab.view.testPane.selectionIndex = moduleIndex;
	tab.view.testPane.selectedNodeId = moduleRow.id;
	const authoringCycles = cycles();
	const authoringMedia = ide.sources.currentBlua32Media;
	await runPaletteCommand('Scenario Lab: Run Scenarios');
	await until(() => !ide.scenarioRuns.active, 'test runner: named batch completes');
	const run = ide.scenarioRuns.results.runs[0];
	check(run.items.length === 2 && run.items[0].state === 'failed' && run.items[1].state === 'passed', 'named results and ordinary return values');
	check(run.items[0].logs.at(0).text === 'cleanup', 'failed body still runs teardown');
	const failure = run.items[0].failures[0];
	check(failure.message.includes('isolated assertion') && failure.location?.line === 5
		&& failure.location.resource.path === moduleRow.module.resource.path, 'authored failure location retained');
	check(ide.scenarioRuns.session!.failedExecution!.target.runtime !== runtime, 'failure belongs to its own machine');
	check(cycles() === authoringCycles && ide.sources.currentBlua32Media === authoringMedia, 'run never reboots or mutates the paused authoring target');
	check(ide.fault.faultSnapshot === null, 'failed test does not fault Studio');
	await test.capture?.('named-test-results');

	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length,
		text: authored.replace("error('isolated assertion')", 'assert(true)') }]);
	await runPaletteCommand('Scenario Lab: Rerun Scenarios');
	await until(() => !ide.scenarioRuns.active, 'test runner: rerun current source');
	check(ide.scenarioRuns.results.runs[0].passedCount === 2, 'rerun rebuilds the edited suite');
	check(ide.scenarioRuns.session!.failedExecution === null, 'new run releases the previous failed target');
	await frame();
	check(cycles() === authoringCycles, 'Studio remains paused after completion');
	const failedIndex = tab.view.resultPane.rows.findIndex(row => row.id === run.items[0].id);
	check(failedIndex >= 0, 'earlier result remains inspectable after rerun');
	await press('Tab'); await press('Home');
	for (let index = 0; index < failedIndex; index++) await press('ArrowDown');
	await runPaletteCommand('Scenario Lab: Inspect Test Result');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof ScenarioLabEditorPane)) throw new Error('Scenario Lab result pane expected');
	check(pane.inspector.visible && pane.inspector.model.rows[0].element.value === 'failed', 'Details observes the recorded outcome');
	check(pane.inspector.model.rows[1].element.value === authored, 'Details reads the failed suite, not the passing rerun source');
	check(!pane.inspector.isEnabled('propertyInspector.source'), 'historical suite inspection cannot substitute current source navigation');
	const measured = pane.inspector.model.rows[1];
	for (let index = 0; index < 20; index++) await frame();
	check(pane.inspector.model.rows[1] === measured && cycles() === authoringCycles, 'source evidence has retained layout and no guest execution');
	await test.capture?.('captured-suite-source');
	await press('Escape');
	await press('ShiftLeft', 'Tab');
	check(tab.view.focus === 'tests', 'result inspection returns through normal focus navigation before selecting the next test');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: original }]);
	await runPaletteCommand('Run: Pause');
	await testStudioScenarioExecution(test);
	await testStudioScenarioOutput(test);
	console.info('STUDIO: named cases, cleanup, isolated failure, current-source rerun PASS');
	return { hostFrames: test.observations.hostFrames, passed: 2, failed: 1 };
}
