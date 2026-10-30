import { getActiveIdeThemeVariant } from '../../../ide/common/constants';
import { inputFocus } from '../../../ide/input/focus';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import type { ActorMemberChoice } from '../../../ide/workbench/contrib/actor_lab/member_choices';
import { ACTOR_TOOLS_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, type StudioFixture } from './studio_fixture';
import { testBehaviorValueChanges } from './studio_behavior_changes';

/** Automated authored-source setup; gameplay, actor selection and history use ordinary UI input. */
export async function runStudioActorChanges(test: StudioFixture) {
	const { runtime, ide, harness, guest, frame, until, press, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'actor changes: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const sourceTab = ide.editor.editorParts.activeGroup.model.activeTab, source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: ACTOR_TOOLS_SOURCE
		.replace("local display<const>", "local gpu<const> = require('cartlib/gx/gpu')\nlocal input<const> = require('cartlib/input/input')\nlocal clock<const> = require('cartlib/clock')\nlocal display<const>")
		.replace('systems = {}', "systems = { require('cartlib/input/input_system') }")
		.replace("prefab.define({ def_id", `local base_component<const> = require('cartlib/component/base_component')
local inventory<const> = setmetatable({}, { __index = base_component })
inventory.__index = inventory
function inventory.new(opts)
	local self<const> = setmetatable(base_component.new(opts), inventory)
	self.id = opts.owner.id .. '.Inventory'
	for index = 1, 12 do self[index] = index end
	self.health = 90
	return self
end
prefab.define({ def_id`)
		.replace("tree_component.factory('rover'),", "tree_component.factory('rover'), inventory.new,")
		.replace('health = 4, energy = 8', 'health = 9, energy = 8')
		.replace('actor_tool_ready = true', `input.add_player(1)
local move<const> = input.bind(1, clock.gameplay, 'a[jp]')
local change_members<const> = input.bind(1, clock.gameplay, 'b[jp]')
actor_tool_inventory = actor_tool_first:get_component(inventory)
actor_tool_membership_actions = 0
actor_tool_ready = true`)
		.replace('\tworld:update()', `\tworld:update()
	if move() then
		actor_tool_first.health = actor_tool_first.health + 1
		local pose<const> = actor_tool_first.spatial:resolve_world()
		pose:set_world_origin(pose.wox + 1, pose.woy)
	end
	if change_members() then
		actor_tool_inventory.health = actor_tool_inventory.health - 1
		actor_tool_first:get_component(tree_component).blackboard:set(count, actor_tool_inventory.health)
		actor_tool_first.state_machines:get_machine('walker').states.nest.data.revision = actor_tool_inventory.health
		if actor_tool_inventory[1] == nil then actor_tool_inventory[1] = 101 else actor_tool_inventory[1] = nil end
		actor_tool_membership_actions = actor_tool_membership_actions + 1
	end`)
		.replace('\tworld:render()', '\tworld:render()\n\tgpu.fill_rect_color(actor_tool_first.spatial:resolve_world().wox, 16, 80, 80, 0xff26a3bb)\n\tgpu.fill_rect_color(112, 64, 208, 160, 0xffbd7841)') }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'actor changes: real World and player input ready');
	const ready = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= ready + 4 && test.tasks.ready, 'actor changes: retain physical history');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor changes: baseline frame boundary');
	await runPaletteCommand('Actor Lab: Open'); await press('Enter'); await frame();
	const lab = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	const pane = ide.editor.editorParts.activeGroup.panes.activePane as ActorLabEditorPane;
	let inspector = pane.inspector;
	await runPaletteCommand('Actor Lab: Inspect Instance');
	check(inspector.model.rows.every(row => !row.element.valueChanged), 'initial instance observation is not a value change');
	const xIndex = inspector.model.rows.findIndex(row => row.element.label === 'health');
	check(xIndex >= 0 && inspector.model.rows[xIndex].element.value === '9', 'real actor starts with the displayed health value 9');
	for (let index = 0; index < xIndex; index++) await press('ArrowDown');
	await press('ShiftLeft', 'F10'); await press('Enter'); await frame();
	const pin = lab.details!.watches.pins[0], firstActor = lab.actorHashId;
	check(pin.item.value === '9' && !pin.item.valueChanged && inspector.model.rows[inspector.model.selectionIndex].element.watch === pin,
		'new pin establishes its own undecorated initial baseline');
	await test.capture?.('initial-baseline');
	await runPaletteCommand('Actor Lab: Select Running Actor'); await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.actorHashId !== firstActor && inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element.value === '40'
		&& inspector.model.rows.every(row => !row.element.valueChanged),
		'switching actors does not compare unrelated gameplay values or alter the pinned baseline');
	await test.runMenuCommand('pause');
	await click(test.visiblePreviewPoint(lab.previewBounds));
	check(inputFocus.target?.guestInput?.bounds === lab.previewBounds && ide.editor.guestInputRecipient !== null && inspector.visible,
		'ordinary embedded preview receives gameplay input through the unobscured preview beside floating Details');
	test.setKey('KeyX', true);
	await until(() => guest.readStringMember(guest.global('actor_tool_first'), 'health') === 10, 'actor changes: ordinary player action changes health from 9 to 10');
	test.setKey('KeyX', false);
	await press('ShiftLeft', 'F1');
	await test.runMenuCommand('pause');
	// The input edge is guest-authored. Find its preceding completed physical frame through the actual transport UI.
	let previousFrames = 0;
	while (pin.item.value === '10') {
		const before = cycles();
		await runPaletteCommand('Run: Previous Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() < before, 'actor changes: previous completed frame');
		previousFrames++;
	}
	check(pin.item.value === '9' && pin.item.valueChanged, 'rewind marks the restored pinned gameplay value, even with another actor selected');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Home');
	check(inspector.model.rows[inspector.model.selectionIndex].element.watch === pin, 'Reveal targets the pinned property in focused Details, not the tree selection');
	await runPaletteCommand('Actor Lab: Reveal Pinned Instance'); await frame();
	let property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element;
	check(lab.actorHashId === firstActor && property.value === '9' && !property.valueChanged && pin.item.valueChanged,
		'revealing the owner establishes fresh Details without resetting the pin history');
	const beforeForward = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > beforeForward, 'actor changes: forward over the recorded gameplay input');
	property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element;
	check(property.value === '10' && property.valueChanged && pin.item.value === '10' && pin.item.valueChanged,
		'Next Frame marks both the selected Details gameplay value and its independent pin');
	check(inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'energy')!.element.valueChanged !== true,
		'unchanged gameplay values are not decorated');
	await test.capture?.('next-frame-property-light');
	await press('Home');
	await test.capture?.('next-frame-changed-light');
	const pausedCycles = cycles(), pausedHeap = runtime.machine.cpu.luaHeap.usedBytes(), callbacks = guest.global('actor_tool_callbacks');
	for (let index = 0; index < 6; index++) await frame();
	check(pin.item.valueChanged && property.valueChanged, 'paused repaints retain both completed-observation decorations');
	await test.clickTab(sourceTab.id); await test.clickTab(lab.id); await frame();
	inspector = pane.inspector;
	check(pin.item.valueChanged && property.valueChanged && cycles() === pausedCycles
		&& runtime.machine.cpu.luaHeap.usedBytes() === pausedHeap && guest.global('actor_tool_callbacks') === callbacks,
		`paused tab navigation retains decoration without guest work: pin=${pin.item.valueChanged} property=${property.valueChanged} cycles=${cycles()}/${pausedCycles} heap=${runtime.machine.cpu.luaHeap.usedBytes()}/${pausedHeap} callbacks=${guest.global('actor_tool_callbacks')}/${callbacks}`);
	await press('ControlLeft', 'AltLeft', 'KeyT');
	check(getActiveIdeThemeVariant() === 'dark' && pin.item.valueChanged && property.valueChanged,
		'real theme shortcut preserves the completed observation');
	await test.capture?.('next-frame-changed-dark');
	await press('ControlLeft', 'AltLeft', 'KeyT');
	await runPaletteCommand('Actor Lab: Select Running Actor'); await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.actorHashId !== firstActor && pin.item.valueChanged
		&& inspector.model.rows.filter(row => row.element.watch === undefined).every(row => !row.element.valueChanged),
		'selection changes reset current Details, not the independent pin decoration');
	await test.capture?.('changed-pin-other-actor');
	const beforeRewind = cycles();
	await runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() < beforeRewind, 'actor changes: rewind the input boundary');
	check(pin.item.value === '9' && pin.item.valueChanged
		&& inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element.valueChanged !== true,
		'Previous Frame marks the 10 to 9 pin transition without marking the unchanged selected actor');
	await test.capture?.('previous-frame-changed');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Home');
	await runPaletteCommand('Actor Lab: Reveal Pinned Instance'); await frame();
	const rewound = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > rewound, 'actor changes: return to moved gameplay value');
	property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'health')!.element;
	check(pin.item.value === '10' && pin.item.valueChanged && property.value === '10' && property.valueChanged,
		'replaying the same recorded transition remains observable in Details and pins');
	const changed = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > changed, 'actor changes: next unchanged completed observation');
	check(pin.item.value === '10' && !pin.item.valueChanged && property.value === '10' && !property.valueChanged,
		'the next completed unchanged observation clears Details and pin decorations');
	check(!ide.editor.gamePanel.visible && inspector.visible && pane.detailsWindow.visible && lab.detailsWindow.open,
		'change decorations and physical history preserve the full game preview and independently attached floating Details');
	await press('Home');
	await test.capture?.('unchanged-cleared');

	// A real component's stored entries change membership before the selected scalar.
	// The array slots deliberately precede hash fields, without assuming hash iteration order.
	await press('ControlLeft', 'KeyF');
	await test.clipboard.writeText('Inventory'); await press('ControlLeft', 'KeyV');
	check(ide.editor.editorParts.activePart.quickInput.model.list.rows.length === 1
		&& (ide.editor.editorParts.activePart.quickInput.model.list.rows[0].item as ActorMemberChoice).node.kind === 'component',
		'Find resolves the actual guest-owned Inventory component');
	await press('Enter'); await frame();
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Home');
	const healthIndex = inspector.model.rows.findIndex(row => row.element.label === 'health');
	check(healthIndex >= 0, 'Inventory exposes its stored health field');
	for (let index = 0; index < healthIndex; index++) await press('ArrowDown');
	const health = inspector.model.rows[inspector.model.selectionIndex].element;
	check(health.value === '90' && !health.valueChanged && inspector.model.viewport.scrollTop > 0,
		'component inspection establishes a neutral baseline and a genuinely scrolled selection');
	const membershipFrames: number[] = [];
	for (const action of [1, 2]) {
		const beforeValue = String(91 - action), afterValue = String(90 - action);
		await runPaletteCommand('Run: Continue from Here'); await click(test.visiblePreviewPoint(lab.previewBounds));
		check(inputFocus.target?.guestInput?.bounds === lab.previewBounds && ide.editor.guestInputRecipient !== null,
			'component mutation is driven by ordinary guest input, not inspector writes');
		await test.releaseGuestKey('KeyC');
		test.setKey('KeyC', true);
		await until(() => guest.global('actor_tool_membership_actions') === action, 'actor changes: guest changes component membership');
		test.setKey('KeyC', false);
		await press('ShiftLeft', 'F1'); await test.runMenuCommand('pause');
		let frames = 0;
		while (inspector.model.rows[inspector.model.selectionIndex].element.value === afterValue) {
			const before = cycles();
			await runPaletteCommand('Run: Previous Frame');
			await until(() => ide.frameNavigation.active === undefined && cycles() < before, 'actor changes: rewind component input edge');
			frames++;
		}
		membershipFrames.push(frames);
		check(health.value === beforeValue && inspector.model.rows[inspector.model.selectionIndex].element === health,
			'rewind retains the selected semantic component property');
		const view = inspector.model.viewport;
		const selectedBefore = inspector.model.selectionIndex, countBefore = inspector.model.rows.length;
		const topBefore = view.offsetTop + inspector.model.rows[selectedBefore].top;
		const anchorBefore = inspector.model.rows[inspector.model.rowAt(view.bounds.top)].element;
		const before = cycles();
		await runPaletteCommand('Run: Next Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() > before, 'actor changes: replay component membership edge');
		const selectedAfter = inspector.model.rows[inspector.model.selectionIndex];
		check(health.value === afterValue && health.valueChanged && selectedAfter.element === health,
			'surviving selected property compares its retained baseline across membership changes');
		check(inspector.model.rows.length === countBefore + (action === 1 ? -1 : 1)
			&& inspector.model.selectionIndex === selectedBefore + (action === 1 ? -1 : 1),
			'actual entry removal and insertion move the selected property to its new row');
		check(view.offsetTop + selectedAfter.top === topBefore
			&& inspector.model.rows[inspector.model.rowAt(view.bounds.top)].element === anchorBefore
			&& topBefore >= view.bounds.top && view.offsetTop + selectedAfter.bottom <= view.bounds.bottom,
			'scroll anchoring keeps the selected property and its visible value in place');
		const firstSlot = inspector.model.rows.find(row => row.element.label === '1');
		check(action === 1 ? firstSlot === undefined : firstSlot?.element.value === '101' && !firstSlot.element.valueChanged,
			'a genuinely absent entry reappears with a neutral new baseline, not its removed value');
		check(inspector.model.rows.find(row => row.element.label === '2')!.element.valueChanged !== true,
			'an unchanged surviving entry is not marked by its shifted row');
		await test.capture?.(`membership-${action === 1 ? 'removed' : 'inserted'}-light`);
		await press('ControlLeft', 'AltLeft', 'KeyT');
		check(getActiveIdeThemeVariant() === 'dark' && health.valueChanged, 'theme paint retains shifted property decoration');
		await test.capture?.(`membership-${action === 1 ? 'removed' : 'inserted'}-dark`);
		await press('ControlLeft', 'AltLeft', 'KeyT');
	}
	const membershipCycles = cycles(), membershipHeap = runtime.machine.cpu.luaHeap.usedBytes();
	const membershipCallbacks = guest.global('actor_tool_callbacks');
	const pausedReads = { members: 0, entries: 0 };
	const readMember = guest.readStringMember, visitEntries = guest.visitTableEntries;
	guest.readStringMember = function(value, name) { pausedReads.members++; return readMember.call(this, value, name); };
	guest.visitTableEntries = function(value, visitor) { pausedReads.entries++; visitEntries.call(this, value, visitor); };
	for (let index = 0; index < 6; index++) await frame();
	guest.readStringMember = readMember; guest.visitTableEntries = visitEntries;
	check(pausedReads.members === 0 && pausedReads.entries === 0 && cycles() === membershipCycles
		&& runtime.machine.cpu.luaHeap.usedBytes() === membershipHeap && guest.global('actor_tool_callbacks') === membershipCallbacks
		&& health.valueChanged, 'paused membership-shift repaints retain decoration without guest reads, execution or allocation');
	const pausedCyclesDelta = cycles() - membershipCycles, pausedHeapBytes = runtime.machine.cpu.luaHeap.usedBytes() - membershipHeap;
	const behaviorChanges = await testBehaviorValueChanges(test);
	return { changes: 'pass', values: [9, 10, 9, 10], previousFrames, firstActor, sourceVersion: source.version,
		membership: 'pass', health: [90, 89, 88], membershipFrames, pausedReads, pausedCycles: pausedCyclesDelta, pausedHeapBytes, behaviorChanges };
}
