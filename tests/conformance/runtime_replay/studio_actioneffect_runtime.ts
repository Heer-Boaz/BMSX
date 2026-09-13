import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorQuickPickItem } from '../../../ide/workbench/contrib/behavior_lens/quick_access';
import { check, type StudioFixture } from './studio_fixture';

/** Deliberately open the never-executed same-id registration, not the actual definition producer. */
export async function openRuntimeEffectLens(test: StudioFixture) {
	const { ide, press, runPaletteCommand } = test;
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	const picker = ide.editor.quickInput;
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!;
	const index = picker.model.list.rows.findIndex(row => {
		const item = row.item as BehaviorQuickPickItem;
		return item.registration.resource.path === 'cart.lua'
			&& model.buffer.getLineContent(item.registration.occurrenceRange.start.line - 1).includes('999');
	});
	check(index >= 0, 'runtime effect: source catalog still offers the unexecuted registration');
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	const input = getActiveTab();
	if (input.kind !== 'behavior_lens' || input.view.presentation.kind !== 'properties') throw new Error('runtime effect: actual ActionEffect lens required');
	return input;
}

export async function openRuntimeEffectPicker(test: StudioFixture): Promise<void> {
	const input = await openRuntimeEffectLens(test);
	const picker = test.ide.editor.quickInput;
	const live = input.view.presentation.actionBar.items.find(item => item.command === 'behaviorLens.inspectRuntimeEffect')!;
	await test.click(live.bounds);
	check(picker.visible && picker.title === 'GRANTED ACTIONEFFECTS', 'runtime effect: real Live action opens the shared picker');
	check(picker.model.list.rows.length === 2 && picker.model.list.rows.every(row => row.item.label === 'pulse'),
		'runtime effect: choices come from two actual grants, neither ungranted nor unexecuted definitions');
}

/** The generic live harness drives the real picker, retained inspector and source navigator. */
export async function openRuntimeEffectInspector(test: StudioFixture, component: 'first' | 'second', period: number) {
	const { ide, guest, runtime, cycles, press, frame } = test;
	const position = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes();
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!, version = model.version;
	await openRuntimeEffectPicker(test);
	const picker = ide.editor.quickInput;
	test.clipboard.text = `inspection.${component}`;
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.description === `COMPONENT inspection.${component}`,
		'runtime effect: same effect id on different components remains selectable');
	check(picker.model.list.rows[0].item.detail === `OWNER ${component}_actor`, 'runtime effect: choices expose the actual owner, not only a component number');
	await press('Enter');
	const inspector = (ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && !picker.visible, 'runtime effect: selected instance opens the existing inspector');
	const rows = inspector.model.rows;
	check(rows.find(row => row.element.label === 'PERIOD')!.element.value === String(period), 'runtime effect: actual loaded period, not the source literal 999');
	const state = rows[0].element.value;
	check(state.includes(`ACTIVE COUNT: ${component === 'first' ? 1 : 0}`)
		&& state.includes(`COOLDOWN UNTIL (MS): ${component === 'first' ? 107 : 207}`), 'runtime effect: per-instance state is separate from its definition');
	const first = rows[0], wrapped = first.value;
	for (let n = 0; n < 20; n += 1) await frame();
	check(inspector.model.rows[0] === first && first.value === wrapped, 'runtime effect: stationary frames retain projected and measured rows');
	check(model.version === version && cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap
		&& guest.global('inspection_callback_count') === 0, 'runtime effect: inspection does not mutate text, heap, guest time or callbacks');
	return inspector;
}

export async function testRuntimeEffectSource(test: StudioFixture): Promise<void> {
	const { ide, press, frame, cycles, harness } = test;
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!;
	const original = model.buffer.getText(), version = model.version, position = cycles();
	const inspector = await openRuntimeEffectInspector(test, 'first', 20);
	await test.capture?.('actioneffect-instance');
	const period = inspector.model.rows.findIndex(row => row.element.label === 'PERIOD');
	for (let i = 0; i < period; i += 1) await press('ArrowDown');
	check(!inspector.isEnabled('propertyInspector.source'), 'runtime effect: a value does not claim the registration or a scalar write target');
	await press('Home');
	const handler = inspector.model.rows.findIndex(row => row.element.label === 'HANDLER');
	for (let i = 0; i < handler; i += 1) await press('ArrowDown');
	check(inspector.isEnabled('propertyInspector.source'), 'runtime effect: actual closure identity offers its own source');
	await test.click(inspector.actionBar.items[0].bounds, 6);
	const row = original.split('\n').findIndex(line => line.includes('handler = function'));
	check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === row
		&& activeCodeEditor.view.cursorColumn === original.split('\n')[row].indexOf('function'), 'runtime effect: held Source opens the actual callback, not the never-executed registration');
	check(model.version === version && cycles() === position, 'runtime effect: Source is navigation, not a source/guest edit');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending source\n' }]);
	const changed = await openRuntimeEffectInspector(test, 'first', 20);
	const selected = changed.model.rows.findIndex(row => row.element.label === 'HANDLER');
	for (let i = 0; i < selected; i += 1) await press('ArrowDown');
	check(!changed.isEnabled('propertyInspector.source'), 'runtime effect: dirty bytes cannot receive an installed callback range');
	model.undo(); await frame();
	check(changed.isEnabled('propertyInspector.source'), 'runtime effect: exact source Undo makes the callback link available again');
	await press('Escape');
	harness.openLuaSource(model.resource.path); await frame();
	check(model.buffer.getText() === original && ide.editor.isActive, 'runtime effect: normal Back restores authoring without losing the runtime state');
}
