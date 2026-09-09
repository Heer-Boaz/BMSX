import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Accept a unique behavior through the actual shared query field and keyboard. */
export async function chooseBehavior(test: StudioFixture, label: string, title = 'BEHAVIOR LENS'): Promise<void> {
	const picker = test.ide.editor.quickInput;
	check(picker.visible && picker.title === title, 'behavior picker: the command offers registrations');
	test.clipboard.text = label;
	await test.press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.label === label,
		`behavior picker: logical behavior ${label} is independently selectable`);
	await test.press('Enter');
}

export function behaviorOutline(view: BehaviorLensViewState) {
	if (view.presentation.kind !== 'outline') throw new Error('behavior: expected the FSM/ActionEffect outline');
	return view.presentation;
}

export async function revealLensOccurrence(test: StudioFixture, view: BehaviorLensViewState, key: string): Promise<void> {
	const ancestors: string[] = [];
	let parent = view.parentRowKeyByRowKey.get(key)!;
	while (parent !== null) {
		ancestors.push(parent);
		parent = view.parentRowKeyByRowKey.get(parent)!;
	}
	if (view.presentation.kind === 'graph') {
		const path = new Set([...ancestors, key]);
		await test.press('Home');
		while (view.selectedRowKey !== key) {
			const before = view.selectedRowKey;
			await test.press('ArrowDown');
			check(view.selectedRowKey !== before, 'navigation: graph child navigation makes progress');
			while (!path.has(view.selectedRowKey!)) {
				const sibling = view.selectedRowKey;
				await test.press('ArrowRight');
				check(view.selectedRowKey !== sibling, 'navigation: graph sibling navigation reaches the authored path');
			}
		}
		return;
	}
	const outline = view.presentation;
	for (let index = ancestors.length - 1; index >= -1; index -= 1) {
		const target = index === -1 ? key : ancestors[index];
		const row = outline.rows.findIndex(entry => entry.node.rowKey === target);
		check(row >= 0, 'navigation: expanded parent exposes its source child');
		while (outline.selectionIndex !== row) await test.press(outline.selectionIndex < row ? 'ArrowDown' : 'ArrowUp');
		if (index !== -1 && !outline.rows[row].expanded) await test.press('ArrowRight');
	}
}


export async function testStudioBehaviorPicker(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, clipboard, cycles, runPaletteCommand } = test;
	console.info('STUDIO: behavior-level selection of unsaved FSMs sharing a Lua file and initializer');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('title_screen.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const insertion = [
		'local picker_shared<const> = { states = { idle = {} } }',
		"fsm_library.register('picker.first', picker_shared)",
		"fsm_library.register('picker.second', picker_shared)",
		"fsm_library.register('picker.same', picker_shared)",
		"fsm_library.register('picker.same', picker_shared)",
		'',
	].join('\n');
	model.pushEditOperations([{ offset: original.lastIndexOf('\nreturn {') + 1, deleteLength: 0, text: insertion }]);
	const lines = model.buffer.getText().split('\n');
	const secondLine = lines.findIndex(line => line.startsWith("fsm_library.register('picker.second'"));
	const lastLine = lines.findLastIndex(line => line.startsWith("fsm_library.register('picker.same'"));
	await runPaletteCommand('Behavior Lens: Open');
	await chooseBehavior(test, 'FSM picker.second');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('behavior picker: selected lens missing');
	check(lens.workingCopy === model && behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node.label === "FSM 'picker.second'",
		'behavior picker: selects the second registration, not the first definition or the current code cursor');
	const secondKey = behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node.rowKey;
	await click(lens.view.presentation.actionBar.items[0].bounds);
	check(harness.getActiveEditorDocument().model === model && harness.getActiveEditorDocument().view.cursorRow === secondLine
		&& harness.getActiveEditorDocument().view.cursorColumn === lines[secondLine].indexOf('picker_shared'),
		'behavior picker: Source opens the chosen registration reference, not the shared initializer');
	await runPaletteCommand('Behavior Lens: Open');
	await chooseBehavior(test, 'FSM picker.first');
	check(getActiveTab() === lens && behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node.label === "FSM 'picker.first'"
		&& behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node.rowKey !== secondKey,
		'behavior picker: another FSM in the same document reuses the model and selects its own root');
	await runPaletteCommand('Scenario Lab: Open');
	await runPaletteCommand('Behavior Lens: Open');
	const picker = ide.editor.quickInput;
	clipboard.text = 'FSM picker.same';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 2
		&& picker.model.list.rows[0].item.description === 'title_screen.lua'
		&& picker.model.list.rows[0].item.detail !== picker.model.list.rows[1].item.detail,
		'behavior picker: duplicate ids remain two source-located choices from a non-code pane');
	const layout = picker.model.list.layout;
	await click({ left: layout.contentLeft, right: layout.contentRight,
		top: layout.contentTop + layout.rowHeight, bottom: layout.contentTop + layout.rowHeight * 2 }, 3);
	check(getActiveTab() === lens, 'behavior picker: pointer selection reuses the retained lens');
	const selected = behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node;
	check(selected.referenceRange!.start.line === lastLine + 1 && behaviorOutline(lens.view).selectionIndex >= behaviorOutline(lens.view).scroll
		&& behaviorOutline(lens.view).selectionIndex < behaviorOutline(lens.view).scroll + behaviorOutline(lens.view).layout.visibleRowCount,
		'behavior picker: exact duplicate occurrence is selected and revealed');
	const focus = inputFocus.target;
	await runPaletteCommand('Behavior Lens: Open');
	await press('Escape');
	check(inputFocus.target === focus && getActiveTab() === lens
		&& behaviorOutline(lens.view).rows[behaviorOutline(lens.view).selectionIndex].node === selected,
		'behavior picker: cancellation preserves invoking focus and selection');
	await click(lens.view.presentation.actionBar.items[0].bounds);
	check(harness.getActiveEditorDocument().view.cursorRow === lastLine, 'behavior picker: duplicate Source goes to its own call');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'behavior picker: ordinary source Undo removes the temporary authored definitions');
	await runPaletteCommand('Behavior Lens: Open');
	clipboard.text = 'picker.';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.selectionIndex === -1, 'behavior picker: catalog consumes the undone source generation');
	await press('Enter');
	check(picker.visible, 'behavior picker: empty results cannot open an arbitrary file or behavior');
	await press('Escape');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'behavior picker: source discovery and selection neither run nor replace the machine');
	harness.openLuaSource('scenes/root.lua');
}
