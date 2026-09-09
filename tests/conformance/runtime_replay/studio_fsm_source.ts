import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import type { StateMachineSourceDefinition } from '../../../ide/workbench/contrib/behavior_lens/state_machine_model';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { FSM_BEHAVIOR_SOURCE } from '../../helpers/fsm_source_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

function definition(view: BehaviorLensViewState): StateMachineSourceDefinition {
	const result = view.document.definitions[0];
	if (result.behaviorKind !== 'state_machine') throw new Error('FSM source: expected the authored fixture');
	return result;
}

/** Independent authored Lua in the actual Studio text model, never a substitute cart/runtime. */
export async function testStudioFsmSource(test: StudioFixture): Promise<void> {
	const { ide, harness, click, frame, press, runPaletteCommand, cycles } = test;
	console.info('STUDIO: FSM scope/return facts follow hidden source edits, Source gestures and Undo');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_BEHAVIOR_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.first', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('FSM source: expected the real Behavior Lens input');
	const view = lens.view;
	const outline = view.presentation;
	const first = definition(view);
	const update = first.transitions.find(transition => transition.slot.kind === 'update')!;
	await revealLensOccurrence(test, view, update.slot.source.rowKey);
	await click(outline.actionBar.items[0].bounds, 6);
	const lines = FSM_BEHAVIOR_SOURCE.split('\n');
	const row = lines.findIndex(line => line.includes('update = step'));
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === row && !hasSelection(),
		'FSM source: held Source gesture opens the callback binding without dragging code');
	const oldDocument = view.document;
	const prefix = '-- 🐉 moved FSM source\n';
	const targetOffset = FSM_BEHAVIOR_SOURCE.indexOf("'../active'");
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	model.pushEditOperations([{ offset: targetOffset + prefix.length, deleteLength: "'../active'".length, text: "'../idle'" }]);
	await frame();
	check(view.document === oldDocument, 'FSM source: a hidden lens does not rebuild its retained facts per frame');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	const current = definition(view);
	const changed = current.transitions.find(transition => transition.slot.kind === 'update')!;
	check(current !== first && view.selection?.rowKey === changed.slot.source.rowKey, 'FSM source: activation refreshes the selected source occurrence');
	const outcome = changed.outcomes[0].target;
	check(outcome.kind === 'path' && outcome.target === changed.origin, 'FSM source: the const callback target follows the edited generation within its own scope');
	const retained = view.document;
	for (let index = 0; index < 30; index += 1) await frame();
	check(view.document === retained && definition(view).transitions === current.transitions,
		'FSM source: unchanged frames reuse source structure and transition evidence');
	await click(outline.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === row + 1 && !hasSelection(), 'FSM source: Source follows the new UTF-16 source coordinates');
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	const undone = definition(view).transitions.find(transition => transition.slot.kind === 'update')!;
	const restored = undone.outcomes[0].target;
	check(restored.kind === 'path' && restored.target !== undone.origin && restored.literal.value === '../active',
		'FSM source: ordinary text Undo restores the original scoped target, without graph-owned state');
	await click(outline.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'FSM source: source Undo removes the independent fixture');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'FSM source: source analysis and navigation do not execute Lua or install media in the paused machine');
}
