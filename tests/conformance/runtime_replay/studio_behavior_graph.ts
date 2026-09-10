import { testStudioGraphNavigation } from './studio_graph_navigation';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { BehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { BEHAVIOR_SOURCE_FIXTURE } from '../../helpers/behavior_source_fixture';
import { check, type StudioFixture } from './studio_fixture';

/** Physical controls on the independent Lua fixture, in the real Studio composition. */
export async function testStudioBehaviorGraphControls(test: StudioFixture, view: BehaviorLensViewState): Promise<void> {
	const { press, frame, click, input, clock, ide, clipboard, runPaletteCommand } = test;
	if (view.presentation.kind !== 'graph') throw new Error('BT controls require the concrete graph');
	const graph = view.presentation;
	const viewport = graph.viewport;
	const lens = getActiveTab();
	check(editorViewState.font.variant === 'tiny' && editorViewState.viewportWidth === 384 && editorViewState.viewportHeight === 288,
		'BT controls: actual constrained tiny-font viewport');
	await press('Home');
	await press('ArrowDown');
	const sequence = viewport.selection;
	if (sequence?.kind !== 'node') throw new Error('BT controls: root node not selected');
	await runPaletteCommand('Behavior Lens: Open Source Details');
	const picker = ide.editor.quickInput;
	check(picker.title === 'BT SOURCE DETAILS' && picker.model.entries.some(row => row.item.label === 'num_loops'),
		'BT controls: real source details include decorator policy, not execution children');
	clipboard.text = 'num_loops';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1, 'BT controls: focused source detail is independently selectable');
	const detail = sequence.details.find(item => item.label === 'num_loops')!;
	await press('Enter');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.view.cursorRow === detail.range.start.line - 1
		&& activeCodeEditor.view.cursorColumn === detail.range.start.column - 1, 'BT controls: detail activation opens its exact Lua value');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await press('ArrowDown');
	const first = viewport.selection;
	if (first?.kind !== 'node') throw new Error('BT controls: first child not selected');
	check(first.lines[0] === 'CHILD 1' && first.children.length === 2, 'BT controls: down follows the first authored child');
	const expanded = viewport.model;
	await press('ControlLeft', 'Space');
	check(viewport.model === expanded, 'BT controls: Ctrl+Space does not change graph membership');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('Space');
	check(picker.field.text === ' ' && viewport.model === expanded,
		'BT controls: Space belongs to the palette text field, not the graph behind it');
	await press('Escape');
	test.setKey('Space', true);
	for (let index = 0; index < 6; index += 1) await frame();
	test.setKey('Space', false);
	await frame();
	check(viewport.model === expanded && first.children.length === 2, 'BT controls: Space alone never folds or rebuilds the graph');
	await testStudioGraphNavigation(test);
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'BT CONFORMANCE PAD',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	await frame();
	let pressId = 80000;
	const pad = async (button: string) => {
		input.inputButton('gamepad:0', button, true, 1, clock.now() + 1, ++pressId);
		await frame();
		input.inputButton('gamepad:0', button, false, 0, clock.now() + 1, ++pressId);
		await frame();
	};
	await pad('y');
	check(viewport.model === expanded, 'BT controls: controller Y cannot hide part of the diagram');
	await pad('down');
	check(viewport.selection?.kind === 'node' && viewport.selection.parent!.source.rowKey === first.source.rowKey,
		'BT controls: controller down enters the already-visible first child');
	await pad('up');
	await pad('right');
	const second = viewport.selection;
	if (second?.kind !== 'node') throw new Error('BT controls: second child not selected');
	check(second.lines[0] === 'CHILD 2', 'BT controls: controller right follows siblings, not screen proximity');
	await pad('x');
	check(picker.visible && picker.title === 'BT SOURCE DETAILS', 'BT controls: controller X opens source details');
	await press('Escape');
	const edge = viewport.model.edgesBySource.get(second.source.rowKey)!;
	const x = edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX;
	const y = edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 });
	check(viewport.selection === edge, 'BT controls: physical pointer selects the incoming connection');
	await click(graph.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === edge.range.start.line - 1 && activeCodeEditor.view.cursorColumn === edge.range.start.column - 1,
		'BT controls: connection Source opens this occurrence, not the shared initializer');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	// Continue through weighted members without a separate expansion gesture.
	await press('Home');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	await press('ArrowRight');
	const weightedKey = view.selection!.rowKey;
	await press('ArrowDown');
	check(viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHOICE 1  W=2',
		'BT controls: entering the weighted branch selects its already-visible first choice');
	await press('ArrowRight');
	const choice = viewport.selection;
	if (choice?.kind !== 'node') throw new Error('BT controls: weighted choice not selected');
	check(choice.lines[0] === 'CHOICE 2  W=WEIGHTS.RETREAT', 'BT controls: the second choice keeps its authored weight expression');
	await click(graph.actionBar.items.find(item => item.command === 'behaviorLens.details')!.bounds);
	clipboard.text = 'weight';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1, 'BT controls: choice weight has one source detail, no duplicated summary');
	const weight = choice.details.find(item => item.label === 'weight')!;
	await press('Enter');
	check(activeCodeEditor.view.cursorRow === weight.range.start.line - 1 && activeCodeEditor.view.cursorColumn === weight.range.start.column - 1,
		'BT controls: choice detail opens the actual weight expression');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await press('ArrowUp');
	check(view.selection?.rowKey === weightedKey, 'BT controls: child returns to its weighted parent');
	await press('Space');
	await press('Home');
	input.disconnectInputDevice('gamepad:0');
}

/** Final screenshot state, using the same real picker and independent authored Lua. */
export async function presentBehaviorTreeGraph(test: StudioFixture): Promise<void> {
	test.harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BEHAVIOR_SOURCE_FIXTURE }]);
	await test.runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	test.clipboard.text = 'BT fixture.tree';
	await test.press('ControlLeft', 'KeyV');
	await test.press('Enter');
	await test.press('ArrowDown');
	await test.press('ArrowDown');
	await test.press('ArrowRight');
	await test.press('ArrowRight');
	await test.press('ArrowDown');
	await test.press('ArrowUp');
	await test.press('Tab');
	await test.press('Home');
	await test.frame();
}
