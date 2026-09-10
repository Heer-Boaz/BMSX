import { FSM_INITIAL_SOURCE } from '../../helpers/fsm_initial_fixture';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical source-authoring controls; no fixture state is installed into the guest. */
export async function testStudioFsmInitial(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, runPaletteCommand, cycles } = test;
	console.info('STUDIO: FSM Set Initial source, graph, focus and hidden history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_INITIAL_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.other', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('initial: FSM graph required');
	await lens.graphLayout.settled; await frame();
	const graph = lens.view.presentation;
	const node = graph.viewport.model.nodes.find(node => node.source.label === 'active')!;
	await revealLensOccurrence(test, lens.view, node.source.rowKey);
	const bounds = node.bounds;
	await click({ left: graph.viewport.bounds.left + bounds.left - graph.viewport.scrollX,
		right: graph.viewport.bounds.left + bounds.right - graph.viewport.scrollX,
		top: graph.viewport.bounds.top + bounds.top - graph.viewport.scrollY,
		bottom: graph.viewport.bounds.top + bounds.bottom - graph.viewport.scrollY });
	check(ide.editor.commands.isEnabled('behaviorLens.setInitialState'), 'initial: an actual state card enables the shared command');
	const version = model.version;
	await click(graph.actionBar.items[2].bounds, 8);
	await lens.graphLayout.settled; await frame();
	const changed = FSM_INITIAL_SOURCE.replace("'idle'),", "'active'),");
	check(model.version === version + 1 && model.buffer.getText() === changed, 'initial: held action-bar press is exactly one token edit');
	check(lens.view.selection?.rowKey === node.source.rowKey && !ide.editor.commands.isEnabled('behaviorLens.setInitialState'),
		'initial: selected card survives and now-explicit initial cannot create empty history');
	check(graph.viewport.model.edges.some(edge => edge.link.reference.kind === 'state-entry' && edge.link.target.source.label === 'active'),
		'initial: real worker reroutes the entry to the new state');
	console.info('STUDIO: FSM initial edit ready for visual inspection');
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && model.buffer.getText() === changed && !hasSelection(), 'initial: held Source action is navigation only');
	check(inputFocus.getCommand('behaviorLens.setInitialState') === undefined, 'initial: code focus has no graph-authoring command');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === FSM_INITIAL_SOURCE, 'initial: code Undo restores the token while the graph is hidden');
	await test.clickTab(lens.id);
	await lens.graphLayout.settled; await frame();
	check(ide.editor.commands.isEnabled('behaviorLens.setInitialState'), 'initial: hidden Undo preserves the selected state');
	await runPaletteCommand('State Machine: Set Selected State as Initial');
	await lens.graphLayout.settled; await frame();
	check(model.buffer.getText() === changed, 'initial: palette uses the graph focus and the same edit owner');
	await runPaletteCommand('Edit: Undo'); await lens.graphLayout.settled; await frame();
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	check(!ide.editor.commands.isEnabled('behaviorLens.setInitialState'), 'initial: read-only source cannot be edited through the graph');
	ide.editor.behaviorLens.setSelectedInitialState();
	check(model.buffer.getText() === FSM_INITIAL_SOURCE, 'initial: the command consumer also obeys source read-only ownership');
	model.refreshResource(resource);
	const ready = graph.viewport.model;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	check(!ide.editor.commands.isEnabled('behaviorLens.setInitialState') && graph.viewport.model !== ready,
		'initial: source-version change immediately revokes old command geometry');
	await frame(); await lens.graphLayout.settled; await frame();
	check(!ide.editor.commands.isEnabled('behaviorLens.setInitialState'), 'initial: recovered syntax stays source-only');
	await runPaletteCommand('Edit: Undo'); await lens.graphLayout.settled; await frame();
	await runPaletteCommand('Edit: Redo'); await lens.graphLayout.settled; await frame();
	await runPaletteCommand('Edit: Undo'); await lens.graphLayout.settled; await frame();
	harness.openLuaSource('cart.lua');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'initial: ordinary history removes the authored fixture');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'initial: source authoring never runs or installs the guest');
}
