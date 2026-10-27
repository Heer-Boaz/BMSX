
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { WorkspaceEditReviewInput } from '../../../ide/workbench/contrib/edit_review/editor_input';
import type { BehaviorGraphNode } from '../../../ide/workbench/contrib/behavior_lens/graph_model';
import { BT_REPARENT_SOURCE, BT_REPARENT_MODULE_SOURCE } from '../../helpers/behavior_reparent_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { sourcePane, check, type StudioFixture } from './studio_fixture';

/** Actual capture, review, source history and selection; independent of a game's tree definitions. */
export async function testStudioBtReparent(test: StudioFixture): Promise<void> {
	for (const imported of [false, true]) await runReparent(test, imported);
}

async function runReparent(test: StudioFixture, imported: boolean): Promise<void> {
	const { ide, harness, frame, press, click, movePointer, setPointerButton, runPaletteCommand, cycles } = test;
	console.info(`STUDIO: BT ${imported ? 'imported' : 'local'} cross-depth drag / review / source / Undo`);
	harness.openLuaSource('cart.lua');
	const main = sourcePane(test).code.model, originalMain = main.buffer.getText();
	if (imported) {
		const record = ide.sources.catalog.getContext(main.resource.contextId).luaSources.records.find(record =>
			record.program_module && !record.generated && record.source_path !== main.resource.path && !record.module_path.startsWith('cartlib/'))!;
		main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length,
			text: `local trees<const> = require('cartlib/behaviour_tree/library')\ntrees.register('fixture.reparent', require('${record.module_path}'))` }]);
		harness.openLuaSource(record.source_path);
	}
	const model = sourcePane(test).code.model;
	const original = model.buffer.getText();
	const source = imported ? BT_REPARENT_MODULE_SOURCE : BT_REPARENT_SOURCE;
	const position = cycles(), media = ide.sources.currentBlua32Media;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	const mainVersion = main.version;
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.reparent');
	const lens = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT reparent requires its graph input');
	const viewport = lens.view.presentation.viewport;
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
		const review = ide.editor.editorParts.activeGroup.model.activeTab;
		if (!(review instanceof WorkspaceEditReviewInput)) throw new Error('reparent: physical drop must open the unified review tab');
		check(review.proposal.state === 'pending', 'reparent: compatible list move opens pending source review');
		return review;
	};
	let version = model.version;
	let review = await drop(root().children[0], root().children[2], 0.5);
	check(model.version === version, 'reparent: preview/drop does not edit before Apply');
	check(review.evidence.items.some(item => item.value === 'leaf'),
		'reparent: review identifies the written reference and eager read');
	console.info('STUDIO: BT reparent review ready for visual inspection');
	await runPaletteCommand('Review: Discard Workspace Edit');
	check(review.proposal.state === 'discarded' && ide.editor.editorParts.activeGroup.model.activeTab === review && model.version === version, 'reparent: Discard retains evidence without edits');
	await test.clickTab(lens.id);
	review = await drop(root().children[0], root().children[2], 0.5);
	await click(review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!.bounds, 6);
	check(review.proposal.state === 'applied' && ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && model.version === version + 1,
		'reparent: accepted source opens its working copy and retains review evidence');
	await test.clickTab(lens.id);
	check(root().children.length === 2,
		'reparent: held Apply commits one source operation');
	const moved = root().children[1].children[0];
	check(viewport.selection === moved && readLuaSourceRange(model.buffer, moved.source.occurrenceRange) === 'leaf',
		'reparent: the new depth selects the written destination occurrence');
	console.info('STUDIO: BT reparented canvas ready for visual inspection');
	const changed = model.buffer.getText();
	await press('Enter');
	check(sourcePane(test).code.model === model && sourcePane(test).code.view.cursorRow === moved.source.occurrenceRange.start.line - 1,
		'reparent: Source navigates to the new occurrence');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'reparent: one code Undo restores all source bytes');
	await test.clickTab(lens.id);
	check(viewport.selection === root().children[0], 'reparent: hidden Undo restores the old graph occurrence');
	await press('ControlLeft', 'ShiftLeft', 'KeyZ');
	check(model.buffer.getText() === changed && viewport.selection === root().children[1].children[0],
		'reparent: graph Redo restores both destination and selection');
	await press('ControlLeft', 'KeyZ');
	await drop(root().children[1].children[0].children[0], root().children[2], 0.8);
	await runPaletteCommand('Review: Apply Workspace Edit');
	await test.clickTab(lens.id);
	check(root().children.length === 4 && root().children[1].children[0].children.length === 0
		&& viewport.selection === root().children[3], 'reparent: an only child moves upward, leaving its authored list empty');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'reparent: upward source move is also one Undo');
	version = model.version;
	review = await drop(root().children[0], root().children[2], 0.5);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- new generation' }]);
	await frame();
	check(review.proposal.state === 'stale' && ide.editor.editorParts.activeGroup.model.activeTab === review && model.version === version + 1, 'reparent: changed source revokes the pending proposal');
	await test.clickTab(lens.id);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'reparent: Undo restores the fixture, not the expired proposal');
	harness.openLuaSource(model.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'reparent: fixture cleanup leaves installed media and the paused machine unchanged');
	if (imported) {
		check(main.version === mainVersion, 'reparent: imported drag/review/Undo never writes the registration source');
		harness.openLuaSource(main.resource.path); await press('ControlLeft', 'KeyZ');
		check(main.buffer.getText() === originalMain, 'reparent: registration fixture has its own history');
	}
	console.info('STUDIO: BT cross-depth drag / review / source / Undo PASS');
}
