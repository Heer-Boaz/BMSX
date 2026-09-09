import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_ORDER_SOURCE } from '../../helpers/behavior_order_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Real source commands and focus/history, independent of the cart's behavior definitions. */
export async function testStudioBtMoves(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, cycles, runPaletteCommand } = test;
	console.info('STUDIO: BT source moves and shared document history');
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
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT moves: concrete graph required');
	const view = lens.view;
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	const earlier = 'behaviorLens.moveChildEarlier';
	const later = 'behaviorLens.moveChildLater';
	check(!graph.actionBar.items.some(item => item.command === earlier || item.command === later), 'BT title has no Earlier/Later buttons');
	check(!ide.editor.commands.isEnabled(earlier) && !ide.editor.commands.isEnabled(later), 'BT moves: registration is not an ordered child');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await click(graph.actionBar.items[2].bounds);
	const selected = viewport.selection;
	if (selected?.kind !== 'node') throw new Error('BT moves: selected nested branch missing');
	check(selected.children.length === 2, 'BT moves: expand the selected branch before reordering');
	const version = model.version;
	await runPaletteCommand('Behavior Lens: Move BT Child Earlier');
	const moved = model.buffer.getText();
	check(model.version === version + 1 && viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHILD 1'
		&& viewport.selection.children.length === 2 && readLuaSourceRange(model.buffer, viewport.selection.source.occurrenceRange) === 'nested',
		'BT moves: the explicit command moves once across metadata and preserves selected subtree expansion');
	check(!ide.editor.commands.isEnabled(earlier) && ide.editor.commands.isEnabled(later), 'BT moves: source index owns endpoint admission');
	console.info('STUDIO: BT reordered children ready for visual inspection');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHILD 2',
		'BT moves: graph focus routes Ctrl-Z to the resource-owned document');
	await runPaletteCommand('Edit: Redo');
	check(model.buffer.getText() === moved, 'BT moves: palette Redo routes back to the originating graph focus');
	const source = viewport.selection!;
	if (source.kind !== 'node') throw new Error('BT moves: redo lost node selection');
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === source.source.occurrenceRange.start.line - 1
		&& activeCodeEditor.view.cursorColumn === source.source.occurrenceRange.start.column - 1 && !hasSelection(),
		'BT moves: Source opens the new exact location without transferring held input');
	const document = view.document;
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && view.document === document, 'BT moves: hidden code Undo maps source without rebuilding the lens');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHILD 2' && viewport.selection.children.length === 2,
		'BT moves: returning to the lens preserves the same nested occurrence and expansion');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.shared-order', 'BEHAVIOR TREES');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await runPaletteCommand('Behavior Lens: Move BT Child Earlier');
	check(getActiveTab() === lens && lens.workingCopy === model && model.buffer.getText() === moved
		&& view.definitionRowKey === view.document.definitions[1].rowKey, 'BT moves: shared initializer is edited once without changing definition identity');
	await runPaletteCommand('Edit: Undo');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT moves: no separate graph history');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.weighted-order', 'BEHAVIOR TREES');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await press('ArrowRight');
	const child = viewport.selection;
	if (child?.kind !== 'node') throw new Error('BT moves: weighted child missing');
	const edge = viewport.model.edges.find(edge => edge.child === child)!;
	const x = edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX;
	const y = edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 });
	check(viewport.selection === edge, 'BT moves: pointer selects the actual weighted connection');
	await runPaletteCommand('Behavior Lens: Move BT Child Earlier');
	check(viewport.selection?.kind === 'edge' && viewport.selection.child.lines[0] === 'CHOICE 2  W=3'
		&& readLuaSourceRange(model.buffer, viewport.selection.range) === '{ weight = 3, child = make_node(3) }',
		'BT moves: complete weighted wrapper moves, not just its child expression');
	console.info('STUDIO: BT reordered choices ready for visual inspection');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && viewport.selection?.kind === 'edge' && viewport.selection.child.lines[0] === 'CHOICE 3  W=3',
		'BT moves: Undo restores missing punctuation and the selected edge without changing source role');
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	await frame();
	const readonlyVersion = model.version;
	check(model.readOnly && !ide.editor.commands.isEnabled(earlier) && !ide.editor.commands.isEnabled('undo'),
		'BT moves: a generated resource has no mutation or document-history command despite a valid selected member');
	await press('ControlLeft', 'KeyZ');
	ide.editor.commands.execute(earlier);
	check(model.version === readonlyVersion, 'BT moves: readonly admission also holds at the command execution boundary');
	model.refreshResource(resource);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	check(!ide.editor.commands.isEnabled(earlier), 'BT moves: old geometry does not authorize an edit in a new source generation');
	await frame();
	check(!ide.editor.commands.isEnabled(earlier) && !ide.editor.commands.isEnabled(later), 'BT moves: syntax recovery is not editable source');
	ide.editor.commands.execute(earlier);
	check(model.buffer.getText() === BT_ORDER_SOURCE + '\n@', 'BT moves: disabled command does not edit recovered syntax');
	await press('ControlLeft', 'KeyZ');
	const retained = viewport.model;
	const retainedDocument = view.document;
	for (let index = 0; index < 30; index += 1) await frame();
	check(viewport.model === retained && view.document === retainedDocument, 'BT moves: commands add no warm source or geometry work');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'BT moves: all fixture edits undo without running or modifying the paused machine');
}
