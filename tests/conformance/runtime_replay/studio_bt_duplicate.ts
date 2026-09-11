import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_ORDER_SOURCE } from '../../helpers/behavior_order_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Real command/focus/capture/history routes over an independent authored Lua working copy. */
export async function testStudioBtDuplicate(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, cycles, runPaletteCommand, setKey, movePointer, setPointerButton } = test;
	console.info('STUDIO: BT duplicate / retained selection / shared source history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_ORDER_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.order', 'BEHAVIOR TREES');
	let lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT duplication requires the concrete graph');
	let graph = lens.view.presentation;
	let viewport = graph.viewport;
	const children = () => viewport.model.nodes[0].children[0].children;
	const duplicate = 'behaviorLens.duplicateChild';
	const button = graph.actionBar.items.find(item => item.command === duplicate)!;
	const sourceButton = graph.actionBar.items.find(item => item.command === 'behaviorLens.source')!;
	for (const item of graph.actionBar.items) {
		check(item.bounds.left >= viewport.bounds.left && item.bounds.right <= viewport.bounds.right,
			'BT duplicate: all shared action-bar buttons fit the actual tiny-font viewport');
	}
	let version = model.version;
	check(!ide.editor.commands.isEnabled(duplicate), 'BT duplicate: a registration is not a list member');
	await press('ControlLeft', 'KeyD');
	check(model.version === version, 'BT duplicate: root shortcut does not duplicate the registration');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await press('Space');
	check(viewport.selection === children()[1] && children()[1].children.length === 2 && ide.editor.commands.isEnabled(duplicate),
		'BT duplicate: expanded source member is selected through physical navigation');
	console.info('STUDIO: BT duplicate action ready for visual inspection');
	await click(button.bounds, 6);
	const duplicated = BT_ORDER_SOURCE.replace('\t-- nested documentation', '\tnested;\n\t-- nested documentation');
	check(model.version === version + 1 && model.buffer.getText() === duplicated && children().length === 4
		&& viewport.selection === children()[2] && children()[2].children.length === 2 && children()[1].children.length === 2,
		'BT duplicate: held action makes one copy, retains the second occurrence and its expanded subtree');
	check(lens.view.definitionRowKey === lens.view.document.definitions[0].rowKey,
		'BT duplicate: the chosen registration remains selected');
	console.info('STUDIO: BT duplicated child ready for visual inspection');
	const range = children()[2].source.occurrenceRange;
	await click(sourceButton.bounds, 6);
	check(getActiveTab() === code && model.version === version + 1 && !hasSelection()
		&& activeCodeEditor.view.cursorRow === range.start.line - 1 && activeCodeEditor.view.cursorColumn === range.start.column - 1,
		'BT duplicate: held Source navigates to the second occurrence without another source edit');
	check(!ide.editor.commands.isEnabled(duplicate), 'BT duplicate: code focus does not inherit graph commands');
	await press('ControlLeft', 'KeyD');
	check(model.version === version + 1, 'BT duplicate: code Ctrl+D does not edit the hidden graph');
	const hiddenDocument = lens.view.document;
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && lens.view.document === hiddenDocument,
		'BT duplicate: hidden document Undo does not eagerly reproject a graph');
	await test.clickTab(lens.id);
	check(viewport.selection === children()[1] && children()[1].children.length === 2,
		'BT duplicate: Undo follows retained source back to the original expanded occurrence');
	await runPaletteCommand('Edit: Redo');
	check(model.buffer.getText() === duplicated && viewport.selection === children()[2] && children()[2].children.length === 2,
		'BT duplicate: graph palette Redo uses ordinary document history and source correspondence');
	await press('ControlLeft', 'KeyZ');
	version = model.version;
	setKey('ControlLeft', true); setKey('KeyD', true);
	for (let index = 0; index < 20; index += 1) await frame();
	setKey('KeyD', false); setKey('ControlLeft', false); await frame();
	check(model.version === version + 1 && model.buffer.getText() === duplicated, 'BT duplicate: a held shortcut never repeats the source edit');
	await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Behavior Lens: Duplicate BT Child');
	check(model.buffer.getText() === duplicated && viewport.selection === children()[2], 'BT duplicate: palette acts on its originating graph selection');
	await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.weighted-order', 'BEHAVIOR TREES');
	const nextDefinition2 = getActiveTab();
	if (nextDefinition2.kind !== 'behavior_lens' || nextDefinition2.view.presentation.kind !== 'graph') throw new Error('BT: separate definition graph missing');
	check(nextDefinition2 !== lens && nextDefinition2.workingCopy === model, 'BT: another definition has its own input and the same working copy');
	lens = nextDefinition2;
	graph = nextDefinition2.view.presentation;
	viewport = graph.viewport;
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	const edge = viewport.model.edges.find(edge => edge.child === children()[1])!;
	const x = edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX;
	const y = edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY;
	await click({ left: x, right: x, top: y, bottom: y });
	check(viewport.selection === edge, 'BT duplicate: pointer selects the weighted wrapper connection');
	version = model.version;
	await press('ControlLeft', 'ShiftLeft', 'KeyD');
	check(model.version === version, 'BT duplicate: extra modifiers do not authorize a copy');
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	await frame();
	check(!ide.editor.commands.isEnabled(duplicate), 'BT duplicate: readonly source has no mutation command');
	await press('ControlLeft', 'KeyD');
	ide.editor.behaviorLens.duplicateSelectedChild();
	check(model.version === version, 'BT duplicate: readonly admission also holds at the edit consumer');
	model.refreshResource(resource);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	check(!ide.editor.commands.isEnabled(duplicate), 'BT duplicate: old geometry cannot authorize a new source generation');
	await frame();
	check(!ide.editor.commands.isEnabled(duplicate), 'BT duplicate: recovered syntax has no complete source field');
	ide.editor.behaviorLens.duplicateSelectedChild();
	check(model.buffer.getText() === BT_ORDER_SOURCE + '\n@', 'BT duplicate: recovery is not edited');
	await press('ControlLeft', 'KeyZ');
	await press('MetaLeft', 'KeyD');
	const choice = '\t{ weight = 9, child = nested },';
	check(model.buffer.getText() === BT_ORDER_SOURCE.replace(choice, `${choice}\n${choice}`)
		&& viewport.selection?.kind === 'edge' && viewport.selection.child === children()[2]
		&& readLuaSourceRange(model.buffer, viewport.selection.range) === '{ weight = 9, child = nested }',
		'BT duplicate: Cmd+D copies the complete weighted choice and preserves edge source selection');
	await press('ControlLeft', 'KeyZ');
	const cardPoint = (index: number) => {
		const node = children()[index];
		const x = (node.bounds.left + node.bounds.right) / 2 + viewport.bounds.left - viewport.scrollX;
		const y = node.bounds.top + node.headerHeight / 2 + viewport.bounds.top - viewport.scrollY;
		return { left: x, right: x, top: y, bottom: y };
	};
	for (const duplicateWhileHeld of [false, true]) {
		movePointer(cardPoint(0)); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(cardPoint(2)); await frame();
		version = model.version;
		if (duplicateWhileHeld) await press('ControlLeft', 'KeyD');
		setPointerButton('pointer_primary', false); await frame();
		check(model.version === version + 1, 'BT duplicate: one captured gesture produces one source edit');
		if (duplicateWhileHeld) {
			const field = '\t{ weight = 1, child = leaf },';
			check(model.buffer.getText() === BT_ORDER_SOURCE.replace(field, `${field}\n${field}`) && viewport.selection === children()[1],
				'BT duplicate: source edit cancels capture; release does not apply the stale reorder preview');
		} else {
			check(children()[2].lines.find(line => line.startsWith('CHOICE')) === 'CHOICE  W=1', 'BT duplicate: the identical uninterrupted gesture really performs a reorder');
		}
		await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT duplicate: no extra gesture history');
	}
	const retained = viewport.model;
	const document = lens.view.document;
	version = model.version;
	for (let index = 0; index < 30; index += 1) await frame();
	check(viewport.model === retained && lens.view.document === document && model.version === version,
		'BT duplicate: warm command admission does not rebuild source or geometry');
	await test.clickTab(code.id);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'BT duplicate: all fixture edits undo without changing the paused machine or installed media');
}
