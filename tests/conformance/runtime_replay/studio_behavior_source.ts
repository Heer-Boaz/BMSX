import { testStudioBehaviorGraphControls } from './studio_behavior_graph';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../../ide/language/lua/source_edits';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { getCachedLuaParse } from '../../../toolchain/ts/lua/analysis/cache';
import { BEHAVIOR_SOURCE_FIXTURE } from '../../helpers/behavior_source_fixture';
import { revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

function fixtureChildren(view: BehaviorLensViewState) {
	const definition = view.document.definitions[0];
	if (definition.behaviorKind !== 'behavior_tree' || definition.root === null || definition.root.kind !== 'node') {
		throw new Error('source graph: fixture must project a BT root');
	}
	const branch = definition.root.branches[0];
	if (branch.role !== 'children') throw new Error('source graph: sequence children missing');
	return branch.entries;
}

/** Fixed authored source, exercised in the real paused Studio rather than game-specific line goldens. */
export async function testStudioBehaviorSourceGraph(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, clipboard, runPaletteCommand, cycles } = test;
	console.info('STUDIO: source graph occurrence identity through hidden edits, pane gestures and Undo');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	// The existing module is only a textmodel carrier. No fixture is compiled or installed in the machine.
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BEHAVIOR_SOURCE_FIXTURE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	clipboard.text = 'BT fixture.tree';
	await press('ControlLeft', 'KeyV');
	const picker = ide.editor.quickInput;
	check(picker.model.list.rows.length === 2, 'source graph: the fixture contributes two independent registrations');
	await press('Enter');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('source graph: actual Behavior Lens input missing');
	check(lens.workingCopy === model, 'source graph: the lens and code share the real working copy');
	const view = lens.view;
	if (view.presentation.kind !== 'graph') throw new Error('source graph: BT must use the concrete graph');
	const graph = view.presentation;
	const viewport = graph.viewport;
	await testStudioBehaviorGraphControls(test, view);
	const entries = fixtureChildren(view);
	const shared = entries[1].node;
	if (shared.kind !== 'node' || shared.branches[0].role !== 'children') throw new Error('source graph: shared subtree missing');
	const selected = shared.branches[0].entries[0].node;
	await revealLensOccurrence(test, view, selected.rowKey);
	const card = viewport.model.nodesBySource.get(selected.rowKey)!;
	const bounds = { left: card.bounds.left + viewport.bounds.left - viewport.scrollX,
		right: card.bounds.right + viewport.bounds.left - viewport.scrollX,
		top: card.bounds.top + viewport.bounds.top - viewport.scrollY,
		bottom: card.bounds.bottom + viewport.bounds.top - viewport.scrollY };
	await click(bounds);
	await click(graph.actionBar.items[0].bounds);
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await click(bounds);
	check(getActiveTab() === lens, 'source graph: pane switching cancels the earlier click, not a double-click on return');
	await click(graph.actionBar.items[0].bounds, 6);
	const sourceLines = BEHAVIOR_SOURCE_FIXTURE.split('\n');
	const sourceRow = sourceLines.findIndex(line => line.includes('children = { leaf,'));
	const sourceColumn = sourceLines[sourceRow].indexOf('leaf');
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === sourceRow
		&& activeCodeEditor.view.cursorColumn === sourceColumn && !hasSelection(),
		'source graph: a held Source gesture opens the initializer reference without starting a code drag');
	const oldDocument = view.document;
	const insertion = luaSourceRangeToTextRange(model.buffer, entries[0].field.range);
	const prefix = '-- 🐉 source insertion\n';
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	model.pushEditOperations([{ offset: insertion.start + prefix.length, deleteLength: 0, text: "{ type = 'wait' }, " }]);
	await frame();
	check(view.document === oldDocument, 'source graph: hidden edits map source correspondence without rebuilding the lens');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	const nextEntries = fixtureChildren(view);
	const nextShared = nextEntries[2].node;
	if (nextShared.kind !== 'node' || nextShared.branches[0].role !== 'children') throw new Error('source graph: moved occurrence missing');
	const nextSelected = nextShared.branches[0].entries[0].node;
	check(viewport.selection?.kind === 'node' && viewport.selection.source === nextSelected && selected.rowKey !== nextSelected.rowKey,
		'source graph: tab activation follows the second occurrence, not the previous ordinal row key');
	check(view.collapsedRowKeys.has(nextEntries[1].node.rowKey) && !view.collapsedRowKeys.has(nextEntries[2].node.rowKey),
		'source graph: occurrences sharing one initializer keep independent expansion');
	check(view.definitionRowKey === view.document.definitions[0].rowKey, 'source graph: the chosen registration survives hidden edits');
	const currentDocument = view.document;
	const retainedCard = viewport.selection;
	for (let index = 0; index < 30; index += 1) await frame();
	check(view.document === currentDocument && viewport.selection === retainedCard,
		'source graph: idle frames neither reparse nor rebuild retained cards');
	await click(graph.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === sourceRow + 1 && activeCodeEditor.view.cursorColumn === sourceColumn
		&& !hasSelection(), 'source graph: Source uses the new generation, including the UTF-16 insertion');
	const parsed = getCachedLuaParse({ source: model.buffer.getText(), path: model.resource.path }).parsed;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, nextEntries[2].field));
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(view.selection === null && viewport.selection === null, 'source graph: deleting the selected occurrence does not choose its namesake');
	await press('Enter');
	check(getActiveTab() === lens, 'source graph: an absent selection has no stale source action');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(view.selection === null && viewport.selection === null, 'source graph: ordinary Undo does not invent correspondence for a removed selection');
	await press('ArrowDown');
	check(view.selection?.rowKey === view.definitionRowKey, 'source graph: explicit keyboard navigation starts at the root card after removal');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	for (let index = 0; index < 3; index += 1) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'source graph: ordinary source Undo removes all fixture edits');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'source graph: editing and navigation leave the paused machine and installed media untouched');
}
