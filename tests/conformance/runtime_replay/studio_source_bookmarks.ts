import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_TRANSFER_SOURCE, transferBehaviorFixtureSelection } from '../../helpers/behavior_transfer_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Language-command result/history integration; this does not pretend a reconnect gesture exists. */
export async function testStudioSourceBookmarks(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, cycles, runPaletteCommand } = test;
	console.info('STUDIO: edit-associated source bookmarks across parents and hidden document history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	if (code.kind !== 'code_editor') throw new Error('bookmark: source code input required');
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_TRANSFER_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.second', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('bookmark: BT graph required');
	const view = lens.view;
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	await press('ArrowDown'); await press('ArrowDown');
	await click(graph.actionBar.items[2].bounds);
	await press('ArrowDown'); await press('ArrowRight');
	const selected = viewport.selection;
	if (selected?.kind !== 'node' || selected.member === null) throw new Error('bookmark: selected source member required');
	check(readLuaSourceRange(model.buffer, selected.source.occurrenceRange) === 'moved', 'bookmark: physical navigation chooses the moving source use');
	const definition = view.document.definitions[1];
	if (definition.behaviorKind !== 'behavior_tree' || definition.root?.kind !== 'node') throw new Error('bookmark: fixture root required');
	const children = definition.root.branches[0];
	if (children.role !== 'children' || children.entries[2].node.kind !== 'node') throw new Error('bookmark: second target use required');
	const target = children.entries[2].node.branches[0];
	if (target.role !== 'children') throw new Error('bookmark: destination list required');
	let version = model.version;
	transferBehaviorFixtureSelection(model, view, selected.member, target);
	await frame();
	const after = viewport.selection;
	check(model.version === version + 1 && view.definitionRowKey === view.document.definitions[1].rowKey
		&& after?.kind === 'node' && after.member!.index === 1 && after.parent!.member!.index === 2,
		'bookmark: one edit selects the new parent, correct registration and second shared destination use');
	if (after?.kind !== 'node') throw new Error('bookmark: selected result missing');
	const range = after.source.occurrenceRange;
	const transferred = model.buffer.getText();
	version = model.version;
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && model.version === version && !hasSelection()
		&& activeCodeEditor.view.cursorRow === range.start.line - 1 && activeCodeEditor.view.cursorColumn === range.start.column - 1,
		'bookmark: held Source click is navigation, not a document edit or drag into the source editor');
	await press('ArrowRight');
	check(activeCodeEditor.view.cursorColumn === range.start.column && model.version === version, 'bookmark: source editor remains responsive');
	await press('Home');
	const typingRow = activeCodeEditor.view.cursorRow;
	const typingColumn = activeCodeEditor.view.cursorColumn;
	await press('Space');
	check(activeCodeEditor.view.cursorColumn === typingColumn + 1, 'bookmark: physical typing produces code-owned edit state');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await runPaletteCommand('Edit: Undo');
	check(getActiveTab() === lens && code.context.view.cursorRow === typingRow && code.context.view.cursorColumn === typingColumn,
		'bookmark: graph Undo restores the hidden code input through the document event, without a code Undo caller');
	await runPaletteCommand('Edit: Redo');
	check(code.context.view.cursorColumn === typingColumn + 1, 'bookmark: graph Redo restores the hidden code result too');
	await runPaletteCommand('Edit: Undo');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	check(activeCodeEditor.view.cursorRow === typingRow && activeCodeEditor.view.cursorColumn === typingColumn
		&& model.buffer.getText() === transferred, 'bookmark: reattaching the code widget consumes the retained restored cursor');
	const hiddenDocument = view.document;
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_TRANSFER_SOURCE && view.document === hiddenDocument, 'bookmark: code Undo delivers selection without rebuilding a hidden lens');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(viewport.selection?.kind === 'node' && viewport.selection.parent!.member!.index === 0
		&& view.definitionRowKey === view.document.definitions[1].rowKey, 'bookmark: source projection resolves the recorded original parent when reopened');
	await runPaletteCommand('Edit: Redo');
	check(model.buffer.getText() === transferred && viewport.selection?.kind === 'node' && viewport.selection.parent!.member!.index === 2,
		'bookmark: palette Redo restores the recorded result, without another selection history');
	const retained = view.document;
	const geometry = viewport.model;
	for (let index = 0; index < 20; index += 1) await frame();
	check(view.document === retained && viewport.model === geometry && view.selectionBookmark === undefined,
		'bookmark: stable frames retain the same source and geometry; no pending bookmark is replayed');
	await runPaletteCommand('Edit: Undo');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'bookmark: ordinary history removes the fixture, without execution, source installation or guest-state changes');
}
