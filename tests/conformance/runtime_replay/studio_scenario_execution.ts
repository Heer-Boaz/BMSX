import { HostPauseReason } from '../../../hosts/common/execution_control';
import { inputFocus, type InputFocusTarget } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

/** Shipped scenario execution through the actual Studio command and host-input routes. */
export async function testStudioScenarioExecution(test: StudioFixture): Promise<void> {
	const { ide, runtime, execution, tasks, press, until, cycles, runPaletteCommand, frame, harness, movePointer, setPointerButton, setKey } = test;
	check(execution.userPaused && ide.editor.isActive, 'scenario: testing can start from explicitly paused gameplay');
	await runPaletteCommand('Scenario Lab: Open');
	const tab = ide.editor.editorParts.activeGroup.model.activeTab;
	if (tab.kind !== 'scenario_lab') throw new Error('scenario: actual Scenario Lab input missing');
	const view = tab.view;
	const index = view.testPane.rows.findIndex(row => row.kind === 'test'
		&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua');
	check(index >= 0, 'scenario: the actual pause/resume test is packaged');
	await press('Home');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	check(view.testPane.selectionIndex === index, 'scenario: keyboard selects the cinematic scenario');
	const canonicalMedia = ide.sources.currentBlua32Media;
	const cartridge = ide.sources.cartridgeSlots[0]!;
	const canonicalRom = cartridge.rom.bytes;
	const row = view.testPane.rows[index];
	if (row.kind !== 'test') throw new Error('scenario: selected item must be the pause/resume test');
	harness.openLuaSource('title_screen.lua', cartridge.contextId);
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
	harness.openLuaSource('title_screen.lua', cartridge.contextId);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'scenario: source repair restores the exact program text');
	await runPaletteCommand('Scenario Lab: Open');
	execution.setPauseReason(HostPauseReason.Fullscreen, true);
	await press('Tab'); check(view.focus === 'results', 'A01: Scenario Tab focuses the result control');
	const visited = new Set<InputFocusTarget | null>();
	while (!view.actionBar.hasFocus && !visited.has(inputFocus.target)) {
		visited.add(inputFocus.target);
		await press('Tab');
	}
	check(view.actionBar.hasFocus, 'A01: Scenario Tab reaches the toolbar before focus wraps');
	const toolbar = view.actionBar, run = toolbar.items.findIndex(item => item.command === 'scenarioLab.run');
	check(toolbar.items[run].enabled && toolbar.items[run].visible && !toolbar.items[run].overflowed,
		'A01: an enabled Run action is offered by the actual toolbar');
	await press('Home');
	for (let index = 0; toolbar.focusedIndex !== run && index < toolbar.items.length; index++) await press('ArrowRight');
	check(toolbar.focusedIndex === run, 'A01: keyboard selects Run, not the adjacent Play action');
	setKey('Enter', true); await frame();
	check(!view.runActive && execution.userPaused, 'A01: Run is not started on toolbar key down');
	setKey('Enter', false); await frame();
	await until(() => ide.scenarioRuns.session !== null && ide.scenarioRuns.session.execution !== null && view.runActive && tasks.ready, 'scenario: successful preparation starts the separate target');
	check(view.runActive && execution.userPaused && execution.paused && ide.editor.isActive,
		'scenario: explicit Run leaves authoring paused and Studio visible');
	const heldAt = cycles();
	await frame();
	check(cycles() === heldAt, 'scenario: starting a test does not release an independent fullscreen hold');
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	await until(() => !view.runActive && tasks.ready, 'scenario: pause/resume completes on its separate target');
	const passed = view.resultService.runs[0];
	check(passed.state === 'passed' && passed.items.length === 1 && passed.items[0].state === 'passed',
		`scenario: real pause/resume passes its assertions, not merely its host timeout: ${JSON.stringify(passed.items.map(item => ({
			state: item.state, failures: item.failures.map(failure => failure.message),
		})))}`);
	check(ide.sources.currentBlua32Media === canonicalMedia && ide.sources.cartridgeSlots[0]!.rom.bytes === canonicalRom
		&& ide.editor.editorParts.activeGroup.model.activeTab === tab && ide.editor.isActive,
		'scenario: completion leaves canonical media and originating input untouched');
	await runPaletteCommand('Scenario Lab: Rerun Scenarios');
	const rerun = view.resultService.runs[0];
	const result = rerun.items[0];
	await until(() => result.state === 'running', 'scenario: rerun reaches its real phase execution');
	check(ide.editor.isActive && view.runActive, 'scenario: Studio remains visible during a run');
	const pausedAt = cycles();
	await frame();
	check(cycles() === pausedAt, 'scenario: running tests does not advance authoring gameplay');
	const cancel = view.actionBar.items.find(item => item.command === 'scenarioLab.cancel')!;
	movePointer(cancel.bounds); await frame(); setPointerButton('pointer_primary', true); await frame();
	check(view.runActive, 'A01: Cancel Run waits for a physical release');
	movePointer({ left: view.layout.left, right: view.layout.left + 2, top: view.layout.bottom - 4, bottom: view.layout.bottom - 2 });
	setPointerButton('pointer_primary', false); await frame();
	check(view.runActive, 'A01: releasing outside Cancel leaves the run active');
	await test.click(cancel.bounds);
	await until(() => !view.runActive && tasks.ready, 'scenario: Cancel completes test-target cleanup');
	check(rerun.state === 'cancelled' && result.state === 'cancelled', 'scenario: Cancel retains its actual terminal result');
	check(ide.sources.currentBlua32Media === canonicalMedia && ide.sources.cartridgeSlots[0]!.rom.bytes === canonicalRom
		&& ide.editor.editorParts.activeGroup.model.activeTab === tab && ide.editor.isActive && !runtime.completionCallPending(),
		'scenario: cancellation leaves authoring media and completion state untouched');
}
