import { FSM_RETARGET_CART_SOURCE } from '../../helpers/fsm_retarget_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical authoring, review and real source installation. No host Lua calls or patched guest tables. */
export async function runStudioFsmDragLive(test: StudioFixture) {
	const { runtime, ide, execution, tasks, harness, guest, press, click, until, frame, cycles, runMenuCommand, runPaletteCommand,
		movePointer, setPointerButton, setKey } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'FSM drag: normal cart boot');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_RETARGET_CART_SOURCE }]);
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.action === 'reboot', 'FSM drag: ordinary source Save/Reboot admission');
	await press('Enter');
	await until(() => tasks.ready && guest.global('fsm_drag_init_count') === 1 && !runtime.completionCallPending(), 'FSM drag: authored fixture boots normally');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('cart') === FSM_RETARGET_CART_SOURCE, 'FSM drag: actual source/media installed');
	const machine = guest.global('fsm_drag_machine');
	const second = guest.global('fsm_drag_second');
	const idle = guest.readStringMember(machine, 'current_state');
	const data = guest.readStringMember(machine, 'data');
	const actor = guest.global('fsm_drag_target');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.drag.one', 'STATE MACHINES');
	const lens = getActiveTab();
	const pane = ide.editor.editorPanes.activePane;
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph' || !(pane instanceof BehaviorLensEditorPane)) throw new Error('FSM drag: concrete FSM pane required');
	const review = pane.sourceEditReview;
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	const ready = () => until(() => graph.layoutState.kind === 'ready', 'FSM drag: current layout published');
	await ready();
	const point = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y });
	const begin = async () => {
		const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
		await press('Home');
		for (let index = 0; index < viewport.model.nodes.length + viewport.model.edges.indexOf(edge); index += 1) await press('Tab');
		check(viewport.selection === edge && lens.view.selection?.kind === 'state-outcome', 'FSM drag: exact edge selected by keyboard');
		const points = edge.points;
		movePointer(point(points[points.length - 2] + viewport.bounds.left - viewport.scrollX,
			points[points.length - 1] + viewport.bounds.top - viewport.scrollY));
		await frame(); setPointerButton('pointer_primary', true); await frame();
		const target = viewport.model.nodes.find(node => node.source.label === 'other')!;
		movePointer(point((target.bounds.left + target.bounds.right) / 2 + viewport.bounds.left - viewport.scrollX,
			target.bounds.top + target.headerHeight / 2 + viewport.bounds.top - viewport.scrollY));
		await frame();
	};
	const release = async () => { setPointerButton('pointer_primary', false); await frame(); };
	const unchanged = (version: number, label: string) => check(model.version === version && cycles() === position && ide.sources.currentBlua32Media === media, label);
	let version = model.version;
	await begin();
	for (let index = 0; index < 8; index += 1) await frame();
	unchanged(version, 'FSM drag: held preview is not a source or guest mutation');
	await press('Escape'); await release();
	check(!review.visible, 'FSM drag: Escape cancels the physical gesture');
	unchanged(version, 'FSM drag: cancelled drag creates no edit');
	await begin(); await press('ControlLeft', 'ShiftLeft', 'KeyP'); await press('Escape'); await release();
	check(!review.visible, 'FSM drag: palette interruption cannot resurrect a drop');
	await begin(); await release();
	check(review.visible && review.tree.rows.length === 2, 'FSM drag: shared callback requires review of both registrations');
	unchanged(version, 'FSM drag: release opens review without applying it');
	await click(review.actionBar.items[2].bounds, 5);
	check(!review.visible, 'FSM drag: actual Discard button closes review');
	unchanged(version, 'FSM drag: held Discard neither applies nor clicks through to graph');
	await begin(); await release(); await press('Escape');
	check(!review.visible && getActiveTab() === lens, 'FSM drag: review Escape discards without navigating');
	await begin(); await release();
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await click(editorChromeState.tabButtonBounds.get(lens.id)!); await ready();
	check(!review.visible, 'FSM drag: changing panes disposes the proposal');
	await begin(); await release();
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	check(!ide.editor.commands.isEnabled('sourceEditReview.apply'), 'FSM drag: readonly immediately revokes Apply');
	await frame(); model.refreshResource(resource); await frame();
	check(!review.visible, 'FSM drag: restored writability cannot revive the old review');
	unchanged(version, 'FSM drag: lifecycle cancellation leaves source and guest untouched');
	await begin(); await release();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- review invalidation\n' }]);
	check(!review.visible, 'FSM drag: a source edit immediately disposes pending proposal');
	await press('ControlLeft', 'KeyZ'); await ready();
	check(model.buffer.getText() === FSM_RETARGET_CART_SOURCE, 'FSM drag: ordinary Undo of external edit restores source, not review');
	version = model.version;
	await begin(); await release(); await press('ArrowDown');
	const selectedRow = review.tree.rows[review.tree.selectionIndex].element;
	check(selectedRow.label.includes('fixture.drag.two'), 'FSM drag: impact rows retain separate registrations');
	await click(review.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && !review.visible && !hasSelection(), 'FSM drag: impact Source navigates without selection leak');
	const range = selectedBehaviorLensSourceRange(lens.view)!;
	check(activeCodeEditor.view.cursorRow === range.start.line - 1 && activeCodeEditor.view.cursorColumn === range.start.column - 1,
		'FSM drag: impact Source reaches the exact callback return');
	unchanged(version, 'FSM drag: impact Source does not dirty source');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!); await ready();
	await begin(); await release();
	await runPaletteCommand('Review: Apply Source Edit'); await ready();
	check(!review.visible && model.version === version + 1, 'FSM drag: palette restores review focus before applying');
	await runPaletteCommand('Edit: Undo'); await ready();
	check(model.buffer.getText() === FSM_RETARGET_CART_SOURCE, 'FSM drag: palette Apply uses the same one-edit history');
	version = model.version;
	await begin(); await release();
	await press('ControlLeft', 'ShiftLeft', 'KeyP'); await press('Escape');
	check(review.visible, 'FSM drag: palette dismissal returns to the pending review');
	await click(review.actionBar.items[1].bounds, 6); await ready();
	const changed = FSM_RETARGET_CART_SOURCE.replace("--[[chosen path]] 'active'", "--[[chosen path]] 'other'");
	check(model.buffer.getText() === changed && model.version === version + 1 && !review.visible, 'FSM drag: held Apply commits one exact literal edit');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'FSM drag: acceptance still does not install or run the guest');
	check(viewport.selection?.kind === 'edge' && viewport.selection.link.target.source.label === 'other', 'FSM drag: new layout selects the exact changed proof');
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && model.version === version + 1 && !hasSelection(), 'FSM drag: post-edit Source is read-only navigation');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === FSM_RETARGET_CART_SOURCE, 'FSM drag: one hidden code Undo restores source');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!); await ready();
	await runPaletteCommand('Edit: Redo'); await ready();
	check(model.buffer.getText() === changed && viewport.selection?.kind === 'edge' && viewport.selection.link.target.source.label === 'other',
		'FSM drag: graph palette Redo restores source and selection');
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'FSM drag: source edit uses ordinary Save/Hot Resume');
	await press('Enter');
	await until(() => tasks.ready && !runtime.completionCallPending() && guest.global('fsm_drag_init_count') === 2, 'FSM drag: Hot Resume installs authored revision');
	check(model.lastSavedSource === changed && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'FSM drag: saved and installed source match');
	check(guest.global('fsm_drag_machine') === machine && guest.global('fsm_drag_second') === second
		&& guest.readStringMember(machine, 'current_state') === idle && guest.readStringMember(machine, 'data') === data
		&& guest.readStringMember(data, 'retained') === 73, 'FSM drag: definition rebind preserves both live machines, current state and data');
	const guestPress = async (key: string) => {
		setKey(key, true); for (let index = 0; index < 4; index += 1) await frame();
		setKey(key, false); for (let index = 0; index < 4; index += 1) await frame();
	};
	await guestPress('KeyX');
	check(guest.readStringMember(actor, 'calls') === 2 && guest.readStringMember(actor, 'guards') === 2
		&& guest.readStringMember(actor, 'exits') === 0 && guest.readStringMember(machine, 'current_state') === idle,
		'FSM drag: guest ICU event reaches both changed callbacks and real guards reject entry');
	await guestPress('KeyZ'); await guestPress('KeyX');
	check(guest.readStringMember(actor, 'calls') === 4 && guest.readStringMember(actor, 'guards') === 4
		&& guest.readStringMember(actor, 'exits') === 2 && guest.readStringMember(actor, 'entries') === 2,
		'FSM drag: later ICU input admits both transitions with normal exit/entry effects');
	check(guest.formatValue(guest.readStringMember(machine, 'current_id')) === 'other'
		&& guest.formatValue(guest.readStringMember(second, 'current_id')) === 'other', 'FSM drag: both actual machines enter the newly authored target');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	check(execution.userPaused, 'FSM drag: final view is paused without coupling pause to authoring');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.drag.single', 'STATE MACHINES'); await ready();
	version = model.version;
	await begin(); await release(); await ready();
	check(!review.visible && model.version === version + 1 && model.buffer.getText().includes("on = { choose = 'other' }"),
		'FSM drag: one recognized direct use commits on physical drop without a review');
	await runPaletteCommand('Edit: Undo'); await ready();
	check(model.buffer.getText() === changed, 'FSM drag: direct drop also has one ordinary Undo');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.drag.one', 'STATE MACHINES'); await ready();
	// Keep the review visible in the final backend screenshot, without changing saved source.
	const oldTarget = viewport.model.nodes.find(node => node.source.label === 'active')!;
	const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
	await press('Home'); for (let index = 0; index < viewport.model.nodes.length + viewport.model.edges.indexOf(edge); index += 1) await press('Tab');
	movePointer(point(edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX, edge.points[edge.points.length - 1] + viewport.bounds.top - viewport.scrollY));
	await frame(); setPointerButton('pointer_primary', true); await frame();
	movePointer(point((oldTarget.bounds.left + oldTarget.bounds.right) / 2 + viewport.bounds.left - viewport.scrollX, oldTarget.bounds.top + oldTarget.headerHeight / 2 + viewport.bounds.top - viewport.scrollY));
	await frame(); await release();
	check(review.visible && model.buffer.getText() === changed, 'FSM drag: final screenshot is a genuine unapplied impact review');
	console.info('STUDIO: FSM physical retarget / review / source history / live Hot Resume PASS');
	return { hostFrames: test.observations.hostFrames, hotResumeInstalls: 1, sharedMachines: 2, target: 'other' };
}
