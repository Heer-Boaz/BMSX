import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyModifier } from '../../hosts/common/input/player';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_INDEX_BY_CODE } from '../../hosts/common/input/on_screen_keyboard_keys';
import { HostUiInput, HostUiInputSource } from '../../hosts/common/input/ui';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

function fixture() {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const keyboard = input.getPlayerInput(1).inputHandlers.keyboard!;
	const virtual = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	const snapshot = createInputControllerSnapshot();
	virtual.open();
	return { input, keyboard, virtual, clock, snapshot,
		physical(code: string, down: boolean, device = 'keyboard:0') { input.inputButton(device, code, down, down ? 1 : 0, clock.now(), 1); },
		touch(code: string) { const source = virtual.allocateSource(); virtual.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get(code)); return source; },
		poll() { clock.advance(20); input.pollInput(); },
		pressed(code: string) { input.sampleInputControllerSnapshot(snapshot, 0); const usage = hidKeyUsageForCode(code); return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0; },
	};
}

test('virtual modifiers are typing, not the physical keyboard half of a host control chord', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.physical('ControlRight', true); f.touch('ShiftLeft'); f.touch('KeyQ'); f.poll();
	assert.equal(f.input.supervisorRequestLineHigh(), false);
	assert.equal(f.keyboard.getButtonState('lb').pressed, false);
	assert.equal(f.keyboard.getKeyState('ShiftLeft').pressed, true);
	assert.equal(f.keyboard.getKeyState('ShiftLeft').consumed, false);
	assert.equal(f.pressed('ControlRight'), false);
	assert.equal(f.pressed('ShiftLeft'), true); assert.equal(f.pressed('KeyQ'), true);
	f.physical('ControlRight', false); f.poll();
	assert.equal(f.pressed('ShiftLeft'), true, 'physical capture release cannot retain a virtual key in that chord');
	f.virtual.close(); f.poll(); assert.equal(f.pressed('ShiftLeft'), false); assert.equal(f.pressed('KeyQ'), false);
});

test('a virtual control modifier cannot open a physical host chord; a true physical chord still can', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.input.setVirtualKeyboardKey('ControlRight', true); f.physical('ShiftLeft', true); f.poll();
	assert.equal(f.input.supervisorRequestLineHigh(), false);
	assert.equal(f.pressed('ControlRight'), true); assert.equal(f.pressed('ShiftLeft'), true);
	f.input.setVirtualKeyboardKey('ControlRight', false); f.physical('ShiftLeft', false); f.poll();
	f.physical('ControlRight', true); f.physical('ShiftLeft', true); f.touch('ShiftLeft'); f.poll();
	assert.equal(f.input.supervisorRequestLineHigh(), true);
	assert.equal(f.pressed('ControlRight'), false); assert.equal(f.pressed('ShiftLeft'), true, 'consuming hardware Shift leaves virtual Shift held');
	f.physical('ControlRight', false); f.poll();
	assert.equal(f.input.supervisorRequestLineHigh(), false); assert.equal(f.pressed('ShiftLeft'), true);
	f.virtual.close(); f.poll(); assert.equal(f.pressed('ShiftLeft'), false, 'still-held physical chord remains captured until its own release');
	f.physical('ShiftLeft', false); f.poll();
	f.physical('ShiftLeft', true); f.poll(); assert.equal(f.pressed('ShiftLeft'), true);
});

test('virtual Ctrl+S still invokes intentional raw-key editor shortcuts', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	let saves = 0;
	f.input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, 'KeyS', () => saves++, KeyModifier.ctrl);
	f.touch('ControlLeft'); const letter = f.touch('KeyS'); f.poll();
	assert.equal(saves, 1); assert.equal(f.pressed('ControlLeft'), true); assert.equal(f.pressed('KeyS'), true);
	f.poll(); assert.equal(saves, 1);
	f.virtual.releaseSource(letter); f.poll(); f.virtual.pressKey(letter, ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyS')); f.poll();
	assert.equal(saves, 2);
	f.keyboard.consumeKey('KeyS'); assert.equal(f.pressed('KeyS'), false, 'foreground editor consumption intentionally consumes virtual typing');
});

for (const code of ['KeyQ', 'ShiftLeft']) {
	test(`physical devices, virtual contacts, close and disconnect independently own ${code}`, t => {
		const f = fixture(); t.after(() => f.input.dispose());
		f.input.connectInputDevice({ id: 'keyboard:1', kind: 'keyboard' });
		f.physical(code, true); f.physical(code, true, 'keyboard:1'); f.touch(code); f.poll();
		assert.equal(f.pressed(code), true);
		f.input.disconnectInputDevice('keyboard:0'); f.poll(); assert.equal(f.pressed(code), true);
		f.virtual.close(); f.poll(); assert.equal(f.pressed(code), true, 'closing virtual keyboard leaves the other physical keyboard held');
		f.virtual.open(); f.touch(code); f.input.disconnectInputDevice('keyboard:1'); f.poll();
		assert.equal(f.pressed(code), true, 'physical disconnect leaves virtual ownership unchanged');
		assert.equal(f.keyboard.physicalKeyPressed(code), false);
		f.virtual.close(); f.input.resetInput(); f.poll(); assert.equal(f.pressed(code), false);
	});
}

test('physical-only consumption preserves a complete virtual tap and cannot undo foreground consumption', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.physical('KeyQ', true); f.poll();
	const contact = f.touch('KeyQ'); f.virtual.releaseSource(contact); f.poll();
	f.keyboard.consumePhysicalKey('KeyQ');
	assert.equal(f.pressed('KeyQ'), false);
	assert.equal(f.keyboard.getKeyState('KeyQ').pressed, false);
	assert.equal(f.keyboard.getKeyState('KeyQ').justpressed, true);
	assert.equal(f.keyboard.getKeyState('KeyQ').justreleased, true);
	assert.equal(f.keyboard.getKeyState('KeyQ').consumed, false);
	f.touch('KeyQ'); f.poll(); f.keyboard.consumeKey('KeyQ'); f.keyboard.consumePhysicalKey('KeyQ');
	assert.equal(f.pressed('KeyQ'), false); assert.equal(f.keyboard.getKeyState('KeyQ').consumed, true);
});

test('host UI physical focus and its exit capture never acquire virtual keyboard contacts', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const ui = new HostUiInput(f.input, {} as VideoPresenter);
	const a = InputControllerGamepadButtonBit.A;
	const tick = () => { f.poll(); ui.update(f.clock.now()); ui.consume(); };
	ui.reset(HostUiInputSource.Keyboard, 1 << a); tick();
	const contact = f.touch('Enter'); tick();
	assert.equal(ui.buttonJustPressed(a), false); assert.equal(f.pressed('Enter'), true);
	f.virtual.releaseSource(contact); tick();
	f.physical('Enter', true); tick(); assert.equal(ui.buttonJustPressed(a), true);
	ui.reset(HostUiInputSource.None, 0); f.touch('Enter');
	for (let frame = 0; frame < 3; frame += 1) { tick(); assert.equal(f.pressed('Enter'), true); }
	f.physical('Enter', false); tick(); assert.equal(f.pressed('Enter'), true);
	f.virtual.close(); tick(); assert.equal(f.pressed('Enter'), false);
	f.physical('Enter', true); tick(); assert.equal(f.pressed('Enter'), true, 'a fresh physical press is not retained by the expired exit capture');
});

for (const physicalFirst of [false, true]) {
	test(`a touch modifier used by a real keyboard is not an unused sticky tap (hardware first: ${physicalFirst})`, t => {
		const f = fixture(); t.after(() => f.input.dispose());
		if (physicalFirst) f.physical('KeyQ', true);
		const shift = f.touch('ShiftLeft');
		if (!physicalFirst) f.physical('KeyQ', true);
		f.poll(); assert.equal(f.pressed('ShiftLeft'), true); assert.equal(f.pressed('KeyQ'), true);
		f.physical('KeyQ', false); f.virtual.releaseSource(shift, true); f.poll();
		assert.equal(f.virtual.shiftActive, false); assert.equal(f.pressed('ShiftLeft'), false);
	});
}

test('hardware chord history survives repeats and device-local cancellation without stealing other sources', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.input.connectInputDevice({ id: 'keyboard:1', kind: 'keyboard' });
	f.physical('KeyQ', true); const generation = f.keyboard.physicalOrdinaryPressGeneration;
	f.physical('KeyQ', true); f.physical('KeyQ', true, 'keyboard:1');
	assert.equal(f.keyboard.physicalOrdinaryHeldCount, 1); assert.equal(f.keyboard.physicalOrdinaryPressGeneration, generation);
	const contact = f.touch('KeyQ'); f.input.resetInput('keyboard:0'); f.poll();
	assert.equal(f.keyboard.physicalOrdinaryHeldCount, 1); assert.equal(f.pressed('KeyQ'), true);
	f.input.resetInput('keyboard:1'); f.poll();
	assert.equal(f.keyboard.physicalOrdinaryHeldCount, 0); assert.equal(f.keyboard.physicalOrdinaryPressGeneration, generation);
	assert.equal(f.pressed('KeyQ'), true, 'device-local cancel leaves virtual held-key ownership intact');
	f.virtual.releaseSource(contact); f.physical('KeyQ', true); f.poll();
	assert.equal(f.keyboard.physicalOrdinaryPressGeneration, generation + 1, 'cancel retains the physical device binding for the next event');
	f.virtual.close(); f.input.resetInput(); f.poll();
	assert.equal(f.keyboard.physicalOrdinaryHeldCount, 0); assert.equal(f.pressed('KeyQ'), false);
	assert.equal(f.keyboard.physicalOrdinaryPressGeneration, generation + 1, 'whole-host reset cannot alias an old captured generation');
});

test('hardware modifiers change virtual legends and feedback only when they reach the typing recipient', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const digit = ON_SCREEN_KEY_INDEX_BY_CODE.get('Digit1');
	const shift = ON_SCREEN_KEY_INDEX_BY_CODE.get('ShiftLeft');
	const before = f.virtual.revision;
	f.physical('ShiftRight', true); f.poll(); f.virtual.updateFeedback(f.clock.now());
	assert.equal(f.virtual.label(digit), '!'); assert.equal(f.virtual.isKeyPressed(shift), true);
	assert.equal(f.virtual.revision, before + 1);
	const unchanged = f.virtual.revision; f.poll(); f.virtual.updateFeedback(f.clock.now());
	assert.equal(f.virtual.revision, unchanged, 'unchanged hardware modifiers create no presentation churn');
	const key = f.touch('Digit1'); f.poll();
	assert.equal(f.pressed('ShiftRight'), true); assert.equal(f.pressed('ShiftLeft'), false, 'hardware Shift is never republished as a virtual Shift');
	f.virtual.releaseSource(key); f.physical('ShiftRight', false); f.poll(); f.virtual.updateFeedback(f.clock.now());
	assert.equal(f.virtual.label(digit), '1'); assert.equal(f.virtual.isKeyPressed(shift), false);
	f.physical('ControlRight', true); f.physical('ShiftLeft', true); f.touch('Digit1'); f.poll(); f.virtual.updateFeedback(f.clock.now());
	assert.equal(f.input.supervisorRequestLineHigh(), true); assert.equal(f.pressed('ShiftLeft'), false); assert.equal(f.pressed('Digit1'), true);
	assert.equal(f.virtual.label(digit), '1', 'a hardware host chord must not advertise a consumed Shift to virtual typing');
	assert.equal(f.virtual.isKeyPressed(shift), false);
});

test('physical host capture precedes editor shortcut routing without hiding a separate virtual modifier', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	let shiftedCommands = 0;
	f.input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, 'Digit1', () => shiftedCommands++, KeyModifier.shift);
	f.physical('ControlRight', true); f.physical('ShiftLeft', true); const digit = f.touch('Digit1'); f.poll();
	assert.equal(f.input.supervisorRequestLineHigh(), true);
	assert.equal(f.keyboard.getKeyState('ShiftLeft').pressed, true, 'consumption does not fabricate physical release');
	assert.equal(f.keyboard.getKeyState('ShiftLeft').consumed, true);
	assert.equal(f.input.getPlayerInput(1).getModifiers(), KeyModifier.none);
	assert.equal(shiftedCommands, 0, 'editor cannot accept a hardware modifier owned by a host control chord');
	f.virtual.releaseSource(digit); f.poll(); f.touch('ShiftLeft');
	f.virtual.pressKey(digit, ON_SCREEN_KEY_INDEX_BY_CODE.get('Digit1')); f.poll();
	assert.equal(f.input.getPlayerInput(1).getModifiers(), KeyModifier.shift);
	assert.equal(shiftedCommands, 1, 'a separate virtual Shift remains an intentional editor modifier');
	f.keyboard.consumeKey('ShiftLeft'); assert.equal(f.input.getPlayerInput(1).getModifiers(), KeyModifier.none);
});
