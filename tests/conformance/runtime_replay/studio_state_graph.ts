import { FSM_DIAGRAM_SOURCE } from '../../helpers/fsm_source_fixture';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Real worker, controls, source model, editor-pane lifetime and actual overlay rendering. */
export async function testStudioStateGraph(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, runPaletteCommand, cycles } = test;
	console.info('STUDIO: compound FSM diagram, parallel proofs, self-loop, pan and source/worker lifetime');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_DIAGRAM_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.diagram', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('FSM diagram input missing');
	await lens.graphLayout.settled;
	await frame();
	const view = lens.view;
	const graph = lens.view.presentation;
	check(graph.layoutState.kind === 'ready', 'FSM diagram: actual browser worker publishes');
	const viewport = graph.viewport;
	const generation = viewport.model;
	check(generation.nodes.length === 3 && generation.edges.length === 5, 'FSM diagram: two states, one root, initial, two returns, loop and reset');
	const parallel = generation.edges.filter(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.outcome.proof.kind === 'return');
	check(parallel.length === 2 && parallel[0].link.source === parallel[1].link.source && parallel[0].link.target === parallel[1].link.target,
		'FSM diagram: parallel source evidence is not merged');
	// The diagram's traversal includes edges, unlike the BT's tree relationships.
	await press('Home');
	for (let index = 0; index < generation.nodes.length + generation.edges.indexOf(parallel[1]); index += 1) await press('ArrowDown');
	check(view.selection?.kind === 'state-outcome' && parallel[1].link.reference.kind === 'state-outcome' && view.selection.outcome === parallel[1].link.reference.outcome,
		'FSM diagram: Tab visits the second exact proof');
	const focused = inputFocus.target;
	for (let index = 0; index < 30; index += 1) await frame();
	check(viewport.model === generation && inputFocus.target === focused, 'FSM diagram: idle frames retain geometry and focus');
	console.info('STUDIO: FSM diagram ready for visual inspection');
	const label = parallel[1].labels[0].bounds;
	const bounds = { left: viewport.bounds.left + label.left - viewport.scrollX,
		right: viewport.bounds.left + label.right - viewport.scrollX,
		top: viewport.bounds.top + label.top - viewport.scrollY,
		bottom: viewport.bounds.top + label.bottom - viewport.scrollY };
	await click(bounds);
	await click(bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === 3 && !hasSelection(), 'FSM diagram: held edge double-click opens its own return without drag');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved graph source\n' }]);
	check(graph.viewport.model.nodes.length === 0 && lens.graphLayout.state.kind === 'idle', 'FSM diagram: hidden edit revokes publication and hits immediately');
	await test.clickTab(lens.id);
	const focusAfterActivation = inputFocus.target;
	await lens.graphLayout.settled;
	await frame();
	check(viewport.model !== generation && viewport.selection?.kind === 'edge' && inputFocus.target === focusAfterActivation,
		'FSM diagram: current source evidence is reselected without worker-driven focus');
	const current = viewport.model;
	const oldX = viewport.scrollX;
	await press('ArrowRight');
	check(viewport.scrollX === oldX + 16 && viewport.model === current, 'FSM diagram: arrows pan retained geometry instead of imposing BT siblings');
	await press('ShiftLeft', 'Tab');
	check(viewport.selection !== null, 'FSM diagram: reverse traversal remains available after source refresh');
	// Start a real background-pan capture, then detach the pane while the button remains held.
	test.movePointer({ left: viewport.bounds.left, right: viewport.bounds.left + 2, top: viewport.bounds.top, bottom: viewport.bounds.top + 2 });
	await frame();
	test.setPointerButton('pointer_primary', true);
	await frame();
	const capturedX = viewport.scrollX;
	const capturedY = viewport.scrollY;
	harness.openLuaSource('cart.lua');
	test.movePointer({ left: 200, right: 202, top: 100, bottom: 102 });
	await frame();
	check(viewport.scrollX === capturedX && viewport.scrollY === capturedY, 'FSM diagram: leaving the pane cancels physical pan capture');
	test.setPointerButton('pointer_primary', false);
	await frame();
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'FSM diagram: canonical Undo removes the independent authored fixture');
	await test.clickTab(lens.id);
	await frame();
	check(view.definitionRowKey === null && graph.viewport.model.nodes.length === 0, 'FSM diagram: removed registration does not display an old or neighboring machine');
	harness.openLuaSource('cart.lua');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'FSM diagram performs no guest work or media installation');
}
