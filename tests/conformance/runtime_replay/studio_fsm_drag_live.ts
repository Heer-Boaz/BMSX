import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { testStudioGraphNavigation } from './studio_graph_navigation';
import { FSM_RETARGET_CART_SOURCE, FSM_RETARGET_CART_CALLBACK_SOURCE, fsmRetargetImportedCartSource } from '../../helpers/fsm_retarget_fixture';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { WorkspaceEditReviewInput } from '../../../ide/workbench/contrib/edit_review/editor_input';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Physical authoring, review and real source installation. No host Lua calls or patched guest tables. */
export async function runStudioFsmDragLive(test: StudioFixture, imported = false) {
	const { runtime, ide, execution, tasks, harness, guest, press, click, until, frame, cycles, runMenuCommand, runPaletteCommand,
		movePointer, setPointerButton, setKey } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'FSM drag: normal cart boot');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	harness.openLuaSource('cart.lua');
	const main = harness.getActiveEditorDocument().model;
	let cartSource = FSM_RETARGET_CART_SOURCE;
	if (imported) {
		const record = runtimeLuaSourceRegistry(ide.sources, main.resource.domain)!.records.find(record =>
			record.program_module && !record.generated && record.source_path !== main.resource.path && !record.module_path.startsWith('cartlib/'))!;
		cartSource = fsmRetargetImportedCartSource(record.module_path);
		harness.openLuaSource(record.source_path);
	}
	const code = getActiveTab();
	const model = harness.getActiveEditorDocument().model;
	const source = imported ? FSM_RETARGET_CART_CALLBACK_SOURCE : cartSource;
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length, text: cartSource }]);
	if (imported) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	await runPaletteCommand('Run: Reboot');
	check(test.ide.editor.actionPrompt.visible, 'FSM drag: ordinary source Save/Reboot admission');
	await press('Enter');
	await until(() => tasks.ready && guest.global('fsm_drag_init_count') === 1 && !runtime.completionCallPending(), 'FSM drag: authored fixture boots normally');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('cart') === cartSource, 'FSM drag: actual source/media installed');
	const machine = guest.global('fsm_drag_machine');
	const second = guest.global('fsm_drag_second');
	const idle = guest.readStringMember(machine, 'current_state');
	const data = guest.readStringMember(machine, 'data');
	const actor = guest.global('fsm_drag_target');
	const mainVersion = main.version;
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.drag.one');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('FSM drag: concrete FSM pane required');
	const currentReview = () => {
		const input = getActiveTab();
		if (!(input instanceof WorkspaceEditReviewInput)) throw new Error('FSM drag: physical drop must open the unified review tab');
		return input;
	};
	let graph = lens.view.presentation;
	let viewport = graph.viewport;
	const ready = () => until(() => graph.layoutState.kind === 'ready', 'FSM drag: current layout published');
	await ready();
	await testStudioGraphNavigation(test);
	await runPaletteCommand('Graph: Zoom Out');
	const point = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y });
	const begin = async () => {
		const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
		await press('Home');
		for (let index = 0; index < viewport.model.nodes.length + viewport.model.edges.indexOf(edge); index += 1) await press('ArrowDown');
		const input = getActiveTab();
		check(input.kind === 'behavior_lens' && viewport.selection === edge && input.view.selection?.kind === 'state-outcome', 'FSM drag: exact edge selected by keyboard');
		const points = edge.points;
		movePointer(point(viewport.graphToViewportX(points[points.length - 2]), viewport.graphToViewportY(points[points.length - 1])));
		await frame(); setPointerButton('pointer_primary', true); await frame();
		const target = Array.from(viewport.model.nodesBySource.values()).find(node => node.source.label === 'other')!;
		movePointer(point(viewport.graphToViewportX((target.bounds.left + target.bounds.right) / 2),
			viewport.graphToViewportY(target.bounds.top + target.headerHeight / 2)));
		await frame();
	};
	const release = async () => { setPointerButton('pointer_primary', false); await frame(); };
	const unchanged = (version: number, label: string) => check(model.version === version && (!imported || main.version === mainVersion)
		&& cycles() === position && ide.sources.currentBlua32Media === media, label);
	let version = model.version;
	await begin();
	for (let index = 0; index < 8; index += 1) await frame();
	unchanged(version, 'FSM drag: held preview is not a source or guest mutation');
	await press('Escape'); await release();
	check(getActiveTab() === lens, 'FSM drag: Escape cancels the physical gesture');
	unchanged(version, 'FSM drag: cancelled drag creates no edit');
	await begin(); await press('ControlLeft', 'ShiftLeft', 'KeyP'); await press('Escape'); await release();
	check(getActiveTab() === lens, 'FSM drag: palette interruption cannot resurrect a drop');
	await begin(); await release();
	let review = currentReview();
	check(review.proposal.state === 'pending' && review.evidence.items.length === 2, 'FSM drag: shared callback requires review of both registrations');
	unchanged(version, 'FSM drag: release opens review without applying it');
	movePointer(review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!.bounds); await frame(); setPointerButton('pointer_primary', true); await frame();
	unchanged(version, 'A01: Apply does not write while its button is held');
	movePointer(point((review.viewport.bounds.left + review.viewport.bounds.right) / 2, (review.viewport.bounds.top + review.viewport.bounds.bottom) / 2)); await release();
	check(review.proposal.state === 'pending', 'A01: release outside Apply leaves the review open');
	unchanged(version, 'A01: cancelled Apply has no history element');
	await click(review.actionBar.items.find(item => item.command === 'workspaceEditReview.discard')!.bounds, 5);
	check(review.proposal.state === 'discarded' && getActiveTab() === review, 'FSM drag: actual Discard retains settled evidence');
	unchanged(version, 'FSM drag: held Discard neither applies nor clicks through to graph');
	await test.clickTab(lens.id); await ready();
	await begin(); await release(); review = currentReview();
	await test.clickTab(code.id); await test.clickTab(lens.id); await ready();
	check(review.proposal.state === 'pending', 'FSM drag: Source and graph navigation retain the pending review tab');
	await test.clickTab(review.id); await runPaletteCommand('Review: Discard Workspace Edit');
	await test.clickTab(lens.id); await ready();
	await begin(); await release(); review = currentReview();
	const resource = model.resource;
	model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	check(review.proposal.state === 'stale' && !ide.editor.commands.isEnabled('workspaceEditReview.apply'), 'FSM drag: readonly immediately revokes Apply');
	await frame(); model.refreshResource(resource); await frame();
	check(review.proposal.state === 'stale' && getActiveTab() === review, 'FSM drag: restored writability cannot revive the retained preview');
	unchanged(version, 'FSM drag: authority cancellation leaves source and guest untouched');
	await test.clickTab(lens.id); await ready();
	await begin(); await release(); review = currentReview();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- review invalidation\n' }]);
	check(review.proposal.state === 'stale', 'FSM drag: a source edit immediately retires pending authority');
	await test.clickTab(code.id); await press('ControlLeft', 'KeyZ');
	await test.clickTab(lens.id); await ready();
	check(model.buffer.getText() === source && review.proposal.state === 'stale', 'FSM drag: ordinary Undo restores source, not authority');
	version = model.version;
	await begin(); await release(); review = currentReview();
	const location = review.evidence.items[1].location;
	const positionAt = { row: 0, column: 0 }; location.model.buffer.positionAt(location.offset, positionAt);
	await runPaletteCommand('Review: Open Impact Source');
	check(ide.editor.quickInput.visible, 'FSM drag: Source offers captured written locations');
	await press('Home'); await press('ArrowDown'); await press('Enter');
	check(getActiveTab() === code && review.proposal.state === 'pending' && !hasSelection(), 'FSM drag: captured Source navigates without discarding or selection leak');
	check(activeCodeEditor.model === location.model && activeCodeEditor.view.cursorRow === positionAt.row
		&& activeCodeEditor.view.cursorColumn === positionAt.column, 'FSM drag: Source reaches the captured UTF-16 position');
	unchanged(version, 'FSM drag: impact Source does not dirty source');
	await test.clickTab(review.id); await runPaletteCommand('Review: Discard Workspace Edit');
	await test.clickTab(lens.id); await ready();
	await begin(); await release(); review = currentReview();
	await runPaletteCommand('Review: Apply Workspace Edit');
	check(review.proposal.state === 'applied' && getActiveTab() === code && model.version === version + 1, 'FSM drag: palette applies the admitted preview and retains evidence');
	await test.clickTab(lens.id); await ready(); await runPaletteCommand('Edit: Undo'); await ready();
	check(model.buffer.getText() === source, 'FSM drag: palette Apply uses the same one-edit history');
	version = model.version;
	await begin(); await release(); review = currentReview();
	await press('ControlLeft', 'ShiftLeft', 'KeyP'); await press('Escape');
	check(review.proposal.state === 'pending' && getActiveTab() === review, 'FSM drag: palette dismissal returns to the pending review');
	await press('Tab'); await press('Home');
	for (let step = 0; step < review.actionBar.items.length
		&& review.actionBar.items[review.actionBar.focusedIndex].command !== 'workspaceEditReview.apply'; step++) await press('ArrowRight');
	check(review.actionBar.hasFocus && review.actionBar.items[review.actionBar.focusedIndex].command === 'workspaceEditReview.apply',
		'A01: review toolbar is accessible through the shared focus route');
	await press('Space');
	const changed = source.replace("--[[chosen path]] 'active'", "--[[chosen path]] 'other'");
	check(model.buffer.getText() === changed && model.version === version + 1 && review.proposal.state === 'applied'
		&& getActiveTab() === code && (!imported || main.version === mainVersion), 'FSM drag: held Apply commits one exact literal edit');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'FSM drag: acceptance still does not install or run the guest');
	await test.clickTab(lens.id); await ready();
	check(viewport.selection?.kind === 'edge' && viewport.selection.link.target.source.label === 'other', 'FSM drag: new layout selects the exact changed proof');
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && model.version === version + 1 && !hasSelection(), 'FSM drag: post-edit Source is read-only navigation');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'FSM drag: one hidden code Undo restores source');
	await test.clickTab(lens.id); await ready();
	await runPaletteCommand('Edit: Redo'); await ready();
	check(model.buffer.getText() === changed && viewport.selection?.kind === 'edge' && viewport.selection.link.target.source.label === 'other',
		'FSM drag: graph palette Redo restores source and selection');
	await runPaletteCommand('Run: Hot Resume');
	check(test.ide.editor.actionPrompt.visible, 'FSM drag: source edit uses ordinary Save/Hot Resume');
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
	await chooseBehavior(test, 'FSM fixture.drag.single');
	const single = getActiveTab();
	if (single.kind !== 'behavior_lens' || single.view.presentation.kind !== 'state-graph') throw new Error('FSM drag: chosen direct registration requires its own graph');
	graph = single.view.presentation; viewport = graph.viewport;
	await ready();
	await runPaletteCommand('Graph: Zoom Out');
	version = main.version;
	const beforeSingle = main.buffer.getText();
	await begin(); await release(); await ready();
	check(getActiveTab() === single && main.version === version + 1 && main.buffer.getText().includes("on = { choose = 'other' }"),
		'FSM drag: one recognized direct use commits on physical drop without a review');
	await runPaletteCommand('Edit: Undo'); await ready();
	check(main.buffer.getText() === beforeSingle && model.buffer.getText() === changed, 'FSM drag: direct drop also has one ordinary Undo');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.drag.one');
	check(getActiveTab() === lens, 'FSM drag: reopening the shared registration restores its own retained input');
	graph = lens.view.presentation; viewport = graph.viewport;
	await ready();
	// Keep the review visible in the final backend screenshot, without changing saved source.
	const oldTarget = Array.from(viewport.model.nodesBySource.values()).find(node => node.source.label === 'active')!;
	const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
	await press('Home'); for (let index = 0; index < viewport.model.nodes.length + viewport.model.edges.indexOf(edge); index += 1) await press('ArrowDown');
	movePointer(point(viewport.graphToViewportX(edge.points[edge.points.length - 2]), viewport.graphToViewportY(edge.points[edge.points.length - 1])));
	await frame(); setPointerButton('pointer_primary', true); await frame();
	movePointer(point(viewport.graphToViewportX((oldTarget.bounds.left + oldTarget.bounds.right) / 2), viewport.graphToViewportY(oldTarget.bounds.top + oldTarget.headerHeight / 2)));
	await frame(); await release();
	review = currentReview();
	check(review.proposal.state === 'pending' && model.buffer.getText() === changed, 'FSM drag: final screenshot is a genuine unapplied impact review');
	console.info('STUDIO: FSM physical retarget / review / source history / live Hot Resume PASS');
	return { imported, hostFrames: test.observations.hostFrames, hotResumeInstalls: 1, sharedMachines: 2, target: 'other' };
}
