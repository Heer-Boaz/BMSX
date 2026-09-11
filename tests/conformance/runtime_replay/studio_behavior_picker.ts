import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import type { EffectPropertyElement } from '../../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import type { WorkbenchTreeNode } from '../../../ide/workbench/ui/tree_view';
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

export async function revealLensOccurrence(test: StudioFixture, view: BehaviorLensViewState, key: string): Promise<void> {
	if (view.presentation.kind === 'properties') {
		const properties = view.presentation;
		const target = properties.nodesBySource.get(key)!;
		check(target !== undefined, 'property navigation: this authored occurrence has a retained property');
		const path: WorkbenchTreeNode<EffectPropertyElement>[] = [];
		for (let node: WorkbenchTreeNode<EffectPropertyElement> | null = target; node !== null; node = node.parent) path.push(node);
		await test.press('Home');
		for (let index = path.length - 1; index >= 0; index -= 1) {
			const node = path[index];
			const row = properties.tree.rows.indexOf(node);
			check(row >= 0, 'property navigation: expanded parent exposes this exact child');
			while (properties.tree.selectionIndex !== row) {
				const before = properties.tree.selectionIndex;
				await test.press(before < row ? 'ArrowDown' : 'ArrowUp');
				check(properties.tree.selectionIndex !== before, 'property navigation makes progress through the real keyboard owner');
			}
			if (index > 0 && node.collapsed) await test.press('ArrowRight');
		}
		check(view.selection?.rowKey === key, 'property navigation selects the original source occurrence, not its category');
		return;
	}
	if (view.presentation.kind === 'state-graph') {
		const lens = getActiveTab();
		if (lens.kind !== 'behavior_lens') throw new Error('FSM navigation requires its active input');
		await lens.graphLayout.settled;
		await test.frame();
		const graph = view.presentation;
		check(graph.layoutState.kind === 'ready', 'FSM navigation: actual layout completed');
		let owner = key;
		while (!graph.viewport.model.nodesBySource.has(owner)) owner = view.source.parentByRowKey.get(owner)!;
		await test.press('Home');
		const ownerIndex = graph.viewport.model.nodes.indexOf(graph.viewport.model.nodesBySource.get(owner)!);
		for (let step = 0; step < ownerIndex; step += 1) await test.press('ArrowDown');
		check(view.selection!.rowKey === owner, 'FSM navigation: traversal reaches the owning state');
		if (owner === key) return;
		await test.click(graph.actionBar.items[1].bounds);
		const inspector = (test.ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
		const index = inspector.model.rows.findIndex(row => {
			const source = row.element.stateSelection;
			return source !== undefined && source.kind === 'node' && source.rowKey === key;
		});
		check(inspector.visible && index >= 0, 'FSM navigation: owning state exposes the exact authored field');
		for (let step = 0; step < index; step += 1) await test.press('ArrowDown');
		await test.press('Enter');
		await test.clickTab(lens.id);
		check(view.selection!.rowKey === key, 'FSM navigation: Details preserves field source selection on returning to the graph');
		check(graph.viewport.selection === null, 'FSM navigation: a source-only field does not leave an unrelated card highlighted');
		return;
	}
	const ancestors: string[] = [];
	let parent = view.source.parentByRowKey.get(key)!;
	while (parent !== null) {
		ancestors.push(parent);
		parent = view.source.parentByRowKey.get(parent)!;
	}
	if (view.presentation.kind === 'graph') {
		const path = new Set([...ancestors, key]);
		await test.press('Home');
		while (view.selection?.rowKey !== key) {
			const before = view.selection?.rowKey;
			await test.press('ArrowDown');
			check(view.selection?.rowKey !== before, 'navigation: graph child navigation makes progress');
			while (!path.has(view.selection!.rowKey)) {
				const sibling = view.selection?.rowKey;
				await test.press('ArrowRight');
				check(view.selection?.rowKey !== sibling, 'navigation: graph sibling navigation reaches the authored path');
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
	check(lens.workingCopy === model && lens.view.source.nodesByRowKey.get(lens.view.selection!.rowKey)!.label === 'FSM picker.second',
		'behavior picker: selects the second registration, not the first definition or the current code cursor');
	const secondKey = lens.view.source.nodesByRowKey.get(lens.view.selection!.rowKey)!.rowKey;
	await click(lens.view.presentation.actionBar.items[0].bounds);
	check(harness.getActiveEditorDocument().model === model && harness.getActiveEditorDocument().view.cursorRow === secondLine
		&& harness.getActiveEditorDocument().view.cursorColumn === lines[secondLine].indexOf('picker_shared'),
		'behavior picker: Source opens the chosen registration reference, not the shared initializer');
	await runPaletteCommand('Behavior Lens: Open');
	await chooseBehavior(test, 'FSM picker.first');
	const first = getActiveTab();
	check(first.kind === 'behavior_lens' && first !== lens && first.workingCopy === model && first.title === 'FSM picker.first'
		&& lens.view.definitionRowKey === secondKey,
		'behavior picker: separate FSM inputs share one model without overwriting the earlier definition');
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
	const duplicate = getActiveTab();
	if (duplicate.kind !== 'behavior_lens') throw new Error('behavior picker: duplicate input missing');
	check(duplicate !== lens && duplicate.workingCopy === model, 'behavior picker: pointer selection opens a distinct definition view');
	const selected = duplicate.view.source.nodesByRowKey.get(duplicate.view.selection!.rowKey)!;
	check(selected.referenceRange!.start.line === lastLine + 1,
		'behavior picker: exact duplicate occurrence is selected and revealed');
	const focus = inputFocus.target;
	await runPaletteCommand('Behavior Lens: Open');
	await press('Escape');
	check(inputFocus.target === focus && getActiveTab() === duplicate
		&& duplicate.view.source.nodesByRowKey.get(duplicate.view.selection!.rowKey)! === selected,
		'behavior picker: cancellation preserves invoking focus and selection');
	await click(duplicate.view.presentation.actionBar.items[0].bounds);
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
