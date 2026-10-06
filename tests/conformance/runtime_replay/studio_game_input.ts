import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit, InputControllerSampleContext } from '../../../machine/ts/machine/devices/input/contracts';
import { IO_INP_KEYS, IO_INP_PADS, IO_INP_POINTER_BUTTONS } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { inputFocus } from '../../../ide/input/focus';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import { check, type StudioFixture } from './studio_fixture';
import { nemesisTitleState, reachNemesisTitle } from './studio_nemesis_navigation';

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
	check(cycles() === sourcePosition && ide.editor.capturesGuestInput, 'source focus holds gameplay and captures its input');
	await runPaletteCommand('View: Game');
	const view = getActiveTab();
	if (view.kind !== 'game_view') throw new Error('Game View required');
	await click(view.frameBounds);
	const focused = inputFocus.target;
	check(focused?.guestInputBounds === view.frameBounds && !ide.editor.capturesGuestInput, 'click gives the actual viewport guest input');
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
	check(inputFocus.target?.guestInputBounds === undefined && ide.editor.capturesGuestInput,
		'Shift+F1 returns input to Studio, not a game pause');
	await press('Tab');
	check(inputFocus.target === focused, 'workbench focus navigation can enter the viewport');
	await click({ left: view.layout.left + 1, right: view.layout.left + 2, top: view.layout.top + 1, bottom: view.layout.top + 2 });
	check(inputFocus.target?.guestInputBounds === undefined && ide.editor.capturesGuestInput,
		'clicking letterbox chrome releases game focus');

	harness.openLuaSource('cart.lua');
	await runPaletteCommand('View: Toggle Game Panel');
	check(ide.editor.gamePanel.visible && ide.editor.executionSuspended, 'source editor owns the hold while its game panel is unfocused');
	const panelCenter = { left: editorViewState.viewportWidth - editorChromeState.editorRightInset / 2,
		right: editorViewState.viewportWidth - editorChromeState.editorRightInset / 2 + 1,
		top: (view.layout.top + editorViewState.codeAreaBottom) / 2, bottom: (view.layout.top + editorViewState.codeAreaBottom) / 2 + 1 };
	await click(panelCenter);
	check(inputFocus.target?.guestInputBounds !== undefined && !ide.editor.executionSuspended && !ide.editor.capturesGuestInput,
		'focused side panel releases only the workbench hold and routes game input');
	await test.capture?.('panel-focused');
	await press('ShiftLeft', 'F1');
	const held = cycles();
	for (let index = 0; index < 4; index++) await frame();
	check(cycles() === held && ide.editor.executionSuspended, 'release restores source authoring hold');
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
	check(inputFocus.target?.guestInputBounds === undefined && sample.keyWords.every(word => word === 0),
		'hiding a focused panel revokes guest input at the next host sampling boundary');
	setKey('KeyZ', false);
	await runPaletteCommand('View: Game');
	await runPaletteCommand('Game: Play / Pause');
	await click(view.frameBounds);
	setKey('Space', true);
	await until(() => nemesisTitleState(test) !== 'idle', 'game input: viewport confirmation starts the real title sequence');
	await test.releaseGuestKey('Space');
	await press('ShiftLeft', 'F1');
	check(model.version === version && getActiveTab() === view, 'gameplay leaves source and open editors intact');
	await click(view.frameBounds);
	setKey('KeyZ', true);
	await frame();
	harness.openLuaSource('cart.lua');
	await frame();
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(sample.keyWords.every(word => word === 0) && ide.editor.executionSuspended,
		'opening another editor revokes viewport input before the guest samples again');
	setKey('KeyZ', false);

	await runPaletteCommand('Actor Lab: Open');
	await press('Enter');
	const actor = getActiveTab();
	if (actor.kind !== 'actor_lab') throw new Error('Actor Lab required');
	await click(actor.previewBounds);
	check(inputFocus.target?.guestInputBounds === actor.previewBounds && !ide.editor.executionSuspended,
		'Actor Lab preview shares guest focus and releases the authoring hold');
	setKey('KeyZ', true);
	await until(() => (runtime.machine.memory.readIoU32(keyAddress) & keyMask) !== 0, 'Actor Lab keyboard reaches the real ICU');
	await test.releaseGuestKey('KeyZ');
	await test.capture?.('actor-game-focused');
	await press('ShiftLeft', 'F1');
	const actorHeld = cycles();
	await frame(); await frame();
	check(cycles() === actorHeld && ide.editor.capturesGuestInput, 'leaving Actor Lab game focus restores its authoring hold');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	const actorPane = ide.editor.editorPanes.activePane as ActorLabEditorPane;
	const inspector = actorPane.inspector, details = actor.details;
	check(actorPane.showsGameFrame && inspector.visible && actor.detailsOpen,
		'instance Details remain beside the embedded game preview');
	await press('ArrowDown');
	const selectedProperty = inspector.model.rows[inspector.model.selectionIndex].element.label;
	const selectedActorPath = JSON.stringify(actor.selectionPath);
	check(actor.previewBounds.bottom < actor.detailsBounds.top, 'game and Details occupy separate visible surfaces');
	await test.capture?.('actor-details-adjacent');
	await click(actor.previewBounds);
	check(inputFocus.target?.guestInputBounds === actor.previewBounds && !ide.editor.capturesGuestInput
		&& inspector.visible && actor.details === details && JSON.stringify(actor.selectionPath) === selectedActorPath,
		'visible Actor Lab preview takes game input without replacing Details or actor selection');
	setKey('KeyZ', true);
	await until(() => (runtime.machine.memory.readIoU32(keyAddress) & keyMask) !== 0,
		'Actor Lab game input still reaches the ICU beside open Details');
	await test.releaseGuestKey('KeyZ');
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
	await click({ left: actor.detailsSplit.bounds.left + 1, right: actor.detailsSplit.bounds.left + 2,
		top: actor.detailsSplit.position, bottom: actor.detailsSplit.position + 1 });
	const sashFocus = inputFocus.target, initialRatio = actor.detailsSplit.ratio;
	await press('ArrowDown');
	check(actor.detailsSplit.ratio > initialRatio, 'visible Details sash owns its focused resize keys');
	const hiddenRatio = actor.detailsSplit.ratio;
	await click(inspector.actionBar.items.find(item => item.command === 'propertyInspector.close')!.bounds);
	check(!inspector.visible && !actor.detailsOpen && inputFocus.target !== sashFocus,
		'pointer Hide releases the focused Details sash instead of parking focus on an invisible control');
	await press('ArrowDown');
	check(actor.detailsSplit.ratio === hiddenRatio, 'the hidden Details sash cannot consume resize keys');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	await click({ left: actor.detailsSplit.bounds.left + 1, right: actor.detailsSplit.bounds.left + 2,
		top: actor.detailsSplit.position, bottom: actor.detailsSplit.position + 1 });
	await press('ArrowUp');
	check(actor.detailsSplit.ratio < hiddenRatio, 'reopening Details reattaches the same sash input owner');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	await press('Escape');
	check(actorPane.showsGameFrame && !inspector.visible && !actor.detailsOpen,
		'explicitly closing Details leaves the preview visible');
	await press('ShiftLeft', 'Tab');
	check(inputFocus.target?.guestInputBounds === actor.previewBounds, 'Actor Lab keyboard navigation includes its viewport');

	// A real dirty document requests a decision; cancellation must not save or reboot it.
	const saved = model.lastSavedSource, boot = ide.boots.latestOperation;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- input admission regression\n' }]);
	ide.editor.commands.execute('reboot');
	check(inputFocus.target === ide.editor.actionPrompt.focusTarget && ide.editor.executionSuspended,
		'a command invoked over game focus transfers input to its confirmation dialog');
	setKey('Escape', true);
	for (let index = 0; index < 4; index++) await frame();
	check(ide.editor.actionPrompt.visible && ide.editor.capturesGuestInput, 'held Escape stays owned by the modal');
	setKey('Escape', false);
	await frame();
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInputBounds === actor.previewBounds,
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
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInputBounds === actor.previewBounds
		&& model.dirty && model.lastSavedSource === saved && ide.boots.latestOperation === boot,
		'Cancel release restores focus without saving or rebooting');
	ide.editor.commands.execute('reboot');
	harness.openLuaSource('cart.lua');
	await frame();
	check(!ide.editor.actionPrompt.visible && inputFocus.target?.guestInputBounds === undefined,
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
