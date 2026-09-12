import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import { retargetStateMachineTransition } from '../../../ide/workbench/contrib/behavior_lens/state_machine_edit';
import { StateMachineRetargetAnalysis } from '../../../ide/workbench/contrib/behavior_lens/state_machine_retarget';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { FSM_RETARGET_SOURCE } from '../../helpers/fsm_retarget_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

function selectedOutcome(view: BehaviorLensViewState) {
	const selection = view.selection;
	if (selection?.kind !== 'state-outcome') throw new Error('FSM bookmark: exact outcome selection required');
	return selection;
}

/** Production edit/history route; the fixture supplies a target, not an invented reconnect control. */
export async function testStudioFsmBookmarks(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, until, runPaletteCommand, cycles } = test;
	console.info('STUDIO: FSM retarget source bookmarks, physical edge selection, Source and hidden document history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_RETARGET_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.two', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('FSM bookmark: concrete input required');
	const view = lens.view;
	const graph = lens.view.presentation;
	const ready = () => until(() => graph.layoutState.kind === 'ready', 'FSM bookmark: publish the current source geometry');
	await ready();
	for (const slot of ['direct', 'update']) {
		const definition = view.document.definitions[1];
		if (definition.behaviorKind !== 'state_machine') throw new Error('FSM bookmark: fixture registration required');
		const branch = definition.scopes[0].children.get('left')!;
		const transition = definition.transitions.find(item => item.origin === branch.children.get('idle')!
			&& (slot === 'update' ? item.slot.kind === slot : item.slot.source.label === slot))!;
		const outcomeIndex = slot === 'update' ? 1 : 0;
		const geometry = graph.viewport.model;
		const edge = geometry.edgesByOutcome.get(transition.outcomes[outcomeIndex])!;
		await press('Home');
		for (let index = 0; index < geometry.nodes.length + geometry.edges.indexOf(edge); index += 1) await press('ArrowDown');
		const selection = selectedOutcome(view);
		check(selection.outcome === transition.outcomes[outcomeIndex], 'FSM bookmark: physical traversal selects the actual proof');
		const target = new StateMachineRetargetAnalysis(view.document, selection.transition, selection.outcome)
			.checkTarget(branch.children.get('other')!);
		if (target.kind !== 'available') throw new Error('FSM bookmark: fixture target must be admitted');
		let version = model.version;
		retargetStateMachineTransition(model, view, selection, target);
		check(model.version === version + 1 && graph.viewport.model.edges.length === 0, 'FSM bookmark: one edit immediately revokes obsolete endpoints');
		await ready();
		const changed = model.buffer.getText();
		const restored = selectedOutcome(view);
		check(restored.outcome.target.kind === 'path' && restored.outcome.target.text === '../other'
			&& restored.outcome === restored.transition.outcomes[outcomeIndex]
			&& view.definitionRowKey === view.document.definitions[1].rowKey,
			'FSM bookmark: retarget keeps the selected registration and exact return, not an equal path');
		check(graph.viewport.selection?.kind === 'edge' && graph.viewport.selection.link.target.source.label === 'other',
			'FSM bookmark: the new geometry highlights the retargeted evidence');
		const range = selectedBehaviorLensSourceRange(view)!;
		version = model.version;
		await click(graph.actionBar.items[0].bounds, 6);
		check(getActiveTab() === code && model.version === version && !hasSelection()
			&& activeCodeEditor.view.cursorRow === range.start.line - 1 && activeCodeEditor.view.cursorColumn === range.start.column - 1,
			'FSM bookmark: held Source activation navigates without dirtying or selecting code');
		await press('ArrowRight');
		check(activeCodeEditor.view.cursorColumn === range.start.column, 'FSM bookmark: code input remains responsive');
		await press('AltLeft', 'ArrowLeft'); await ready();
		check(getActiveTab() === lens && selectedBehaviorLensSourceRange(view)!.start.line === range.start.line,
			'FSM bookmark: actual Back restores the same source proof');
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- after navigation restore\n' }]);
		await ready();
		check(selectedBehaviorLensSourceRange(view)?.start.line === range.start.line + 1,
			'FSM bookmark: an edit after Back maps active selection once, independently of navigation history');
		await click(graph.actionBar.items[0].bounds);
		check(getActiveTab() === code && activeCodeEditor.view.cursorRow === range.start.line && !hasSelection(),
			'FSM bookmark: the restored and edited proof still opens the exact source line');
		await press('ControlLeft', 'KeyZ');
		await test.clickTab(lens.id); await ready();
		check(model.buffer.getText() === changed && selectedBehaviorLensSourceRange(view)!.start.line === range.start.line,
			'FSM bookmark: Undo after Back preserves the proof without sharing history markers');
		await click(graph.actionBar.items[0].bounds);
		const hidden = view.document;
		await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === FSM_RETARGET_SOURCE && view.document === hidden,
			'FSM bookmark: code Undo restores text and leaves one pending selection, without parsing a hidden Lens');
		await test.clickTab(lens.id); await ready();
		const before = selectedOutcome(view);
		check(before.outcome.target.kind === 'path' && before.outcome.target.text === '../active'
			&& before.outcome === before.transition.outcomes[outcomeIndex], 'FSM bookmark: reopening resolves the recorded original proof');
		await runPaletteCommand('Edit: Redo'); await ready();
		check(model.buffer.getText() === changed && graph.viewport.selection?.kind === 'edge'
			&& graph.viewport.selection.link.target.source.label === 'other', 'FSM bookmark: graph palette Redo restores result text and selection together');
		const retained = graph.viewport.model;
		for (let index = 0; index < 20; index += 1) await frame();
		check(graph.viewport.model === retained && view.selectionBookmark === undefined, 'FSM bookmark: stable frames never replay history');
		await runPaletteCommand('Edit: Undo'); await ready();
	}
	await test.clickTab(code.id);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'FSM bookmark: ordinary Undo removes the fixture, without guest execution or source installation');
}
