import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';

export async function testStudioBehaviorKinds(test: StudioFixture): Promise<void> {
	const { ide, harness, runPaletteCommand, press, clipboard, cycles } = test;
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	const picker = ide.editor.quickInput;
	console.info('STUDIO: typed ActionEffect/FSM/BT choices share the source lens and ordinary navigation');
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	check(picker.model.items.length > 0 && picker.model.items.every(row => row.label.startsWith('EFFECT ')),
		'behavior kinds: ActionEffects are discoverable from a non-code pane, with no FSM or BT entries');
	const entries = picker.model.items.slice();
	await press('KeyQ');
	await press('Backspace');
	check(picker.model.items.every((row, index) => row === entries[index]) && picker.model.list.rows.length === entries.length,
		'behavior kinds: query changes retain the typed catalog instead of rebuilding or losing the kind constraint');
	await chooseBehavior(test, 'EFFECT fire_salvo', 'ACTIONEFFECTS');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('behavior kinds: selected ActionEffect lens missing');
	const model = lens.workingCopy;
	const properties = lens.view.presentation;
	if (properties.kind !== 'properties') throw new Error('behavior kinds: ActionEffect must open its property presentation');
	check(model.resource.path === 'player/actioneffects.lua'
		&& lens.view.source.nodesByRowKey.get(lens.view.definitionRowKey!)!.behaviorKind === 'action_effect',
		'behavior kinds: effect selection reveals the actual definition in its resource-owned model');
	const period = properties.tree.rows.find(row => row.element.kind === 'property' && row.element.source.label.startsWith('period_ms ='))!;
	check(period !== undefined && properties.tree.rows.some(row => row.element.kind === 'property' && row.element.source.label.startsWith('handler =')),
		'behavior kinds: the real effect exposes its authored period and handler');
	if (period.element.kind !== 'property') throw new Error('behavior kinds: period must retain its authored field');
	const node = period.element.source;
	await revealLensOccurrence(test, lens.view, node.rowKey);
	await runPaletteCommand('Behavior Lens: Open Source');
	const document = harness.getActiveEditorDocument();
	check(document.model === model && document.view.cursorRow === node.authoredRange.start.line - 1
		&& document.view.cursorColumn === node.authoredRange.start.column - 1,
		'behavior kinds: Source reaches the chosen effect field, not cart.lua or the first registration');
	const original = model.buffer.getText();
	const expression = 'player_fire_repeat_updates * clock.gameplay_delta_milliseconds()';
	check(original.includes(expression), 'behavior kinds: the actual cart expression is edited');
	model.pushEditOperations([{ offset: original.indexOf(expression), deleteLength: expression.length, text: '80' }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fire_salvo', 'ACTIONEFFECTS');
	check(getActiveTab() === lens && properties.tree.rows.some(row => row.element.kind === 'property' && row.element.source.label === 'period_ms = 80'),
		'behavior kinds: the same ActionEffect lens reflects dirty canonical Lua without a new document or runtime edit');
	await runPaletteCommand('Behavior Lens: Open Source');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'behavior kinds: ordinary source Undo restores the effect definition');
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fire_salvo', 'ACTIONEFFECTS');
	check(!properties.tree.rows.some(row => row.element.kind === 'property' && row.element.source.label === 'period_ms = 80'), 'behavior kinds: source Undo refreshes the retained lens');
	const focus = inputFocus.target;
	const selected = lens.view.selection;
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	check(picker.title === 'STATE MACHINES' && picker.model.items.length > 0
		&& picker.model.items.every(row => row.label.startsWith('FSM ')), 'behavior kinds: FSM command applies a kind constraint');
	clipboard.text = 'EFFECT fire_salvo';
	await press('ControlLeft', 'KeyV');
	await press('Enter');
	check(picker.visible && picker.model.list.selectionIndex === -1, 'behavior kinds: an effect query cannot bypass the FSM kind');
	await press('Escape');
	check(inputFocus.target === focus && getActiveTab() === lens && lens.view.selection === selected,
		'behavior kinds: cancellation preserves the actual ActionEffect view, focus and selection');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm', 'STATE MACHINES');
	const fsm = getActiveTab();
	check(fsm.kind === 'behavior_lens' && fsm.view.source.nodesByRowKey.get(fsm.view.selection!.rowKey)!.behaviorKind === 'state_machine',
		'behavior kinds: typed FSM selection reaches its definition from the effect lens');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	check(picker.title === 'BEHAVIOR TREES' && picker.model.items.length > 0
		&& picker.model.items.every(row => row.label.startsWith('BT ')), 'behavior kinds: BT command applies the other producer kind');
	await chooseBehavior(test, 'BT moon_tree.id', 'BEHAVIOR TREES');
	const bt = getActiveTab();
	check(bt.kind === 'behavior_lens' && bt.view.presentation.kind === 'graph'
		&& bt.view.presentation.viewport.selection?.kind === 'node'
		&& bt.view.presentation.viewport.selection.source.behaviorKind === 'behavior_tree',
		'behavior kinds: a computed BT id remains navigable by its actual source registration');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'behavior kinds: view selection and source edits neither advance the paused machine nor change installed media');
	harness.openLuaSource('scenes/root.lua');
}

export async function presentActionEffects(test: StudioFixture): Promise<void> {
	await test.runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fire_salvo', 'ACTIONEFFECTS');
	await test.frame();
}
