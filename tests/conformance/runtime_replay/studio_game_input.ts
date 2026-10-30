import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot, INP_POINTER_BUTTON_SECONDARY, InputControllerGamepadButtonBit, InputControllerSampleContext } from '../../../machine/ts/machine/devices/input/contracts';
import { IO_INP_KEYS, IO_INP_PADS, IO_INP_POINTER_BUTTONS } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { inputFocus } from '../../../ide/input/focus';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import { runtimeWorld } from '../../../ide/workbench/contrib/actor_lab/runtime';
import { readRuntimeLuaModuleExport } from '../../../ide/runtime/lua_inspection';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { check, type StudioFixture } from './studio_fixture';
import { nemesisTitleState, reachNemesisTitle } from './studio_nemesis_navigation';
import { rects_intersect } from '../../../machine/ts/common/rect';

/** Real host routing and latched ICU words, alongside ordinary cartridge gameplay. */
export async function runStudioGameInput(test: StudioFixture) {
	const { runtime, ide, input, clock, execution, harness, guest, frame, until, press, setKey, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'game input: boot shipped cart');
	await reachNemesisTitle(test);
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	await frame();
	const model = harness.getActiveEditorDocument().model, version = model.version;
	const sourcePosition = cycles();
	await press('F1');
	check(cycles() === sourcePosition && ide.editor.guestInputRecipient === null, 'source focus holds gameplay and captures its input');
	await runPaletteCommand('View: Game');
	const view = ide.editor.editorParts.activeGroup.model.activeTab;
	if (view.kind !== 'game_view') throw new Error('Game View required');
	await click(view.frameBounds);
	const focused = inputFocus.target;
	check(focused?.guestInput?.bounds === view.frameBounds && ide.editor.guestInputRecipient !== null, 'click gives the actual viewport guest input');
	await test.capture?.('game-focused');
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'Test controller',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	const keys = ['KeyZ', 'Tab', 'Escape', 'F1', 'F5', 'F9', 'F10', 'F11'];
	for (const key of keys) setKey(key, true);
	test.setPointerButton('pointer_primary', true);
	input.inputButton('gamepad:0', 'down', true, 1, clock.now(), 1);
	const usage = hidKeyUsageForCode('KeyZ'), keyAddress = IO_INP_KEYS + (usage >>> 5) * IO_WORD_SIZE, keyMask = 1 << (usage & 31);
	await until(() => (runtime.machine.memory.readIoU32(keyAddress) & keyMask) !== 0
		&& (runtime.machine.memory.readIoU32(IO_INP_POINTER_BUTTONS) & 1) !== 0
		&& (runtime.machine.memory.readIoU32(IO_INP_PADS) & (1 << InputControllerGamepadButtonBit.Down)) !== 0,
		'game input: physical keyboard, pointer and controller reach the real ICU');
	for (const key of keys) {
		const hid = hidKeyUsageForCode(key);
		check((runtime.machine.memory.readIoU32(IO_INP_KEYS + (hid >>> 5) * IO_WORD_SIZE) & (1 << (hid & 31))) !== 0,
			`${key} reaches the game instead of an IDE binding`);
	}
	check(inputFocus.target === focused && !execution.userPaused && ide.frameNavigation.active === undefined
		&& ide.debugger.source.stop === undefined && model.version === version,
		'game keys neither move IDE focus, edit source, step, break nor pause');
	for (const key of keys) setKey(key, false);
	test.setPointerButton('pointer_primary', false);
	input.inputButton('gamepad:0', 'down', false, 0, clock.now(), 2);
	await test.releaseGuestKey('KeyZ');
	await until(() => guest.readStringMember(test.title(), 'selected_player_count') === 2,
		'game input: controller changes the title menu through the cart input handlers');
	await press('ShiftLeft', 'F1');
	check(inputFocus.target?.guestInput?.bounds === undefined && ide.editor.guestInputRecipient === null,
		'Shift+F1 returns input to Studio, not a game pause');
	await press('Tab');
	check(inputFocus.target === focused, 'workbench focus navigation can enter the viewport');
	await click({ left: view.layout.left + 1, right: view.layout.left + 2, top: view.layout.top + 1, bottom: view.layout.top + 2 });
	check(inputFocus.target?.guestInput?.bounds === undefined && ide.editor.guestInputRecipient === null,
		'clicking letterbox chrome releases game focus');

	harness.openLuaSource('cart.lua');
	await runPaletteCommand('View: Toggle Game Panel');
	check(ide.editor.gamePanel.visible && execution.executionBlocked(), 'source editor owns the hold while its game panel is unfocused');
	const panel = ide.editor.editorParts.mainArea.companionBounds;
	const panelCenter = { left: (panel.left + panel.right) / 2,
		right: (panel.left + panel.right) / 2 + 1,
		top: (view.layout.top + editorViewState.editorAreaBottom) / 2, bottom: (view.layout.top + editorViewState.editorAreaBottom) / 2 + 1 };
	await click(panelCenter);
	check(inputFocus.target?.guestInput?.bounds !== undefined && !execution.executionBlocked() && ide.editor.guestInputRecipient !== null,
		'focused side panel releases only the workbench hold and routes game input');
	await test.capture?.('panel-focused');
	await press('ShiftLeft', 'F1');
	const held = cycles();
	for (let index = 0; index < 4; index++) await frame();
	check(cycles() === held && execution.executionBlocked(), 'release restores source authoring hold');
	await runPaletteCommand('Run: Pause Runtime');
	check(execution.userPaused, 'explicit transport pause is independent of input focus');
	await click(panelCenter);
	for (let index = 0; index < 4; index++) await frame();
	check(cycles() === held && execution.userPaused, 'focusing the panel cannot undo an explicit pause');
	setKey('KeyZ', true);
	await frame();
	const sample = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check((sample.keyWords[usage >>> 5] & keyMask) !== 0, 'focused paused viewport still owns normal input routing');
	ide.editor.gamePanel.close();
	await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(inputFocus.target?.guestInput?.bounds === undefined && sample.keyWords.every(word => word === 0),
		'hiding a focused panel revokes guest input at the next host sampling boundary');
	setKey('KeyZ', false);
	await runPaletteCommand('View: Game');
	await runPaletteCommand('Game: Play / Pause');
	await click(view.frameBounds);
	setKey('Space', true);
	await until(() => nemesisTitleState(test) !== 'idle', 'game input: viewport confirmation starts the real title sequence');
	await test.releaseGuestKey('Space');
	await press('ShiftLeft', 'F1');
	check(model.version === version && ide.editor.editorParts.activeGroup.model.activeTab === view, 'gameplay leaves source and open editors intact');
	await click(view.frameBounds);
	setKey('KeyZ', true);
	await frame();
	harness.openLuaSource('cart.lua');
	await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(sample.keyWords.every(word => word === 0) && execution.executionBlocked(),
		'opening another editor revokes viewport input before the guest samples again');
	setKey('KeyZ', false);

	await runPaletteCommand('Actor Lab: Open');
	await press('Enter');
	const actor = ide.editor.editorParts.activeGroup.model.activeTab;
	if (actor.kind !== 'actor_lab') throw new Error('Actor Lab required');
	await click(test.visiblePreviewPoint(actor.previewBounds));
	check(inputFocus.target?.guestInput?.bounds === actor.previewBounds && !execution.executionBlocked(),
		'Actor Lab preview shares guest focus and releases the authoring hold');
	setKey('KeyZ', true);
	await until(() => (runtime.machine.memory.readIoU32(keyAddress) & keyMask) !== 0, 'Actor Lab keyboard reaches the real ICU');
	await test.releaseGuestKey('KeyZ');
	await test.capture?.('actor-game-focused');
	await press('ShiftLeft', 'F1');
	const actorHeld = cycles();
	await frame(); await frame();
	check(cycles() === actorHeld && ide.editor.guestInputRecipient === null, 'leaving Actor Lab game focus restores its authoring hold');
	// A real rendered sprite, not a source fixture or a guessed collider rectangle.
	const sprite = readRuntimeLuaModuleExport(ide.sources, guest, actor.domain, 'cartlib/component/sprite_component');
	if (sprite.kind !== 'value') throw new Error('sprite datapath unavailable');
	const full = guest.identity(guest.readStringMember(sprite.value, 'draw_visual'));
	const region = guest.identity(guest.readStringMember(sprite.value, 'draw_region_visual'));
	const world = runtimeWorld(ide.sources, guest, actor.domain)!;
	const lane = guest.readStringMember(world, '_render_visuals') as Table;
	let pickX = -1, pickY = -1, pickHashId = 0;
	for (let index = guest.readStringMember(world, '_render_visual_count') as number; index > 0; index--) {
		const visual = lane.getInteger(index), owner = guest.readStringMember(visual, 'owner') as Table;
		const draw = guest.readStringMember(visual, 'draw'), cropped = guest.matchesIdentity(draw, region);
		if (!cropped && !guest.matchesIdentity(draw, full) || !guest.isTruthy(guest.readStringMember(visual, 'visible'))
			|| !guest.isTruthy(guest.readStringMember(owner, 'visible'))) continue;
		const width = (guest.readStringMember(visual, cropped ? 'region_width' : 'source_width') as number)
			* (guest.readStringMember(visual, 'scale_x') as number) * (guest.readStringMember(visual, 'draw_scale_x') as number);
		const height = (guest.readStringMember(visual, cropped ? 'region_height' : 'source_height') as number)
			* (guest.readStringMember(visual, 'scale_y') as number) * (guest.readStringMember(visual, 'draw_scale_y') as number);
		const x = (guest.readStringMember(owner, 'x') as number) + (guest.readStringMember(visual, 'offset_x') as number)
			+ (guest.readStringMember(visual, 'draw_offset_x') as number) + width / 2;
		const y = (guest.readStringMember(owner, 'y') as number) + (guest.readStringMember(visual, 'offset_y') as number)
			+ (guest.readStringMember(visual, 'draw_offset_y') as number) + height / 2;
		if (width === 0 || height === 0 || x < 0 || y < 0 || x >= test.presenter.offscreenCanvasSize.x || y >= test.presenter.offscreenCanvasSize.y) continue;
		pickX = x; pickY = y; pickHashId = owner.hashId; break;
	}
	check(pickHashId !== 0, 'real title presentation contains a visible sprite to pick');
	const point = { left: actor.previewBounds.left + pickX * (actor.previewBounds.right - actor.previewBounds.left) / test.presenter.offscreenCanvasSize.x,
		top: actor.previewBounds.top + pickY * (actor.previewBounds.bottom - actor.previewBounds.top) / test.presenter.offscreenCanvasSize.y, right: 0, bottom: 0 };
	point.right = point.left; point.bottom = point.top;
	const pickHeap = runtime.machine.cpu.luaHeap.usedBytes();
	test.movePointer(point);
	for (let index = 0; index < 5; index++) await frame();
	check(ide.editor.actorLab.viewportPicker.hit.hashId === pickHashId && cycles() === actorHeld && runtime.machine.cpu.luaHeap.usedBytes() === pickHeap,
		'hover resolves the actual frontmost sprite owner without guest execution or allocation');
	await test.capture?.('actor-hover');
	await click(point, 1, 'pointer_secondary');
	check(actor.actorHashId === pickHashId && actor.outline.rows[actor.outline.selectionIndex].element.node.hashId === pickHashId
		&& !actor.interaction.running && ide.editor.guestInputRecipient === null && cycles() === actorHeld && runtime.machine.cpu.luaHeap.usedBytes() === pickHeap,
		'inspection click reveals the same live actor through the existing tree without injecting game input');
	await test.capture?.('actor-picked');
	await runPaletteCommand('Actor Lab: Play / Pause');
	test.movePointer(point);
	for (let index = 0; index < 6; index++) await frame();
	check(actor.interaction.running && cycles() > actorHeld && actor.actorHashId === pickHashId && inputFocus.target?.guestInput?.bounds === undefined,
		'hover while playing neither pauses the cart nor moves selection or game focus');
	await test.capture?.('actor-hover-playing');
	await click(point);
	const focusedActor = actor.actorHashId;
	test.setPointerButton('pointer_secondary', true);
	await until(() => (runtime.machine.memory.readIoU32(IO_INP_POINTER_BUTTONS) & (1 << INP_POINTER_BUTTON_SECONDARY)) !== 0,
		'hovered Actor Lab game focus still delivers its secondary button to HID');
	check(actor.interaction.running && actor.actorHashId === focusedActor && inputFocus.target?.guestInput?.bounds === actor.previewBounds,
		'hover over a focused game does not intercept buttons or select an actor');
	await test.capture?.('actor-hover-game-focused');
	test.setPointerButton('pointer_secondary', false); await frame();
	await press('ShiftLeft', 'F1');
	test.setPointerButton('pointer_secondary', true); await frame();
	test.setPointerButton('pointer_secondary', false); await frame();
	check(!actor.interaction.running && actor.actorHashId === ide.editor.actorLab.viewportPicker.hit.hashId && actor.actorHashId !== 0,
		'inspecting the hovered live actor is the explicit pause and selection action');
	const previewPlacement = JSON.stringify(actor.previewBounds);
	await runPaletteCommand('Actor Lab: Inspect Instance');
	const actorPane = ide.editor.editorParts.activeGroup.panes.activePane as ActorLabEditorPane;
	const inspector = actorPane.inspector, details = actor.details;
	check(!ide.editor.gamePanel.visible && inspector.visible && actor.detailsWindow.open && actorPane.detailsWindow.visible,
		'instance Details attach as a separate floating window over the full game preview');
	await press('ArrowDown');
	const selectedProperty = inspector.model.rows[inspector.model.selectionIndex].element.label;
	const selectedActorPath = JSON.stringify(actor.selectionPath);
	check(JSON.stringify(actor.previewBounds) === previewPlacement && rects_intersect(actor.previewBounds, actor.detailsWindow.bounds),
		'floating Details overlap the preview without subtracting any preview height');
	await test.capture?.('actor-details-floating');
	await click(test.visiblePreviewPoint(actor.previewBounds));
	check(inputFocus.target?.guestInput?.bounds === actor.previewBounds && ide.editor.guestInputRecipient !== null
		&& inspector.visible && actor.details === details && JSON.stringify(actor.selectionPath) === selectedActorPath,
		'visible Actor Lab preview takes game input without replacing Details or actor selection');
	setKey('KeyZ', true);
	await until(() => (runtime.machine.memory.readIoU32(keyAddress) & keyMask) !== 0,
		'Actor Lab game input still reaches the ICU beside open Details');
	await test.releaseGuestKey('KeyZ');
	// A gesture begun in the visible preview stays with the game across the window.
	test.movePointer(test.visiblePreviewPoint(actor.previewBounds)); await frame();
	test.setPointerButton('pointer_primary', true); await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check((sample.pointerButtons & 1) !== 0, 'a visible preview press establishes the guest gesture');
	test.movePointer(actor.detailsWindow.client); await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check((sample.pointerButtons & 1) !== 0 && inputFocus.target?.guestInput?.bounds === actor.previewBounds,
		'guest pointer capture crosses floating Details without a stray UI press');
	await test.capture?.('actor-guest-drag-over-details');
	test.setPointerButton('pointer_primary', false); await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(sample.pointerButtons === 0 && inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'releasing above Details ends only the guest gesture and preserves the property selection');
	const header = actor.detailsWindow.header;
	test.movePointer({ left: header.left + 6, right: header.left + 6, top: header.top + 6, bottom: header.top + 6 });
	test.setPointerButton('pointer_secondary', true); await frame();
	test.movePointer(test.visiblePreviewPoint(actor.previewBounds)); await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(sample.pointerButtons === 0 && inputFocus.target?.guestInput === undefined,
		'a new window-owned press remains UI input when it crosses back over the preview');
	test.setPointerButton('pointer_secondary', false); await frame();
	await press('ShiftLeft', 'F1');
	const detailsHeld = cycles();
	await frame(); await frame();
	check(cycles() === detailsHeld && inspector.visible
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'releasing game focus holds execution and preserves the selected Details property');
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() > detailsHeld, 'Actor Lab Details advance one guest frame');
	const detailsForward = cycles();
	check(inspector.visible && actor.details === details && JSON.stringify(actor.selectionPath) === selectedActorPath
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'frame advance refreshes the retained Details without replacing view selection');
	await runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined && cycles() < detailsForward, 'Actor Lab Details return to the previous guest frame');
	check(inspector.visible && actor.details === details && JSON.stringify(actor.selectionPath) === selectedActorPath
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'rewind refreshes Details and preserves actor and property selection');
	await test.capture?.('actor-details-rewound');
	await click(actor.detailsActions.items.find(item => item.command === 'actorLab.lockDetails')!.bounds);
	const lockedSubject = details!.subject, lockedPath = details!.subjectPath;
	check(details!.locked, 'the floating titlebar exposes the subject lock from the first instance');
	await press('Escape'); await press('ArrowDown');
	check(details!.locked && details!.subject === lockedSubject && details!.subjectPath === lockedPath
		&& JSON.stringify(actor.selectionPath) !== selectedActorPath,
		'Escape returns to tree navigation while locked Details retain the exact inspected subject');
	await test.capture?.('actor-details-locked-tree-navigation');
	await click(actor.detailsActions.items.find(item => item.command === 'actorLab.lockDetails')!.bounds);
	check(!details!.locked && details!.subject !== lockedSubject, 'unlock immediately follows the current tree selection');
	const expandedRequest = { ...actor.detailsWindow.requestedBounds };
	await click(actor.detailsActions.items.find(item => item.command === 'window.hide')!.bounds);
	check(!actor.detailsWindow.open && actorPane.detailsWindow.clientSurface === undefined
		&& JSON.stringify(actor.detailsWindow.requestedBounds) === JSON.stringify(expandedRequest),
		'closing Details retires the client surface while retaining its requested placement');
	await test.capture?.('actor-details-closed');
	await click(test.visiblePreviewPoint(actor.previewBounds));
	check(inputFocus.target?.guestInput?.bounds === actor.previewBounds && !actor.detailsWindow.open,
		'closed Details leave their former client area available to the game preview');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	check(actor.detailsWindow.open && actorPane.detailsWindow.clientSurface !== undefined && actor.details === details,
		'explicit inspection reattaches Details without replacing its subject model');
	const resizeBefore = { ...actor.detailsWindow.bounds };
	test.movePointer({ left: resizeBefore.left + 1, right: resizeBefore.left + 1,
		top: resizeBefore.bottom - 2, bottom: resizeBefore.bottom - 2 });
	test.setPointerButton('pointer_primary', true); await frame();
	test.movePointer({ left: resizeBefore.left + 13, right: resizeBefore.left + 13,
		top: resizeBefore.bottom - 14, bottom: resizeBefore.bottom - 14 });
	await frame(); test.setPointerButton('pointer_primary', false); await frame();
	check(actor.detailsWindow.bounds.left > resizeBefore.left && actor.detailsWindow.bounds.bottom < resizeBefore.bottom,
		'actual window edge hit testing resizes the client through central pointer capture');
	const resizedRequest = JSON.stringify(actor.detailsWindow.requestedBounds);
	await click(actor.detailsActions.items.find(item => item.command === 'window.hide')!.bounds);
	check(!inspector.visible && !actor.detailsWindow.open && actorPane.detailsWindow.surface === undefined,
		'Hide actually detaches Details and retires its chrome input');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	check(actorPane.detailsWindow.visible && JSON.stringify(actor.detailsWindow.requestedBounds) === resizedRequest,
		'reopening restores the same requested window placement instead of an old split');
	await press('Escape');
	check(!ide.editor.gamePanel.visible && inspector.visible && actor.detailsWindow.open,
		'Escape returns focus to the tree without closing modeless Details');
	const detailsReturnFocus = inputFocus.target;
	await runPaletteCommand('Actor Lab: Inspect Instance');
	await press('ContextMenu');
	check(ide.editor.contextMenu.visible && inputFocus.target === ide.editor.contextMenu.focusTarget,
		'the actual Details property popup owns keyboard focus before owner-driven retirement');
	// Exercise the owner close path while its promoted popup, not chrome, is focused.
	actorPane.detailsWindow.hide();
	check(!ide.editor.contextMenu.visible && !inspector.visible && !actor.detailsWindow.open
		&& inputFocus.target === detailsReturnFocus && inputFocus.admittedTarget === detailsReturnFocus,
		'retiring Details returns popup focus to the live tree before client membership is removed');
	await frame(); await test.capture?.('actor-details-retired-with-popup');
	await press('ShiftLeft', 'Tab');
	check(inputFocus.target?.guestInput?.bounds === actor.previewBounds, 'Actor Lab keyboard navigation includes its viewport');

	// A real dirty document requests a decision; cancellation must not save or reboot it.
	const saved = model.lastSavedSource, boot = ide.boots.latestOperation;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- input admission regression\n' }]);
	ide.editor.commands.execute('reboot');
	check(inputFocus.target === ide.editor.actionPrompt.focusTarget && execution.executionBlocked(),
		'a command invoked over game focus transfers input to its confirmation dialog');
	setKey('Escape', true);
	for (let index = 0; index < 4; index++) await frame();
	check(ide.editor.actionPrompt.visible && ide.editor.guestInputRecipient === null, 'held Escape stays owned by the modal');
	setKey('Escape', false);
	await frame();
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInput?.bounds === actor.previewBounds,
		'Escape release cancels and returns to the invoking viewport');
	ide.editor.commands.execute('reboot');
	const cancel = ide.editor.actionPrompt.view.buttons.find(button => button.choice === 'cancel')!;
	await test.capture?.('game-action-prompt');
	test.movePointer(cancel.bounds);
	test.setPointerButton('pointer_primary', true);
	for (let index = 0; index < 4; index++) await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(ide.editor.actionPrompt.visible && sample.pointerButtons === 0,
		'holding Cancel cannot close the dialog or leak its click into the guest');
	test.setPointerButton('pointer_primary', false);
	await frame();
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInput?.bounds === actor.previewBounds
		&& model.dirty && model.lastSavedSource === saved && ide.boots.latestOperation === boot,
		'Cancel release restores focus without saving or rebooting');
	ide.editor.commands.execute('reboot');
	harness.openLuaSource('cart.lua');
	await frame();
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInput?.bounds === undefined,
		'editor replacement cancels modal focus instead of restoring a detached viewport');
	model.undo();
	await press('ControlRight', 'ShiftRight');
	setKey('KeyZ', true);
	await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(!ide.editor.isActive && (sample.keyWords[usage >>> 5] & keyMask) !== 0,
		'leaving Studio restores ordinary host gameplay input');
	setKey('KeyZ', false);
	await ide.editor.shutdown();
	input.dispose();
	return { gameInput: 'pass', videoTick: runtime.frameScheduler.lastTickSequence };
}
