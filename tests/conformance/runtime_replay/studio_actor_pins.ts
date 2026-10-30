import { inputFocus } from '../../../ide/input/focus';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import { ACTOR_TOOLS_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, type StudioFixture } from './studio_fixture';

/** Automated source setup, then ordinary Details/context menus, actor navigation and physical history. */
export async function runStudioActorPins(test: StudioFixture) {
	const { runtime, ide, harness, guest, frame, until, press, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'actor pins: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const sourceTab = ide.editor.editorParts.activeGroup.model.activeTab, source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length,
		text: ACTOR_TOOLS_SOURCE.replace('\tworld:update()', '\tactor_tool_first.health = actor_tool_first.health + 1\n\tworld:update()') }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'actor pins: real World constructs two actors');
	const ready = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= ready + 4 && test.tasks.ready, 'actor pins: retain physical frame history');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	// Pause can stop inside a guest frame; begin the comparison at a completed video boundary.
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor pins: baseline frame boundary settles');
	await runPaletteCommand('Actor Lab: Open');
	check(ide.editor.editorParts.activePart.quickInput.visible && ide.editor.editorParts.activePart.quickInput.model.list.rows.map(row => row.item.label).join(',') === 'first,second',
		'Actor picker reads both guest-owned instances');
	await press('Enter'); await frame();
	const lab = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	const pane = ide.editor.editorParts.activeGroup.panes.activePane as ActorLabEditorPane;
	let inspector = pane.inspector;
	await runPaletteCommand('Actor Lab: Inspect Instance');
	const inspectionCycles = cycles(), inspectionHeap = runtime.machine.cpu.luaHeap.usedBytes(), callbacks = guest.global('actor_tool_callbacks');
	const x = inspector.model.rows.findIndex(row => row.element.label === 'health');
	check(x >= 0, 'actor position has a live Details property');
	for (let index = 0; index < x; index++) await press('ArrowDown');
	await press('ShiftLeft', 'F10');
	const menu = ide.editor.contextMenu;
	check(menu.visible && menu.model.rows[menu.model.selectedIndex].command === 'actorLab.pinProperty',
		'focused property exposes Pin through the ordinary keyboard context menu');
	await test.capture?.('pin-context');
	await press('Enter'); await frame();
	const pin = lab.details!.watches.pins[0], firstActor = lab.actorHashId;
	check(lab.details!.watches.pins.length === 1 && inspector.model.rows[inspector.model.selectionIndex].element.watch === pin,
		'Pin keeps the same Details control and selects its retained pinned row');
	check(pin.item.description.includes('first'), 'pinned properties visibly name their owning instance');
	const initial = pin.item.value;
	await runPaletteCommand('Actor Lab: Select Running Actor');
	await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.actorHashId !== firstActor && lab.outline.rows[0].element.node.label === 'second'
		&& inspector.model.rows[0].element.watch === pin && pin.item.value === initial,
		'selecting another actor preserves the first actor pin instead of retargeting its x');
	check(inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element.value === '40',
		'current actor Details remain separate from pinned values');
	check(cycles() === inspectionCycles && runtime.machine.cpu.luaHeap.usedBytes() === inspectionHeap && guest.global('actor_tool_callbacks') === callbacks,
		'pinning and selecting another actor do not execute guest Lua or allocate guest values');
	await test.capture?.('pin-other-actor');
	const held = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > held, 'actor pins: forward guest frame settles');
	const guestPosition = guest.formatValue(guest.readStringMember(guest.global('actor_tool_first'), 'health'));
	check(pin.item.value !== initial && pin.item.value === guestPosition,
		`a pinned nonselected actor property reads the newly executed frame: initial=${initial} pin=${pin.item.value} guest=${guestPosition}`);
	check(lab.actorHashId !== firstActor && inspector.visible && inspector.model.rows[0].element.watch === pin,
		'frame execution preserves the other actor selection, Details and pin identity');
	const advanced = pin.item.value, forward = cycles();
	await test.capture?.('pin-advanced-other-actor');
	await runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() < forward, 'actor pins: historical guest frame settles');
	check(pin.item.value === initial && pin.item.value !== advanced
		&& pin.item.value === guest.formatValue(guest.readStringMember(guest.global('actor_tool_first'), 'health')),
		'rewind reads the restored pin owner rather than retaining its future value');
	await test.capture?.('pin-rewound-other-actor');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Home');
	await test.clickTab(sourceTab.id); await test.clickTab(lab.id); await frame();
	inspector = pane.inspector;
	check(inspector.visible && inspector.model.rows[inspector.model.selectionIndex].element.watch === pin,
		'authoring navigation restores typed pinned selection, not its display label');
	const restoredView = inspector.model.viewport, restoredRow = inspector.model.rows[inspector.model.selectionIndex];
	await click({ left: restoredView.bounds.left + 4, right: restoredView.bounds.left + 5,
		top: restoredView.offsetTop + restoredRow.top + 4, bottom: restoredView.offsetTop + restoredRow.top + 5 });
	await runPaletteCommand('Actor Lab: Reveal Pinned Instance');
	check(lab.actorHashId === firstActor && inspector.model.rows[inspector.model.selectionIndex].element.watch === undefined
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === 'health',
		'Reveal returns to the pin owner and its original current property');
	await press('Home');
	const view = inspector.model.viewport, row = inspector.model.rows[0];
	await click({ left: view.bounds.left + 4, right: view.bounds.left + 5,
		top: view.offsetTop + row.top + 4, bottom: view.offsetTop + row.top + 5 }, 1, 'pointer_secondary');
	check(menu.visible && !menu.model.rows.find(row => row.command === 'actorLab.pinProperty')!.enabled,
		'right-click targets the pinned row without allowing duplicate pins');
	await test.clickContextCommand('actorLab.unpinProperty');
	check(lab.details!.watches.pins.length === 0 && inspector.visible && inspector.model.rows.every(row => row.element.watch === undefined),
		'Unpin removes only the watch and keeps the selected actor Details open');
	await click(test.visiblePreviewPoint(lab.previewBounds));
	check(inputFocus.target?.guestInput?.bounds === lab.previewBounds && ide.editor.guestInputRecipient !== null,
		'property context commands do not steal ordinary game preview focus');
	await press('ShiftLeft', 'F1');
	check(inspector.visible && ide.editor.guestInputRecipient === null, 'releasing game input preserves the Details document');
	await test.capture?.('pin-removed');
	return { pins: 'pass', initial, advanced, firstActor };
}
