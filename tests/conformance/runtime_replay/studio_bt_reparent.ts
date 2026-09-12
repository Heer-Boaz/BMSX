import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorGraphNode } from '../../../ide/workbench/contrib/behavior_lens/graph_model';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_REPARENT_SOURCE } from '../../helpers/behavior_reparent_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Actual capture, review, source history and selection; independent of a game's tree definitions. */
export async function testStudioBtReparent(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, movePointer, setPointerButton, runPaletteCommand, cycles } = test;
	console.info('STUDIO: BT cross-depth drag / review / source / Undo');
	harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	const position = cycles(), media = ide.sources.currentBlua32Media;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_REPARENT_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.reparent', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT reparent requires its graph input');
	const viewport = lens.view.presentation.viewport;
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof BehaviorLensEditorPane)) throw new Error('BT reparent requires the Behavior Lens pane');
	const review = pane.sourceEditReview;
	await runPaletteCommand('Graph: Zoom Out');
	const root = () => viewport.model.nodes[0].children[0];
	const point = (node: BehaviorGraphNode, fraction: number) => {
		const x = viewport.graphToViewportX(node.bounds.left + (node.bounds.right - node.bounds.left) * fraction);
		const y = viewport.graphToViewportY(node.bounds.top + node.headerHeight / 2);
		check(x > viewport.bounds.left && x < viewport.bounds.right && y > viewport.bounds.top && y < viewport.bounds.bottom,
			'reparent: the physical target is visible inside the graph');
		return { left: x, right: x, top: y, bottom: y };
	};
	const drop = async (source: BehaviorGraphNode, target: BehaviorGraphNode, fraction: number) => {
		// Undo reveals its selected occurrence, not the next test's unrelated pair.
		viewport.reveal(source); viewport.reveal(target);
		movePointer(point(source, 0.2)); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(point(target, fraction)); await frame();
		setPointerButton('pointer_primary', false); await frame();
		check(review.visible, 'reparent: dropping a compatible list move opens source review');
	};
	let version = model.version;
	await drop(root().children[0], root().children[2], 0.5);
	check(model.version === version, 'reparent: preview/drop does not edit before Apply');
	check(review.tree.rows.some(row => row.element.value === 'leaf') && review.tree.rows.some(row => row.element.label === 'POTENTIAL READ'),
		'reparent: review identifies the written reference and eager read');
	console.info('STUDIO: BT reparent review ready for visual inspection');
	await press('Escape');
	check(!review.visible && model.version === version, 'reparent: Escape discards the proposal without edits');
	await drop(root().children[0], root().children[2], 0.5);
	await click(review.actionBar.items.find(item => item.command === 'sourceEditReview.apply')!.bounds, 6);
	check(!review.visible && model.version === version + 1 && root().children.length === 2,
		'reparent: held Apply commits one source operation');
	const moved = root().children[1].children[0];
	check(viewport.selection === moved && readLuaSourceRange(model.buffer, moved.source.occurrenceRange) === 'leaf',
		'reparent: the new depth selects the written destination occurrence');
	console.info('STUDIO: BT reparented canvas ready for visual inspection');
	const changed = model.buffer.getText();
	await press('Enter');
	check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === moved.source.occurrenceRange.start.line - 1,
		'reparent: Source navigates to the new occurrence');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_REPARENT_SOURCE, 'reparent: one code Undo restores all source bytes');
	await test.clickTab(lens.id);
	check(viewport.selection === root().children[0], 'reparent: hidden Undo restores the old graph occurrence');
	await press('ControlLeft', 'ShiftLeft', 'KeyZ');
	check(model.buffer.getText() === changed && viewport.selection === root().children[1].children[0],
		'reparent: graph Redo restores both destination and selection');
	await press('ControlLeft', 'KeyZ');
	await drop(root().children[1].children[0].children[0], root().children[2], 0.8);
	await runPaletteCommand('Review: Apply Source Edit');
	check(root().children.length === 4 && root().children[1].children[0].children.length === 0
		&& viewport.selection === root().children[3], 'reparent: an only child moves upward, leaving its authored list empty');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_REPARENT_SOURCE, 'reparent: upward source move is also one Undo');
	version = model.version;
	await drop(root().children[0], root().children[2], 0.5);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- new generation' }]);
	await frame();
	check(!review.visible && model.version === version + 1, 'reparent: changed source revokes the pending proposal');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_REPARENT_SOURCE, 'reparent: Undo restores the fixture, not the expired proposal');
	harness.openLuaSource(model.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'reparent: fixture cleanup leaves installed media and the paused machine unchanged');
	console.info('STUDIO: BT cross-depth drag / review / source / Undo PASS');
}
