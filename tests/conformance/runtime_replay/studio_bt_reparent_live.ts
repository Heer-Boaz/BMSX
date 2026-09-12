import { BT_REPARENT_LIVE_SOURCE } from '../../helpers/behavior_reparent_live_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorGraphNode } from '../../../ide/workbench/contrib/behavior_lens/graph_model';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical reparent -> workspace Save -> real Hot Resume, retaining the existing guest instance. */
export async function runStudioBtReparentLive(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, click, until, frame, cycles, runMenuCommand, runPaletteCommand,
		movePointer, setPointerButton, setKey } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'BT live: normal cart boot');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	harness.openLuaSource('cart.lua');
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_REPARENT_LIVE_SOURCE }]);
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.action === 'reboot', 'BT live: fixture uses ordinary Save/Reboot admission');
	await press('Enter');
	await until(() => tasks.ready && guest.global('bt_live_init_count') === 1 && !runtime.completionCallPending(), 'BT live: authored fixture boots');
	const actor = guest.global('bt_live_target'), tree = guest.global('bt_live_tree');
	const blackboard = guest.readStringMember(tree, 'blackboard');
	let executions = 0;
	const execute = async (order: number) => {
		setKey('KeyX', true); for (let index = 0; index < 4; index += 1) await frame();
		setKey('KeyX', false); for (let index = 0; index < 4; index += 1) await frame();
		check(guest.readStringMember(actor, 'executions') === ++executions && guest.readStringMember(actor, 'order') === order,
			`BT live: real ICU edge executes the authored task order ${order} exactly once`);
		check(guest.global('bt_live_target') === actor && guest.global('bt_live_tree') === tree
			&& guest.readStringMember(tree, 'blackboard') === blackboard && guest.readStringMember(actor, 'retained') === 73,
			'BT live: actor, component and blackboard identities and semantic value survive');
	};
	await execute(123);
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	const position = cycles(), media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.live', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	const pane = ide.editor.editorPanes.activePane;
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph' || !(pane instanceof BehaviorLensEditorPane)) {
		throw new Error('BT live: actual BT graph and contribution pane required');
	}
	const viewport = lens.view.presentation.viewport, review = pane.sourceEditReview;
	await runPaletteCommand('Graph: Zoom Out');
	const root = () => viewport.model.nodes[0].children[0];
	const source = root().children[0], target = root().children[1];
	const point = (node: BehaviorGraphNode) => {
		const x = viewport.graphToViewportX((node.bounds.left + node.bounds.right) / 2);
		const y = viewport.graphToViewportY(node.bounds.top + node.headerHeight / 2);
		check(x > viewport.bounds.left && x < viewport.bounds.right && y > viewport.bounds.top && y < viewport.bounds.bottom,
			'BT live: actual drag target visible in the canvas');
		return { left: x, right: x, top: y, bottom: y };
	};
	viewport.reveal(source); viewport.reveal(target);
	const version = model.version;
	movePointer(point(source)); await frame(); setPointerButton('pointer_primary', true); await frame();
	movePointer(point(target)); await frame(); setPointerButton('pointer_primary', false); await frame();
	check(review.visible && model.version === version, 'BT live: cross-depth release offers review without applying source');
	await click(review.actionBar.items.find(item => item.command === 'sourceEditReview.apply')!.bounds, 6);
	check(!review.visible && model.version === version + 1 && root().children.length === 2 && root().children[0].children.length === 2,
		'BT live: accepted physical drop moves one authored child into the nested sequence');
	const moved = root().children[0].children[1];
	check(viewport.selection === moved && readLuaSourceRange(model.buffer, moved.source.occurrenceRange) === 'first',
		'BT live: source selection follows the exact moved occurrence');
	const changed = model.buffer.getText();
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'BT live: workspace Save completes');
	check(model.lastSavedSource === changed && cycles() === position && ide.sources.currentBlua32Media === media
		&& getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'BT live: Save changes source, not the paused installed program');
	await runPaletteCommand('Run: Hot Resume');
	await until(() => tasks.ready && guest.global('bt_live_init_count') === 2 && !runtime.completionCallPending(), 'BT live: changed source installed through Hot Resume');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('cart') === changed
		&& getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'BT live: the actual installed revision matches saved source');
	await execute(213);

	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	await test.clickTab(lens.id); await runPaletteCommand('Edit: Undo');
	check(model.buffer.getText() === BT_REPARENT_LIVE_SOURCE && viewport.selection === root().children[0],
		'BT live: one Undo after installation restores original source and graph selection');
	await press('ControlLeft', 'KeyS'); await until(() => !model.dirty, 'BT live: undone source saved');
	await runPaletteCommand('Run: Hot Resume');
	await until(() => tasks.ready && guest.global('bt_live_init_count') === 3 && !runtime.completionCallPending(), 'BT live: undo revision installed through Hot Resume');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('cart') === BT_REPARENT_LIVE_SOURCE,
		'BT live: restored source is installed, not just projected');
	await execute(123);
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	await test.clickTab(lens.id);
	console.info('STUDIO: BT cross-depth drag / Save / live Hot Resume / Undo / retained blackboard PASS');
	return { hostFrames: test.observations.hostFrames, hotResumeInstalls: 2, executions, orders: [123, 213, 123] };
}
