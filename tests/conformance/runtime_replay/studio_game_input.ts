import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit, InputControllerSampleContext } from '../../../machine/ts/machine/devices/input/contracts';
import { IO_INP_KEYS, IO_INP_PADS, IO_INP_POINTER_BUTTONS } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { inputFocus } from '../../../ide/input/focus';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
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
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(inputFocus.target?.guestInputBounds === undefined && sample.keyWords.every(word => word === 0),
		'hiding a focused panel immediately revokes guest input, before another host frame');
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
	input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	check(sample.keyWords.every(word => word === 0) && ide.editor.executionSuspended,
		'opening another editor revokes viewport input immediately');
	setKey('KeyZ', false);
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
