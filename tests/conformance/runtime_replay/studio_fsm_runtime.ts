import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorQuickPickItem } from '../../../ide/workbench/contrib/behavior_lens/quick_access';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { inspectStateMachineState, readStateMachineInstances, readStateMachineStates } from '../../../ide/workbench/contrib/behavior_lens/state_machine_runtime';
import { medianMilliseconds } from '../../helpers/performance';
import { check, type StudioFixture } from './studio_fixture';

/** Source discovery is deliberately the unexecuted, structurally different same-id registration. */
export async function openRuntimeStateMachinePicker(test: StudioFixture): Promise<void> {
	const { ide, press } = test;
	await test.runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	const picker = ide.editor.quickInput;
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!;
	const index = picker.model.list.rows.findIndex(row => {
		const item = row.item as BehaviorQuickPickItem;
		return item.registration.resource.path === model.resource.path
			&& model.buffer.getLineContent(item.registration.occurrenceRange.start.line - 1).includes('999');
	});
	check(index >= 0, 'runtime FSM: unexecuted source remains independently discoverable');
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	const input = getActiveTab();
	if (input.kind !== 'behavior_lens' || input.view.presentation.kind !== 'state-graph') throw new Error('runtime FSM: real source graph required');
	const live = input.view.presentation.actionBar.items.find(item => item.command === 'behaviorLens.inspectRuntimeStateMachine')!;
	await test.click(live.bounds);
	check(picker.visible && picker.title === 'FSM INSTANCES', 'runtime FSM: Live opens the shared instance picker');
	check(picker.model.list.rows.length === 3 && picker.model.list.rows.filter(row => row.item.label === 'walker').length === 2
		&& picker.model.list.rows.filter(row => row.item.label === 'companion').length === 1,
		'runtime FSM: actual roots include multiple machines on one actor, not the unattached definition or source candidates');
}

export async function openRuntimeStatePicker(test: StudioFixture, component: 'first' | 'second'): Promise<void> {
	await openRuntimeStateMachinePicker(test);
	const picker = test.ide.editor.quickInput;
	test.clipboard.text = `walker inspection.fsm.${component}`;
	await test.press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.detail === `OWNER ${component}_actor`,
		'runtime FSM: selected component and owner distinguish equal machine ids');
	await test.press('Enter');
	check(picker.visible && picker.title === 'STATES / walker', 'runtime FSM: accepting the instance opens its state scope');
	check(picker.model.list.rows.length === 7 && picker.model.list.rows.some(row => row.item.label === `${component}_actor.walker:/nest/listener/listening`)
		&& picker.model.list.rows.every(row => row.item.label.startsWith(`${component}_actor.walker`)),
		'runtime FSM: nested and concurrent states of only this instance, not the never-executed source topology');
}

export async function openRuntimeStateInspector(test: StudioFixture, component: 'first' | 'second', loadedRevision: number, path = ':/nest') {
	const { guest, runtime, cycles, press, frame } = test;
	const position = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes(), callbacks = guest.global('inspection_fsm_callback_count');
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!, version = model.version;
	await openRuntimeStatePicker(test, component);
	const picker = test.ide.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => row.item.label === `${component}_actor.walker${path}`);
	check(index >= 0, 'runtime FSM: choose a concrete state by its actual instance id');
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	const inspector = (test.ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && !picker.visible, 'runtime FSM: the selected state opens the retained inspector');
	const rows = inspector.model.rows;
	check(rows.find(row => row.element.label === 'LOADED DEFAULTS')!.element.value === `revision: ${loadedRevision}`,
		`runtime FSM: selected state reads its own definition ${loadedRevision}, even during partial rebind`);
	check(rows.find(row => row.element.label === 'INSTANCE DATA')!.element.value === `revision: ${path === '' ? 10 : component === 'first' ? 111 : 222}`,
		'runtime FSM: instance data survives independently of changed definition defaults');
	check(rows.find(row => row.element.label === 'CURRENT CHILD')!.element.value === (path === '' ? component === 'first' ? 'parked' : 'nest' : 'wait'),
		'runtime FSM: current is the retained child selection, also under an inactive ancestor');
	const first = rows[0], wrapped = first.value;
	for (let n = 0; n < 12; n += 1) await frame();
	check(inspector.model.rows[0] === first && first.value === wrapped, 'runtime FSM: idle frames retain both projection and measured text');
	check(model.version === version && cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap
		&& guest.global('inspection_fsm_callback_count') === callbacks, 'runtime FSM: selection and inspection do not execute guest code or mutate source/heap/time');
	return inspector;
}

export async function testRuntimeStateSource(test: StudioFixture): Promise<void> {
	const { press, cycles, guest, frame } = test;
	const model = editorTextModelService.get({ domain: 0, path: 'inspection_callbacks.lua' })!;
	const source = model.buffer.getText(), version = model.version, position = cycles(), callbacks = guest.global('inspection_fsm_callback_count');
	const inspector = await openRuntimeStateInspector(test, 'first', 10);
	await test.capture?.('fsm-state-instance');
	const defaults = inspector.model.rows.findIndex(row => row.element.label === 'LOADED DEFAULTS');
	for (let n = 0; n < defaults; n += 1) await press('ArrowDown');
	check(!inspector.isEnabled('propertyInspector.source'), 'runtime FSM: loaded defaults do not claim a source literal or a write target');
	check(inspector.model.viewport.offsetTop + inspector.model.rows[defaults].bottom <= inspector.model.viewport.bounds.bottom,
		'runtime FSM: keyboard selection reveals the default value, not just its header');
	await test.capture?.('fsm-loaded-definition');
	const eventPlan = inspector.model.rows.find(item => item.element.label === 'EVENT advance / EXECUTION TARGET')!.element;
	check(eventPlan.source === undefined && eventPlan.value.includes('parked') && eventPlan.description.startsWith('COMPILED TRANSITION'),
		'runtime FSM: a compiled path plan is visible but has no invented path expression or source range');
	for (const [label, functionName] of [['UPDATE', 'update'], ['EVENT redirect / EXECUTION TARGET', 'redirect'], ['INPUT a[jp] / EXECUTION TARGET', 'redirect']] as const) {
		const current = label === 'UPDATE' ? inspector : await openRuntimeStateInspector(test, 'second', 10);
		await press('Home');
		const row = current.model.rows.findIndex(item => item.element.label === label);
		for (let n = 0; n < row; n += 1) await press('ArrowDown');
		check(current.isEnabled('propertyInspector.source'), 'runtime FSM: retained update and compiled event closures expose their actual call target');
		await test.click(current.actionBar.items[0].bounds, 6);
		const line = source.split('\n').findIndex(text => text.includes(`function callbacks.${functionName}`));
		check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === line && activeCodeEditor.view.cursorColumn === 0,
			'runtime FSM: callback Source opens the other file at the actual function, not cart.lua or the same-id registration');
		check(model.version === version && cycles() === position && guest.global('inspection_fsm_callback_count') === callbacks,
			'runtime FSM: held Source is only navigation');
	}
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending callback\n' }]);
	const changed = await openRuntimeStateInspector(test, 'second', 10);
	const row = changed.model.rows.findIndex(item => item.element.label === 'UPDATE');
	for (let n = 0; n < row; n += 1) await press('ArrowDown');
	check(!changed.isEnabled('propertyInspector.source'), 'runtime FSM: mismatched callback bytes disable Source, not live values');
	model.undo(); await frame();
	check(changed.isEnabled('propertyInspector.source'), 'runtime FSM: exact callback Undo restores the real source link');
	await press('Escape');
	await test.runPaletteCommand('State Machine: Inspect Runtime Instance');
	check(test.ide.editor.quickInput.title === 'FSM INSTANCES', 'runtime FSM: the palette uses the focused graph command route');
	await press('Escape');
	await press('ContextMenu');
	const menu = test.ide.editor.contextMenu;
	const liveIndex = menu.model.rows.findIndex(item => item.command === 'behaviorLens.inspectRuntimeStateMachine');
	check(menu.visible && liveIndex >= 0 && menu.model.rows[liveIndex].enabled, 'runtime FSM: the selected state context menu shares Live admission');
	for (let n = 0; n < liveIndex; n += 1) await press('ArrowDown');
	await press('Enter');
	check(!menu.visible && test.ide.editor.quickInput.title === 'FSM INSTANCES', 'runtime FSM: context Live enters the same instance scope');
	await press('Escape');
	const instances = readStateMachineInstances(test.ide.sources, guest, 0);
	const machine = instances.items.find(item => item.description === 'COMPONENT inspection.fsm.first')!;
	const states = readStateMachineStates(guest, machine.machine);
	const state = states.find(item => item.label === 'first_actor.walker:/nest')!;
	console.info(`STUDIO: FSM read projection medians (ms) ${JSON.stringify({
		roots: medianMilliseconds(() => { readStateMachineInstances(test.ide.sources, guest, 0); }),
		states: medianMilliseconds(() => { readStateMachineStates(guest, machine.machine); }),
		properties: medianMilliseconds(() => { inspectStateMachineState(test.ide.sources, guest, machine, state); }),
		rootCount: instances.items.length, stateCount: states.length,
	})}`);
}
