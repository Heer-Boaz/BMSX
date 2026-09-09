import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { inputFocus } from '../../../ide/input/focus';
import { luaSourceRangeToTextRange } from '../../../ide/language/lua/source_edits';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { FSM_PROOF_SOURCE } from '../../helpers/fsm_source_fixture';
import { revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

function selectedProof(view: BehaviorLensViewState) {
	const selection = view.selection;
	if (selection?.kind !== 'state-outcome') throw new Error('FSM proof: expected a selected outcome');
	return selection;
}

/** Source Details and Source use the same evidence before and after hidden edits. */
export async function testStudioFsmSelection(test: StudioFixture): Promise<void> {
	const { ide, harness, click, frame, press, runPaletteCommand, cycles, clipboard } = test;
	console.info('STUDIO: FSM proof picker, identical returns, hidden edits/Undo and source snapshot cancellation');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_PROOF_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	const picker = ide.editor.quickInput;
	clipboard.text = 'FSM fixture.proofs';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 2, 'FSM proof: duplicate registrations stay independently selectable');
	await press('Enter');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('FSM proof: expected the real source input');
	const view = lens.view;
	const graph = view.presentation;
	if (graph.kind !== 'state-graph') throw new Error('FSM proof: expected the concrete state graph');
	const definition = view.document.definitions[0];
	if (definition.behaviorKind !== 'state_machine') throw new Error('FSM proof: expected the authored machine');
	const right = definition.transitions.filter(transition => transition.slot.kind === 'update')[1];
	await revealLensOccurrence(test, view, right.slot.source.rowKey);
	await click(graph.actionBar.items[1].bounds);
	check(picker.visible && picker.title === 'FSM SOURCE EVIDENCE', 'FSM proof: shared Details action opens its own source choices');
	clipboard.text = 'return next_path';
	await press('ControlLeft', 'KeyV');
	const rows = picker.model.list.rows;
	check(rows.length === 2 && rows[0].item.label === rows[1].item.label && rows[0].item.description !== rows[1].item.description,
		'FSM proof: identical returns display their distinct line/column evidence');
	const retainedRows = rows.slice();
	for (let index = 0; index < 30; index += 1) await frame();
	check(rows[0] === retainedRows[0] && rows[1] === retainedRows[1], 'FSM proof: picker frames retain their measured source items');
	const layout = picker.model.list.layout;
	await click({ left: layout.contentLeft, right: layout.contentRight,
		top: layout.contentTop + layout.rowHeight, bottom: layout.contentTop + layout.rowHeight * 2 }, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === 4
		&& activeCodeEditor.view.cursorColumn === FSM_PROOF_SOURCE.split('\n')[4].indexOf('return') && !hasSelection(),
		'FSM proof: held picker acceptance opens the second return, not the binding, initializer or a dragged code selection');
	check(selectedProof(view).transition === right && selectedProof(view).outcome === right.outcomes[1],
		'FSM proof: the same callback return remains scoped to its right-hand use');
	check(graph.viewport.selection?.kind === 'edge'
		&& graph.viewport.selection.link.reference.kind === 'state-outcome'
		&& graph.viewport.selection.link.reference.outcome === right.outcomes[1],
		'FSM proof: Details selects the exact geometric proof, not the previously highlighted state');
	const selectedGeometry = graph.viewport.model;
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(graph.viewport.model === selectedGeometry && graph.viewport.selection?.kind === 'edge',
		'FSM proof: returning from source reveals that proof without relayout');
	await click(graph.actionBar.items[0].bounds);
	const oldDocument = view.document;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 shifted evidence\n' }]);
	model.pushEditOperations([{ offset: model.buffer.getText().indexOf('\tif owner.again'), deleteLength: 0,
		text: '\tif owner.extra then return next_path end\n' }]);
	await frame();
	check(view.document === oldDocument, 'FSM proof: hidden input maps evidence without rebuilding source');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(selectedProof(view).outcome === selectedProof(view).transition.outcomes[2], 'FSM proof: correspondence follows the old return past a newly inserted identical return');
	await click(graph.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === 6 && !hasSelection(), 'FSM proof: Source consumes current parsed evidence after UTF-16 edits');
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(selectedProof(view).outcome === selectedProof(view).transition.outcomes[1], 'FSM proof: ordinary Undo restores the selected occurrence, not an ordinal');
	const focus = inputFocus.target;
	await runPaletteCommand('Behavior Lens: Open Source Details');
	check(picker.visible && picker.title === 'FSM SOURCE EVIDENCE', 'FSM proof: the palette and action bar share one command');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- invalidate open source snapshot\n' }]);
	check(!picker.visible && inputFocus.target === focus, 'FSM proof: source changes close the obsolete snapshot and restore invoking focus');
	await frame();
	model.undo();
	await frame();
	await click(graph.actionBar.items[0].bounds);
	const span = luaSourceRangeToTextRange(model.buffer, selectedBehaviorLensSourceRange(view)!);
	model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: '' }]);
	model.undo();
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(view.selection === null && view.presentation.kind === 'state-graph' && view.presentation.viewport.selection === null,
		'FSM proof: deleting and undoing the selected return while hidden cannot select its namesake');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'FSM proof: ordinary source Undo removes the independent fixture');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'FSM proof: selection and navigation perform no guest work or media installation');
}
