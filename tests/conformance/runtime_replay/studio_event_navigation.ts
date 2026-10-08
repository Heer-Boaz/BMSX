import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { eventClipboardText } from '../../../ide/workbench/contrib/events/presentation';
import type { EventViewerPane } from '../../../ide/workbench/contrib/events/editor_pane';
import { WorkspaceRuntimeTools } from '../../../ide/workbench/services/assistant/runtime_tools';
import { RuntimeTaskKind } from '../../../hosts/common/runtime_task_queue';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { check, type StudioFixture } from './studio_fixture';

/** Authored source is installed through Reboot; observations use the ordinary cartlib emitter. */
const SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local events<const> = require('cartlib/event_emitter')
display.reset_256x192()
world:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
  spaces = { 'main' }, systems = {} })
local port<const> = events.events_of({ id = 'navigation-fixture' })
local payload<const> = { value = 0 }
event_navigation_value = 0
event_navigation_ready = true
while true do
  world:update()
  event_navigation_value = event_navigation_value + 1
  payload.value = event_navigation_value
  port:emit('navigation.match', payload)
  port:emit('navigation.other', payload)
  payload.value = -event_navigation_value
  vblank.wait()
  world:render()
end
`;

/** Real keyboard/pointer navigation and physical replay, shared by all browser renderers. */
export async function runStudioEventNavigation(test: StudioFixture) {
	const { runtime, ide, harness, guest, frame, until, press, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'events: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: SOURCE }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('event_navigation_ready') === true && test.tasks.ready, 'events: guest fixture emits through cartlib');
	const ready = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= ready + 24 && test.tasks.ready, 'events: retain emitted frames');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'events: physical baseline settles');
	await runPaletteCommand('View: Event Viewer'); await frame();
	const view = getActiveTab();
	if (view.kind !== 'event_viewer') throw new Error('Event Viewer required');
	const pane = ide.editor.editorPanes.activePane as EventViewerPane;
	await click(view.actions.items.find(item => item.command === 'events.filter')!.bounds);
	await test.clipboard.writeText('navigation.match'); await press('ControlLeft', 'KeyV'); await press('Enter');
	check(view.projection.rows.length >= 20 && view.projection.rows.every(record => record.event.kind === 'string' && record.event.value === 'navigation.match'),
		'Filter retains chronological matching emissions, not unfiltered adjacent rows');
	await press('Home');
	for (let index = 0; index < 6; index++) await press('ArrowDown');
	const selected = view.projection.rows[view.selected], evidence = eventClipboardText(selected);
	check(ide.events.canSeek(selected), 'selected emission belongs to current retained machine history');
	const before = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes();
	await press('ArrowDown'); await press('ArrowUp');
	await press('ControlLeft', 'KeyC');
	check(await test.clipboard.readText() === evidence && cycles() === before && runtime.machine.cpu.luaHeap.usedBytes() === heap,
		'ordinary selection and copy neither seek nor execute or allocate guest values');
	await press('Enter'); await test.capture?.('event-snapshot');
	await test.clickTab(view.id); await press('ArrowDown'); await press('ControlLeft', 'KeyC');
	check(await test.clipboard.readText() === '"navigation.match"' && view.projection.rows[view.selected] === selected
		&& !pane.isEnabled('events.goToFrame'),
		'clicking the active Details tab keeps property focus instead of navigating the hidden event list');
	await press('Escape');
	check(cycles() === before && view.projection.rows[view.selected] === selected,
		'Enter opens immutable Details without moving the physical cursor');
	await until(() => !editorFeedbackState.message.visible, 'events: selection footer is no longer covered by transient feedback');
	await frame();
	await test.capture?.('selected-not-seeked');
	await click(view.actions.items.find(item => item.command === 'events.goToFrame')!.bounds);
	await until(() => ide.frameNavigation.active === undefined, 'events: explicit Go to Frame settles');
	await frame();
	check(cycles() < before && cycles() <= selected.cycles && runtime.frameScheduler.lastTickSequence === selected.completedTick,
		'Go to Frame uses the preceding retained video boundary, not an exact emission stop');
	check(test.execution.userPaused && test.rewind.active && view.projection.rows[view.selected] === selected
		&& eventClipboardText(selected) === evidence,
		'historical event selection and its payload survive physical replay without retargeting');
	const previous = view.projection.rows[view.selected - 1], next = view.projection.rows[view.selected + 1];
	await test.capture?.('event-frame');
	await click(view.actions.items.find(item => item.command === 'events.more')!.bounds);
	await test.clickContextCommand('events.nextFrame');
	await until(() => ide.frameNavigation.active === undefined, 'events: Next Event frame settles');
	await frame();
	check(view.projection.rows[view.selected] === next && runtime.frameScheduler.lastTickSequence === next.completedTick,
		'Next Event selects and seeks the next filtered reachable emission');
	await press('ShiftLeft', 'F10');
	check(ide.editor.contextMenu.visible, 'event list has the shared keyboard context menu');
	await test.clickContextCommand('events.previousFrame');
	await until(() => ide.frameNavigation.active === undefined, 'events: Previous Event frame settles');
	await frame();
	check(view.projection.rows[view.selected] === selected && runtime.frameScheduler.lastTickSequence === selected.completedTick,
		'Previous Event returns through the same filtered chronological order');
	await test.capture?.('event-neighbours');

	const future = view.projection.rows[view.projection.rows.length - 2], branchSequence = ide.events.endSequence;
	await runPaletteCommand('Run: Continue from Here');
	await until(() => ide.events.endSequence > branchSequence + 6 && test.tasks.ready, 'events: continuing from the selected frame creates live branch');
	await test.runMenuCommand('pause');
	check(ide.events.canSeek(previous) && !ide.events.canSeek(future),
		'branch preserves retained prefix provenance and retires discarded future events');
	check(eventClipboardText(selected) === evidence && view.projection.rows[view.selected] === selected,
		'live branch preserves historical snapshot and list selection');
	await press('End'); await press('ArrowUp');
	const branchEvent = view.projection.rows[view.selected];
	check(branchEvent.timeline !== selected.timeline && ide.events.canSeek(branchEvent), 'new live emissions have distinct navigable timeline provenance');
	await test.capture?.('event-live-branch');
	await press('Home');
	for (let index = 0; index < view.projection.rows.indexOf(future); index++) await press('ArrowDown');
	check(view.projection.rows[view.selected] === future && !pane.isEnabled('events.goToFrame'),
		'retained discarded-future evidence remains selectable but cannot seek another branch');
	await until(() => !editorFeedbackState.message.visible, 'events: discarded-future footer is visible');
	await frame();
	await test.capture?.('event-discarded-future');

	// Exercise the same public tool entry separately from the pointer proof above.
	// A queued host-work fence keeps this admitted operation in flight while the
	// ordinary UI changes its projection. No fake replay or backend is installed.
	const lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(ide.inspection, ide.frameNavigation, ide.gameCapture, ide.luaEvaluation,
		ide.debuggerExecution, ide.actorExecution, ide.boots, ide.hotResumes, ide.events, lifetime.signal);
	const generation = ide.events.generation;
	const reply = tools.execute('studio_seek_event', { target: ide.inspection.target, generation, sequence: previous.sequence });
	const operation = ide.frameNavigation.active!;
	let release!: () => void;
	const pending = new Promise<void>(resolve => { release = resolve; });
	const fence = test.tasks.schedule(() => pending, error => { throw error; }, RuntimeTaskKind.History);
	const held = cycles();
	await press('Home');
	check(ide.frameNavigation.active === operation && cycles() === held && view.projection.rows[view.selected] !== previous,
		'list selection cannot retarget an already admitted tool seek');
	await click(view.actions.items.find(item => item.command === 'events.filter')!.bounds);
	await press('ControlLeft', 'KeyA');
	await test.clipboard.writeText('navigation.other'); await press('ControlLeft', 'KeyV'); await press('Enter');
	check(view.filter === 'navigation.other' && view.selected === -1 && ide.frameNavigation.active === operation,
		'filter changes only the projection while an admitted physical seek is pending');
	await click(view.actions.items.find(item => item.command === 'events.more')!.bounds);
	await test.clickContextCommand('events.clear');
	check(ide.events.count === 0 && view.selected === -1 && !pane.isEnabled('events.goToFrame'),
		'Clear removes evidence and navigation admission without resuming gameplay');
	check(ide.frameNavigation.active === operation && operation.request.kind === 'seek' && operation.request.cycles === previous.cycles,
		'Clear does not replace or retarget the physical operation already admitted from immutable evidence');
	release(); await fence;
	await until(() => ide.frameNavigation.active === undefined, 'events: admitted tool seek completes after projection clear');
	const receipt = await reply;
	check('status' in receipt.data && receipt.data.status === 'completed' && 'sequence' in receipt.data && receipt.data.sequence === previous.sequence
		&& 'generation' in receipt.data && receipt.data.generation === generation
		&& cycles() <= previous.cycles && runtime.frameScheduler.lastTickSequence === previous.completedTick,
		'studio_seek_event returns its captured event identity and actual completed physical frame despite Clear');
	lifetime.abort(); await frame();
	await test.capture?.('event-cleared');
	return { events: 'pass', selected: { sequence: selected.sequence, timeline: selected.timeline, cycles: selected.cycles, completedTick: selected.completedTick },
		branch: branchEvent.timeline };
}
