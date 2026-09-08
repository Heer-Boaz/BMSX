import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { HostPauseReason } from '../../../hosts/common/execution_control';
import { check, type StudioFixture } from './studio_fixture';

/** Shipped scenario execution through the actual Studio command and host-input routes. */
export async function testStudioScenarioExecution(test: StudioFixture): Promise<void> {
	const { ide, runtime, execution, tasks, press, until, cycles, runPaletteCommand, frame, harness, clipboard } = test;
	check(execution.userPaused && ide.editor.isActive, 'scenario: testing can start from explicitly paused gameplay');
	await runPaletteCommand('Scenario Lab: Open');
	const tab = getActiveTab();
	if (tab.kind !== 'scenario_lab') throw new Error('scenario: actual Scenario Lab input missing');
	const view = tab.view;
	const index = view.testPane.rows.findIndex(row => row.kind === 'test'
		&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_cinematic_flow_assert.lua');
	check(index >= 0, 'scenario: the actual cinematic test is packaged');
	await press('Home');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	check(view.testPane.selectionIndex === index, 'scenario: keyboard selects the cinematic scenario');
	const canonicalMedia = ide.sources.currentBlua32Media;
	const canonicalRom = ide.sources.cartridgeSlots[0]!.rom.bytes;
	const row = view.testPane.rows[index];
	if (row.kind !== 'test') throw new Error('scenario: selected item must be the cinematic test');
	harness.openLuaSource(row.test.resource.path);
	const model = harness.getActiveEditorDocument().model;
	const source = model.buffer.getText();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\nend end\n' }]);
	await runPaletteCommand('Scenario Lab: Open');
	const beforeRejected = cycles();
	await runPaletteCommand('Scenario Lab: Run Scenarios');
	await until(() => !view.runActive && tasks.ready, 'scenario: invalid source preparation reports failure');
	check(view.resultService.runs[0].state === 'failed' && execution.userPaused && cycles() === beforeRejected
		&& ide.sources.currentBlua32Media === canonicalMedia && ide.sources.cartridgeSlots[0]!.rom.bytes === canonicalRom,
		'scenario: failed preparation cannot resume or replace paused gameplay');
	harness.openLuaSource(row.test.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'scenario: source repair restores the exact original test');
	await runPaletteCommand('Scenario Lab: Open');
	execution.setPauseReason(HostPauseReason.Fullscreen, true);
	await runPaletteCommand('Scenario Lab: Run Scenarios');
	await until(() => !execution.userPaused && tasks.ready, 'scenario: successful preparation starts the explicit Run');
	check(view.runActive && execution.paused && !ide.editor.isActive,
		'scenario: explicit Run starts execution from paused gameplay');
	const heldAt = cycles();
	await frame();
	check(cycles() === heldAt, 'scenario: starting a test does not release an independent fullscreen hold');
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	await until(() => !view.runActive && tasks.ready, 'scenario: cinematic completes and restores canonical media');
	const passed = view.resultService.runs[0];
	check(passed.state === 'passed' && passed.items.length === 1 && passed.items[0].state === 'passed',
		'scenario: cinematic passes its assertions, not merely its host timeout');
	check(ide.sources.currentBlua32Media === canonicalMedia && ide.sources.cartridgeSlots[0]!.rom.bytes === canonicalRom
		&& getActiveTab() === tab && ide.editor.isActive,
		'scenario: completion restores the canonical media and originating workbench input');
	await runPaletteCommand('Scenario Lab: Rerun Scenarios');
	const rerun = view.resultService.runs[0];
	const result = rerun.items[0];
	await until(() => result.logs.length > 0 && result.logs.at(result.logs.length - 1).text === 'gameplay ready',
		'scenario: rerun reaches its real guest setup');
	await press('ControlRight', 'ShiftRight');
	check(ide.editor.isActive && view.runActive, 'scenario: host IDE chord interrupts the running cinematic');
	const pausedAt = cycles();
	await frame();
	check(cycles() === pausedAt, 'scenario: workbench focus suspends the test without extra guest calls');
	await runPaletteCommand('Scenario Lab: Cancel Run');
	await until(() => !view.runActive && tasks.ready, 'scenario: Cancel completes canonical media restoration');
	check(rerun.state === 'cancelled' && result.state === 'cancelled', 'scenario: Cancel retains its actual terminal result');
	check(ide.sources.currentBlua32Media === canonicalMedia && ide.sources.cartridgeSlots[0]!.rom.bytes === canonicalRom
		&& getActiveTab() === tab && ide.editor.isActive && !runtime.completionCallPending(),
		'scenario: cancellation restores the canonical media without a stale completion call');
	await runPaletteCommand('Run: Pause');
	await runPaletteCommand('Scene Editor: Open');
	const picker = ide.editor.quickInput;
	check(picker.visible && picker.title === 'SCENE EDITOR', 'scenario: canonical source views remain available after Cancel');
	clipboard.text = 'scenes/root.lua';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.label === clipboard.text,
		'scenario: the canonical scene source is still discoverable');
	await press('Enter');
	check(getActiveTab().kind === 'scene_editor' && execution.userPaused,
		'scenario: choosing the scene returns to authoring without resuming gameplay');
}
