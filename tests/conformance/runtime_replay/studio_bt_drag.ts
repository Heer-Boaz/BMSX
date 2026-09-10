import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import type { BehaviorGraphNode } from '../../../ide/workbench/contrib/behavior_lens/graph_model';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_ORDER_SOURCE } from '../../helpers/behavior_order_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical capture/drop/source/history on the actual Studio, using independent authored Lua. */
export async function testStudioBtDrag(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, movePointer, setPointerButton, runPaletteCommand, cycles, until } = test;
	console.info('STUDIO: BT drag / insertion / cancellation');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_ORDER_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.order', 'BEHAVIOR TREES');
	let lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT drag requires the concrete graph');
	let graph = lens.view.presentation;
	let viewport = graph.viewport;
	const children = () => viewport.model.nodes[0].children[0].children;
	const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
	const cardPoint = (node: BehaviorGraphNode, before: boolean) => point(
		node.bounds.left + (node.bounds.right - node.bounds.left) * (before ? 0.25 : 0.75) + viewport.bounds.left - viewport.scrollX,
		node.bounds.top + node.headerHeight / 2 + viewport.bounds.top - viewport.scrollY);
	const begin = async (source: BehaviorGraphNode, target: BehaviorGraphNode, before: boolean) => {
		movePointer(cardPoint(source, true));
		await frame();
		setPointerButton('pointer_primary', true);
		await frame();
		movePointer(cardPoint(target, before));
		await frame();
	};
	const release = async () => { setPointerButton('pointer_primary', false); await frame(); };
	const unchanged = (version: number, message: string) => check(model.version === version && model.buffer.getText() === BT_ORDER_SOURCE, message);

	let version = model.version;
	const geometry = viewport.model;
	const document = lens.view.document;
	await begin(children()[0], children()[2], false);
	for (let index = 0; index < 6; index += 1) await frame();
	unchanged(version, 'BT drag: held preview neither edits Lua nor creates history');
	check(viewport.model === geometry && lens.view.document === document, 'BT drag: motion reuses source projection and layout');
	console.info('STUDIO: BT drag preview ready for visual inspection');
	await release();
	check(model.version === version + 1 && viewport.selection === children()[2]
		&& readLuaSourceRange(model.buffer, children()[2].source.occurrenceRange) === 'leaf', 'BT drag: nonadjacent drop moves the selected authored occurrence once');
	const moved = model.buffer.getText();
	const selected = children()[2];
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === selected.source.occurrenceRange.start.line - 1
		&& activeCodeEditor.view.cursorColumn === selected.source.occurrenceRange.start.column - 1 && !hasSelection()
		&& model.buffer.getText() === moved, 'BT drag: Source navigates to the moved occurrence without a leaked pointer or extra edit');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT drag: one code Undo restores the complete drag edit');
	await test.clickTab(lens.id);
	check(viewport.selection === children()[0], 'BT drag: hidden Undo restores the selected occurrence');

	version = model.version;
	await begin(children()[0], children()[2], false);
	await press('Escape');
	check(getActiveTab() === lens, 'BT drag: Escape cancels the gesture instead of navigating to definition source');
	await release();
	unchanged(version, 'BT drag: Escape does not commit a previous accepted preview');
	await begin(children()[0], children()[2], false);
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(ide.editor.quickInput.visible, 'BT drag: palette owns focus while a pointer was held');
	await press('Escape');
	await release();
	unchanged(version, 'BT drag: palette dismissal does not resurrect capture');
	await begin(children()[0], children()[2], false);
	movePointer(point(viewport.bounds.left + 2, viewport.bounds.top - 2));
	await release();
	unchanged(version, 'BT drag: releasing outside the graph does not reuse its last accepted target');
	await begin(children()[0], children()[2], false);
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	await frame();
	model.refreshResource(resource);
	await release();
	unchanged(version, 'BT drag: becoming writable again cannot revive an interrupted readonly gesture');
	await begin(children()[0], children()[2], false);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- concurrent source edit' }]);
	await release();
	check(model.version === version + 1 && model.buffer.getText() === BT_ORDER_SOURCE + '\n-- concurrent source edit',
		'BT drag: source changed before release; only that source edit is present');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT drag: cancellation created no history entry');
	const wheelVersion = model.version;
	await begin(children()[0], children()[2], false);
	const scroll = viewport.scrollY;
	test.input.inputAxis1('pointer:0', 'pointer_wheel', WHEEL_SCROLL_STEP, test.clock.now());
	await frame();
	check(viewport.scrollY !== scroll, 'BT drag: physical wheel reaches the captured graph');
	test.input.inputAxis1('pointer:0', 'pointer_wheel', -WHEEL_SCROLL_STEP, test.clock.now());
	await frame();
	unchanged(wheelVersion, 'BT drag: wheel refreshes preview without a document edit');
	await release();
	check(model.version === wheelVersion + 1 && viewport.selection === children()[2], 'BT drag: wheel scrolling keeps the same source gesture alive until drop');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT drag: wheel plus drop is one Undo');

	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.weighted-order', 'BEHAVIOR TREES');
	const nextDefinition2 = getActiveTab();
	if (nextDefinition2.kind !== 'behavior_lens' || nextDefinition2.view.presentation.kind !== 'graph') throw new Error('BT: separate definition graph missing');
	check(nextDefinition2 !== lens && nextDefinition2.workingCopy === model, 'BT: another definition has its own input and the same working copy');
	lens = nextDefinition2;
	graph = nextDefinition2.view.presentation;
	viewport = graph.viewport;
	const child = children()[2];
	const edge = viewport.model.edges.find(edge => edge.child === child)!;
	movePointer(point(edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX,
		edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY));
	await frame();
	setPointerButton('pointer_primary', true);
	await frame();
	check(viewport.selection === edge, 'BT drag: a weighted connection is an actual drag source');
	movePointer(cardPoint(children()[0], true));
	await frame();
	await release();
	check(viewport.selection?.kind === 'edge' && viewport.selection.child === children()[0]
		&& readLuaSourceRange(model.buffer, viewport.selection.range) === '{ weight = 3, child = make_node(3) }',
		'BT drag: the complete weighted wrapper moves with the connection selection');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT drag: weighted drop is one ordinary Undo');

	// Offscreen siblings must be reachable during capture, without direct viewport-state writes.
	const wide = `local trees<const> = require('cartlib/behaviour_tree/library')\ntrees.register('fixture.wide', { root = { type = 'sequence', children = {\n${
		Array.from({ length: 12 }, (_, index) => `{ type = 'wait', duration_ticks = ${index + 1} }`).join(',\n')}\n} } })\n`;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: wide }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.wide', 'BEHAVIOR TREES');
	const nextDefinition3 = getActiveTab();
	if (nextDefinition3.kind !== 'behavior_lens' || nextDefinition3.view.presentation.kind !== 'graph') throw new Error('BT: separate definition graph missing');
	check(nextDefinition3 !== lens && nextDefinition3.workingCopy === model, 'BT: another definition has its own input and the same working copy');
	lens = nextDefinition3;
	graph = nextDefinition3.view.presentation;
	viewport = graph.viewport;
	await press('ArrowDown');
	await press('ArrowDown');
	check(viewport.selection === children()[0], 'BT drag: ordinary graph navigation reveals the first wide-list child');
	movePointer(cardPoint(children()[0], true));
	await frame();
	setPointerButton('pointer_primary', true);
	await frame();
	movePointer(point(viewport.bounds.right - 1, children()[0].bounds.top + children()[0].headerHeight / 2 + viewport.bounds.top - viewport.scrollY));
	await frame();
	const wideGeometry = viewport.model;
	await until(() => children()[11].bounds.right + viewport.bounds.left - viewport.scrollX < viewport.bounds.right - 14, 'BT drag edge-scroll reveals an offscreen sibling');
	check(viewport.model === wideGeometry && model.buffer.getText() === wide, 'BT drag: captured edge scrolling changes no source or layout generation');
	movePointer(cardPoint(children()[11], false));
	await frame();
	console.info('STUDIO: BT offscreen sibling insertion ready for visual inspection');
	await release();
	check(viewport.selection === children()[11] && readLuaSourceRange(model.buffer, children()[11].source.occurrenceRange) === '{ type = \'wait\', duration_ticks = 1 }',
		'BT drag: offscreen nonadjacent sibling is reachable with one physical gesture');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === wide, 'BT drag: scroll plus drop remains one history element');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE, 'BT drag: previous authored document is restored by its own Undo');
	await test.clickTab(code.id);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'BT drag: fixture edits restore the source without modifying or resuming the paused machine');
	console.info('STUDIO: BT drag / source history / cancellation PASS');
}
