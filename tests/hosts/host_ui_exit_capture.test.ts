import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { HostUiInput, HostUiInputSource } from '../../hosts/common/input/ui';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { createInputControllerSnapshot, INP_POINTER_BUTTON_PRIMARY, INP_POINTER_BUTTON_SECONDARY, InputControllerGamepadAxis, InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

const A = 1 << InputControllerGamepadButtonBit.A;
const B = 1 << InputControllerGamepadButtonBit.B;
const LT = 1 << InputControllerGamepadButtonBit.LeftTrigger;
const LS = 1 << InputControllerGamepadButtonBit.LeftStick;

function fixture() {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	for (let player = 0; player < 2; player += 1) input.connectInputDevice({ id: `gamepad:${player}`, kind: 'gamepad', gamepadIndex: player, label: 'PAD', vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	const ui = new HostUiInput(input, { mapDisplayPointToViewport(x: number, y: number, out: { x: number; y: number }) { out.x = x; out.y = y; return true; } } as VideoPresenter);
	const snapshot = createInputControllerSnapshot();
	let pressId = 0;
	return {
		input, ui, snapshot,
		button(device: string, code: string, down: boolean) { input.inputButton(device, code, down, down ? 1 : 0, clock.now() + 1, ++pressId); },
		tick() { clock.advance(20); input.pollInput(); ui.update(clock.now()); ui.consume(); input.sampleInputControllerSnapshot(snapshot, 0); },
		key(code: string) { const usage = hidKeyUsageForCode(code); return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0; },
	};
}

test('host focus exit retains only already-held pad bits, leaving axes and independent new controls untouched', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.ui.reset(HostUiInputSource.Gamepad, 0);
	f.tick();
	for (const code of ['a', 'lt', 'ls']) f.button('gamepad:0', code, true);
	f.button('gamepad:1', 'a', true);
	f.input.inputAxis2('gamepad:0', 'ls', 0.5, 0, 21);
	f.tick();
	f.ui.reset(HostUiInputSource.None, 0);
	for (let frame = 0; frame < 15; frame += 1) {
		f.tick();
		assert.equal(f.input.getPlayerInput(1).inputHandlers.gamepad!.physicalGamepadButtonsWord(), A | LT | LS);
		assert.equal(f.snapshot.pads[0].buttons, 0);
		assert.equal(f.snapshot.pads[1].buttons, 0);
		assert.equal(f.snapshot.pads[0].axesQ16[InputControllerGamepadAxis.LeftX], 0x8000, 'focus exit captures buttons, not independent axes');
		assert.equal(f.snapshot.pads[0].axesQ16[InputControllerGamepadAxis.LeftTrigger], 0x10000);
	}
	f.button('gamepad:0', 'b', true);
	f.tick();
	assert.equal(f.snapshot.pads[0].buttons, B, 'an independent fresh button is not globally suppressed');
	f.button('gamepad:0', 'a', false);
	f.tick();
	f.button('gamepad:0', 'a', true);
	f.tick();
	assert.equal(f.snapshot.pads[0].buttons, A | B, 'one actual up rearms only its own button while other captured controls remain held');
	assert.equal(f.snapshot.pads[1].buttons, 0, 'another player retains independent focus-exit ownership');
	f.button('gamepad:1', 'a', false);
	f.tick();
	f.button('gamepad:1', 'a', true);
	f.tick();
	assert.equal(f.snapshot.pads[1].buttons, A);
});

test('physical keyboard aliases retain distinct focus-exit lifetimes and leaving keyboard focus does not capture new typing', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.ui.reset(HostUiInputSource.Keyboard | HostUiInputSource.Gamepad, A);
	f.tick();
	f.button('keyboard:0', 'Enter', true);
	f.tick();
	f.ui.reset(HostUiInputSource.Gamepad, 0);
	for (let frame = 0; frame < 15; frame += 1) { f.tick(); assert.equal(f.key('Enter'), false); }
	assert.equal(f.input.getPlayerInput(1).inputHandlers.keyboard!.getKeyState('Enter').pressed, true);
	f.button('keyboard:0', 'NumpadEnter', true);
	f.tick();
	assert.equal(f.key('Enter'), false);
	assert.equal(f.key('NumpadEnter'), true, 'a new physical key is distinct even though both keys activate UI button A');
	f.button('keyboard:0', 'Enter', false);
	f.tick();
	f.button('keyboard:0', 'Enter', true);
	f.tick();
	assert.equal(f.key('Enter'), true);
	assert.equal(f.key('NumpadEnter'), true);
});

test('closing host pointer focus retains the existing primary hold but does not capture secondary or a fresh primary press', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.ui.reset(HostUiInputSource.Pointer, 0);
	f.tick();
	f.input.inputAxis2('pointer:0', 'pointer_position', 10, 10, 21);
	f.button('pointer:0', 'pointer_primary', true);
	f.tick();
	f.ui.reset(HostUiInputSource.None, 0);
	for (let frame = 0; frame < 15; frame += 1) { f.tick(); assert.equal(f.snapshot.pointerButtons, 0); }
	assert.equal(f.input.getPlayerInput(1).inputHandlers.pointer!.getButtonState('pointer_primary').pressed, true);
	f.button('pointer:0', 'pointer_secondary', true);
	f.tick();
	assert.equal(f.snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_SECONDARY);
	f.button('pointer:0', 'pointer_primary', false);
	f.tick();
	f.button('pointer:0', 'pointer_primary', true);
	f.tick();
	assert.equal(f.snapshot.pointerButtons, (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_SECONDARY));
});


test('host actions distinguish physical Enter from controller south without remapping either input', t => {
	const f = fixture();
	t.after(() => f.input.dispose());
	f.ui.reset(HostUiInputSource.Keyboard | HostUiInputSource.Gamepad, A);
	f.tick();
	f.button('gamepad:0', 'a', true); f.tick();
	assert.equal(f.ui.buttonJustPressed(InputControllerGamepadButtonBit.A), true);
	assert.equal(f.ui.keyboardButtonJustPressed(InputControllerGamepadButtonBit.A), false);
	f.button('keyboard:0', 'Enter', true); f.tick();
	assert.equal(f.ui.keyboardButtonJustPressed(InputControllerGamepadButtonBit.A), true);
	assert.equal(f.ui.gamepadButtonJustPressed(0, InputControllerGamepadButtonBit.A), false);
});
