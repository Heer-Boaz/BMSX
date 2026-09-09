import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_ORDER_SOURCE } from '../../helpers/behavior_order_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical source-removal commands, not a feature-local graph model or mock keyboard route. */
export async function testStudioBtRemove(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, cycles, runPaletteCommand, movePointer, setPointerButton } = test;
	console.info('STUDIO: BT remove / focus / shared source history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_ORDER_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.order', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT removal requires the concrete graph');
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	const children = () => viewport.model.nodes[0].children[0].children;
	const remove = 'behaviorLens.removeChild';
	const button = graph.actionBar.items.find(item => item.command === remove)!;
	const sourceButton = graph.actionBar.items.find(item => item.command === 'behaviorLens.source')!;
	check(button.bounds.left >= viewport.bounds.left && button.bounds.right <= viewport.bounds.right,
		'BT removal: shared action-bar fits the actual tiny-font viewport');
	let version = model.version;
	check(!ide.editor.commands.isEnabled(remove), 'BT removal: registration is not a list member');
	await press('Delete');
	check(model.version === version, 'BT removal: root Delete cannot remove the registration');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	check(viewport.selection === children()[1] && ide.editor.commands.isEnabled(remove), 'BT removal: keyboard selects the actual source member');
	const selected = children()[1];
	await click(sourceButton.bounds, 6);
	check(getActiveTab() === code && model.version === version && !hasSelection()
		&& activeCodeEditor.view.cursorRow === selected.source.occurrenceRange.start.line - 1
		&& activeCodeEditor.view.cursorColumn === selected.source.occurrenceRange.start.column - 1,
		'BT removal: held Source remains navigation only');
	check(!ide.editor.commands.isEnabled(remove), 'BT removal: code focus does not inherit graph commands');
	await press('Delete');
	check(model.buffer.getText() === BT_ORDER_SOURCE.replace('\tnested; -- nested inline', '\tested; -- nested inline'),
		'BT removal: code Delete edits text, not the hidden graph member');
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(model.buffer.getText() === BT_ORDER_SOURCE && viewport.selection === null,
		'BT removal: replacing the identifier start invalidates its range; Undo does not invent source identity');
	await press('Home');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await press('Space');
	check(children()[1].children.length === 2, 'BT removal: the selected subtree is expanded');
	version = model.version;
	console.info('STUDIO: BT removal action ready for visual inspection');
	await click(button.bounds, 6);
	const removed = BT_ORDER_SOURCE.replace('\tnested; -- nested inline', '\t -- nested inline');
	check(model.version === version + 1 && model.buffer.getText() === removed && children().length === 2
		&& viewport.selection === null && lens.view.selection === null && !ide.editor.commands.isEnabled(remove),
		'BT removal: held Remove performs one field edit, keeps exterior comments and clears deleted selection');
	check(lens.view.definitionRowKey === lens.view.document.definitions[0].rowKey,
		'BT removal: the chosen registration survives without selecting another definition');
	console.info('STUDIO: BT removed child ready for visual inspection');
	await click(sourceButton.bounds);
	const definitionRange = lens.view.document.definitions[0].occurrenceRange;
	check(getActiveTab() === code && model.version === version + 1 && !hasSelection()
		&& activeCodeEditor.view.cursorRow === definitionRange.start.line - 1,
		'BT removal: with no selected child, Source navigates to the selected registration');
	const hiddenDocument = lens.view.document;
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && lens.view.document === hiddenDocument,
		'BT removal: one hidden code Undo restores the entire source edit without eager graph work');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(viewport.selection === null && children().length === 3, 'BT removal: Undo does not select a restored or same-index node');
	await runPaletteCommand('Edit: Redo');
	check(model.buffer.getText() === removed && viewport.selection === null, 'BT removal: graph palette uses the same document Redo');
	await press('ControlLeft', 'KeyZ');
	await press('Home');
	await press('ArrowDown');
	await press('ArrowDown');
	await runPaletteCommand('Behavior Lens: Remove BT Child');
	check(model.buffer.getText() === BT_ORDER_SOURCE.replace('\tleaf, -- first inline', '\t -- first inline'),
		'BT removal: the palette commits to its originating graph selection');
	await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.weighted-order', 'BEHAVIOR TREES');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	const child = children()[1];
	const edge = viewport.model.edges.find(edge => edge.child === child)!;
	const x = edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX;
	const y = edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY;
	await click({ left: x, right: x, top: y, bottom: y });
	check(viewport.selection === edge && readLuaSourceRange(model.buffer, edge.range) === '{ weight = 9, child = nested }',
		'BT removal: a selected weighted connection owns the complete wrapper');
	version = model.version;
	await press('ControlLeft', 'Delete');
	check(model.version === version, 'BT removal: modified Delete is not the graph command');
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	await frame();
	check(!ide.editor.commands.isEnabled(remove), 'BT removal: readonly source has no destructive command');
	await press('Delete');
	ide.editor.behaviorLens.removeSelectedChild();
	check(model.version === version, 'BT removal: readonly admission also holds at the edit consumer');
	model.refreshResource(resource);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	check(!ide.editor.commands.isEnabled(remove), 'BT removal: old geometry cannot authorize a new source generation');
	await frame();
	check(!ide.editor.commands.isEnabled(remove), 'BT removal: syntax recovery is not an editable table');
	await press('Delete');
	ide.editor.behaviorLens.removeSelectedChild();
	check(model.buffer.getText() === BT_ORDER_SOURCE + '\n@', 'BT removal: recovered syntax remains untouched');
	await press('ControlLeft', 'KeyZ');
	version = model.version;
	await press('Delete');
	check(model.version === version + 1 && model.buffer.getText() === BT_ORDER_SOURCE.replace('\t{ weight = 9, child = nested },', '\t')
		&& children()[0].lines[0] === 'CHOICE 1  W=1' && children()[1].lines[0] === 'CHOICE 2  W=3' && viewport.selection === null,
		'BT removal: Delete removes a complete weighted choice, preserving survivor weights and clearing the edge');
	await press('ControlLeft', 'KeyZ');
	// A source command invalidates a captured preview. Releasing afterwards must
	// not reapply the old drag payload to the changed list.
	const cardPoint = (index: number) => {
		const node = children()[index];
		const x = node.bounds.left + node.bounds.right;
		const y = node.bounds.top + node.headerHeight / 2;
		return { left: x / 2 + viewport.bounds.left - viewport.scrollX, right: x / 2 + viewport.bounds.left - viewport.scrollX,
			top: y + viewport.bounds.top - viewport.scrollY, bottom: y + viewport.bounds.top - viewport.scrollY };
	};
	for (const removeWhileHeld of [false, true]) {
		movePointer(cardPoint(0)); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(cardPoint(2)); await frame();
		version = model.version;
		if (removeWhileHeld) await press('Delete');
		setPointerButton('pointer_primary', false); await frame();
		check(model.version === version + 1, 'BT removal: one physical gesture produces one source edit');
		if (removeWhileHeld) {
			check(model.buffer.getText() === BT_ORDER_SOURCE.replace('\t{ weight = 1, child = leaf },', '\t'),
				'BT removal: source edit cancels capture; release does not commit the previous reorder preview');
		} else {
			check(children()[2].lines[0] === 'CHOICE 3  W=1',
				'BT removal: the same press/move/release really admits a reorder before testing its cancellation');
		}
		await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT removal: no extra gesture history element');
	}
	const retained = viewport.model;
	const document = lens.view.document;
	version = model.version;
	for (let index = 0; index < 30; index += 1) await frame();
	check(viewport.model === retained && lens.view.document === document && model.version === version,
		'BT removal: warm action-bar enablement adds no source/graph work');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'BT removal: fixture edits undo completely without touching the paused machine or installed media');
}
