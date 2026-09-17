import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Runner/debugger integration against the real machine, media builder and UI. */
export async function runStudioScenarioDebug(test: StudioFixture) {
	const { ide, runtime, tasks, harness, press, until, frame, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'scenario debug: cartridge boot');
	await press('ControlRight', 'ShiftRight');
	await runPaletteCommand('Scenario Lab: Open');
	const tab = getActiveTab();
	if (tab.kind !== 'scenario_lab') throw new Error('Scenario Lab expected');
	const row = tab.view.testPane.rows.find(row => row.kind === 'test')!;
	if (row.kind !== 'test') throw new Error('packaged scenario expected');
	await press('Home'); await press('ArrowDown');
	harness.openLuaSource(row.test.resource.path);
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const authored = [
		'__bmsx_host_test = {}',
		'function __bmsx_host_test.ready() return true end',
		'function __bmsx_host_test.setup() end',
		'function __bmsx_host_test.update(tick)',
		'  local marker = tick + 23',
		"  assert(marker < 0, 'scenario debug assertion')",
		'end',
	].join('\n');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: authored }]);
	harness.toggleLuaBreakpoint(row.test.resource.path, 6);
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Scenario Lab: Debug Scenarios');
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'scenario debug: source breakpoint inside update');
	check(ide.scenarioRuns.execution.active && runtime.completionCallPending(), 'scenario callback remains suspended at breakpoint');
	const stoppedAt = cycles();
	await frame(); await frame();
	check(cycles() === stoppedAt, 'debugger inspection does not execute the scenario');
	const hover = harness.getHover(4, 9);
	check(hover !== null && hover.contentLines.includes('marker = 24 (number)'), `scenario callback local has a live value: ${JSON.stringify(hover)}`);
	await test.capture?.('scenario-breakpoint');
	harness.toggleLuaBreakpoint(row.test.resource.path, 6);
	test.observations.expectedFaultSequence = 1;
	await runPaletteCommand('Debug: Continue');
	await until(() => ide.scenarioRuns.inspectingFailure && ide.editor.isActive, 'scenario debug: failed guest stays inspectable');
	const failed = ide.scenarioRuns.results.runs[0];
	check(failed.state === 'failed' && failed.items[0].failure!.message.includes('scenario debug assertion'), 'original assertion retained');
	check(failed.items[0].fault!.details.luaStack.some(frame => frame.kind === 'source'
		&& frame.resource.path === row.test.resource.path && frame.line === 6), 'guest stack retains the authored assertion frame');
	check(failed.items[0].fault !== null && ide.fault.faultSnapshot === failed.items[0].fault, 'live guest fault has not been cleared by reboot');
	const failureAt = cycles();
	await frame();
	await press('ControlRight', 'ShiftRight'); await frame();
	check(cycles() === failureAt, 'closing Studio cannot accidentally execute the failed debug session');
	await press('ControlRight', 'ShiftRight');
	await press('Tab'); await press('Home'); await press('ArrowDown'); await press('ArrowDown');
	await press('Enter'); await press('ArrowDown'); await press('ArrowDown');
	await test.capture?.('scenario-failure');
	await press('Enter');
	await until(() => harness.getActiveCodeContext()?.model === model, 'scenario debug: selected stack frame opens its authored source');
	check(activeCodeEditor.view.cursorRow === 5, 'stack navigation reveals the assertion line');
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Scenario Lab: Stop Scenarios');
	await until(() => !ide.scenarioRuns.active && tasks.ready, 'scenario debug: Stop restores normal cartridge');
	check(failed.state === 'failed' && failed.items[0].state === 'failed', 'Stop preserves the failed verdict');
	check(ide.fault.faultSnapshot === null && !runtime.completionCallPending(), 'Stop releases guest fault and completion state');

	// A real protocol conversion error has a host trace, not an invented Lua line.
	const malformed = authored.replace("  assert(marker < 0, 'scenario debug assertion')", '  return { capture = 17 }');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: malformed }]);
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Scenario Lab: Debug Scenarios');
	await until(() => ide.scenarioRuns.inspectingFailure, 'scenario debug: host protocol exception retained');
	const hostFailure = ide.scenarioRuns.results.runs[0].items[0].failure!;
	check(hostFailure.stackTrace!.includes('capture label') && hostFailure.phase === 'update'
		&& hostFailure.location === undefined, 'host exception retains stack and phase without a fake guest location');
	await runPaletteCommand('Scenario Lab: Stop Scenarios');
	await until(() => !ide.scenarioRuns.active && tasks.ready, 'scenario debug: host failure Stop');

	await runPaletteCommand('Scenario Lab: Run Scenarios');
	await until(() => !ide.scenarioRuns.active && tasks.ready, 'scenario run: same host failure automatically restores');
	check(!ide.scenarioRuns.inspectingFailure && ide.scenarioRuns.results.runs[0].state === 'failed', 'Run retains its batch restoration policy');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: original }]);
	console.info('STUDIO: scenario breakpoint, locals, guest fault, host trace, Debug/Stop and Run restoration PASS');
	return { hostFrames: test.observations.hostFrames, debugFailures: 2 };
}
