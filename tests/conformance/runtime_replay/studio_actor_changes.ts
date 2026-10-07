import { getActiveIdeThemeVariant } from '../../../ide/common/constants';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import { ACTOR_TOOLS_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, type StudioFixture } from './studio_fixture';

/** Automated authored-source setup; gameplay, actor selection and history use ordinary UI input. */
export async function runStudioActorChanges(test: StudioFixture) {
	const { runtime, ide, harness, guest, frame, until, press, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'actor changes: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const sourceTab = getActiveTab(), source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: ACTOR_TOOLS_SOURCE
		.replace("local display<const>", "local gpu<const> = require('cartlib/gx/gpu')\nlocal input<const> = require('cartlib/input/input')\nlocal clock<const> = require('cartlib/clock')\nlocal display<const>")
		.replace('systems = {}', "systems = { require('cartlib/input/input_system') }")
		.replace('pos = { x = 4, y = 8 }', 'pos = { x = 9, y = 8 }')
		.replace('actor_tool_ready = true', "input.add_player(1)\nlocal move<const> = input.bind(1, clock.gameplay, 'a[jp]')\nactor_tool_ready = true")
		.replace('\tworld:update()', '\tworld:update()\n\tif move() then actor_tool_first.x = actor_tool_first.x + 1 end')
		.replace('\tworld:render()', '\tworld:render()\n\tgpu.fill_rect_color(actor_tool_first.x, 16, 80, 80, 0xff26a3bb)\n\tgpu.fill_rect_color(112, 64, 208, 160, 0xffbd7841)') }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'actor changes: real World and player input ready');
	const ready = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= ready + 4 && test.tasks.ready, 'actor changes: retain physical history');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor changes: baseline frame boundary');
	await runPaletteCommand('Actor Lab: Open'); await press('Enter'); await frame();
	const lab = getActiveTab();
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	const pane = ide.editor.editorPanes.activePane as ActorLabEditorPane, inspector = pane.inspector;
	await runPaletteCommand('Actor Lab: Inspect Instance');
	check(inspector.model.rows.every(row => !row.element.valueChanged), 'initial instance observation is not a value change');
	const xIndex = inspector.model.rows.findIndex(row => row.element.label === 'x');
	check(xIndex >= 0 && inspector.model.rows[xIndex].element.value === '9', 'real actor starts with the displayed x coordinate 9');
	for (let index = 0; index < xIndex; index++) await press('ArrowDown');
	await press('ShiftLeft', 'F10'); await press('Enter'); await frame();
	const pin = lab.details!.watches.pins[0], firstActor = lab.actorHashId;
	check(pin.item.value === '9' && !pin.item.valueChanged && inspector.model.rows[inspector.model.selectionIndex].element.watch === pin,
		'new pin establishes its own undecorated initial baseline');
	await test.capture?.('initial-baseline');
	await runPaletteCommand('Actor Lab: Select Running Actor'); await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.actorHashId !== firstActor && inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'x')!.element.value === '40'
		&& inspector.model.rows.every(row => !row.element.valueChanged),
		'switching actors does not compare unrelated coordinates or alter the pinned baseline');
	await test.runMenuCommand('pause');
	await click(lab.previewBounds);
	check(inputFocus.target?.guestInputBounds === lab.previewBounds && !ide.editor.capturesGuestInput && inspector.visible,
		'ordinary embedded preview receives gameplay input beside retained Details');
	test.setKey('KeyX', true);
	await until(() => guest.readStringMember(guest.global('actor_tool_first'), 'x') === 10, 'actor changes: ordinary player action moves first actor from 9 to 10');
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
	check(pin.item.value === '9' && pin.item.valueChanged, 'rewind marks the restored pinned coordinate, even with another actor selected');
	await runPaletteCommand('Actor Lab: Reveal Pinned Instance'); await frame();
	let property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'x')!.element;
	check(lab.actorHashId === firstActor && property.value === '9' && !property.valueChanged && pin.item.valueChanged,
		'revealing the owner establishes fresh Details without resetting the pin history');
	const beforeForward = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > beforeForward, 'actor changes: forward over the recorded gameplay input');
	property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'x')!.element;
	check(property.value === '10' && property.valueChanged && pin.item.value === '10' && pin.item.valueChanged,
		'Next Frame marks both the selected Details coordinate and its independent pin');
	check(inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'y')!.element.valueChanged !== true,
		'unchanged coordinates are not decorated');
	await test.capture?.('next-frame-property-light');
	await press('Home');
	await test.capture?.('next-frame-changed-light');
	const pausedCycles = cycles(), pausedHeap = runtime.machine.cpu.luaHeap.usedBytes(), callbacks = guest.global('actor_tool_callbacks');
	for (let index = 0; index < 6; index++) await frame();
	check(pin.item.valueChanged && property.valueChanged, 'paused repaints retain both completed-observation decorations');
	await test.clickTab(sourceTab.id); await test.clickTab(lab.id); await frame();
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
		&& inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'x')!.element.valueChanged !== true,
		'Previous Frame marks the 10 to 9 pin transition without marking the unchanged selected actor');
	await test.capture?.('previous-frame-changed');
	await runPaletteCommand('Actor Lab: Reveal Pinned Instance'); await frame();
	const rewound = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > rewound, 'actor changes: return to moved coordinate');
	property = inspector.model.rows.find(row => row.element.watch === undefined && row.element.label === 'x')!.element;
	check(pin.item.value === '10' && pin.item.valueChanged && property.value === '10' && property.valueChanged,
		'replaying the same recorded transition remains observable in Details and pins');
	const changed = cycles();
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > changed, 'actor changes: next unchanged completed observation');
	check(pin.item.value === '10' && !pin.item.valueChanged && property.value === '10' && !property.valueChanged,
		'the next completed unchanged observation clears Details and pin decorations');
	check(pane.showsGameFrame && inspector.visible && lab.previewBounds.bottom < lab.detailsBounds.top,
		'change decorations and physical history preserve separate visible game and Details surfaces');
	await press('Home');
	await test.capture?.('unchanged-cleared');
	return { changes: 'pass', values: [9, 10, 9, 10], previousFrames, firstActor, sourceVersion: source.version };
}
