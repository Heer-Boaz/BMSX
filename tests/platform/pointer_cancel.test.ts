import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { PointerInput } from '../../hosts/common/input/pointer';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { PointerButton, readEditorPointerButtons, type PointerButtons } from '../../ide/input/pointer/buttons';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import {
	createInputControllerSnapshot,
	INP_POINTER_BUTTON_AUX,
	INP_POINTER_BUTTON_BACK,
	INP_POINTER_BUTTON_FORWARD,
	INP_POINTER_BUTTON_PRIMARY,
	INP_POINTER_BUTTON_SECONDARY,
	InputControllerSampleContext,
} from '../../machine/ts/machine/devices/input/contracts';

test('pointer cancellation ends only named buttons, never synthesizes release and preserves poll cadence', () => {
	const clock = new VirtualHeadlessClock();
	const pointer = new PointerInput(clock);
	const snapshot = createInputControllerSnapshot();
	const primaryMask = 1 << INP_POINTER_BUTTON_PRIMARY;
	const auxiliaryMask = 1 << INP_POINTER_BUTTON_AUX;
	pointer.ingestButton('pointer_primary', true, 1, 1, 17);
	pointer.ingestButton('pointer_aux', true, 1, 2, 18);
	clock.advance(10);
	pointer.pollInput();
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, primaryMask | auxiliaryMask);
	const auxiliary = { ...pointer.getButtonState('pointer_aux') };

	pointer.cancelButtons(primaryMask, 11);
	const primary = pointer.getButtonState('pointer_primary');
	assert.equal(primary.pressed, false);
	assert.equal(primary.justpressed, false);
	assert.equal(primary.justreleased, false);
	assert.equal(primary.waspressed, false);
	assert.equal(primary.wasreleased, false);
	assert.equal(primary.pressId, 0);
	assert.equal(primary.value, 0);
	assert.equal(primary.timestamp, 11);
	assert.deepEqual(pointer.getButtonState('pointer_aux'), auxiliary, 'another button retains its complete live state');
	snapshot.pointerButtons = 0;
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, primaryMask | auxiliaryMask, 'device cancellation does not asynchronously rewrite sampled buttons');

	clock.advance(2);
	pointer.pollInput();
	snapshot.pointerButtons = 0;
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, auxiliaryMask);
	assert.equal(primary.justreleased, false);
	assert.equal(primary.wasreleased, false);
	assert.equal(pointer.getButtonState('pointer_aux').pressed, true);
	assert.equal(pointer.getButtonState('pointer_aux').pressId, 18);
	assert.equal(pointer.getButtonState('pointer_aux').pressedAtMs, 2);

	pointer.ingestButton('pointer_primary', true, 1, 13, 19);
	pointer.pollInput();
	assert.equal(primary.justpressed, true, 'a fresh physical press after cancellation remains a normal down');
	assert.equal(primary.justreleased, false);
	assert.equal(primary.pressId, 19);
});

test('cancellation removes its pending down/up edges and preserves other pending button edges', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	pointer.ingestButton('pointer_secondary', true, 1, 1, 1);
	pointer.pollInput();
	pointer.ingestButton('pointer_secondary', false, 0, 2, 1);
	pointer.ingestButton('pointer_aux', true, 1, 3, 2);
	pointer.ingestButton('pointer_primary', true, 1, 4, 3);
	pointer.ingestButton('pointer_primary', false, 0, 5, 3);
	pointer.cancelButtons(1 << INP_POINTER_BUTTON_PRIMARY, 6);
	pointer.pollInput();
	const primary = pointer.getButtonState('pointer_primary');
	assert.equal(primary.pressed, false);
	assert.equal(primary.justpressed, false);
	assert.equal(primary.justreleased, false);
	assert.equal(primary.wasreleased, false);
	assert.equal(pointer.getButtonState('pointer_aux').pressed, true);
	assert.equal(pointer.getButtonState('pointer_aux').justpressed, true);
	assert.equal(pointer.getButtonState('pointer_secondary').pressed, false);
	assert.equal(pointer.getButtonState('pointer_secondary').justreleased, true);
	const snapshot = createInputControllerSnapshot();
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_AUX);
});

test('button cancellation retains position, pending movement and wheel state', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	pointer.ingestAxis2('pointer_position', 10, 20, 1);
	pointer.pollInput();
	pointer.ingestButton('pointer_primary', true, 1, 2, 1);
	pointer.ingestAxis2('pointer_position', 13.5, 17.25, 3);
	pointer.ingestAxis2('pointer_position', 14.25, 16.5, 4);
	pointer.ingestAxis1('pointer_wheel', 1.25, 5);
	pointer.ingestAxis1('pointer_wheel', -0.5, 6);
	const position = pointer.getButtonState('pointer_position');
	const positionValue = position.value2d;
	pointer.cancelButtons(1 << INP_POINTER_BUTTON_PRIMARY, 7);
	assert.equal(pointer.positionValid, true);
	assert.equal(pointer.getButtonState('pointer_position'), position);
	assert.equal(position.value2d, positionValue, 'cancellation does not replace retained coordinate storage');
	assert.deepEqual(position.value2d, [14.25, 16.5]);
	assert.equal(position.timestamp, 4);
	pointer.pollInput();
	assert.deepEqual(pointer.getButtonState('pointer_delta').value2d, [4.25, -3.5]);
	assert.equal(pointer.getButtonState('pointer_delta').timestamp, 4);
	assert.equal(pointer.getButtonState('pointer_wheel').value, 0.75);
	assert.equal(pointer.getButtonState('pointer_wheel').timestamp, 6);
	assert.equal(pointer.getButtonState('pointer_wheel').justpressed, true);
	const snapshot = createInputControllerSnapshot();
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(14.25));
	assert.equal(snapshot.pointerYQ16, encodeSignedFix16(16.5));
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(0.75));
});

test('cancellation uses canonical ICU bit positions for all five pointer buttons', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	for (const code of ['pointer_primary', 'pointer_aux', 'pointer_secondary', 'pointer_back', 'pointer_forward']) {
		pointer.ingestButton(code, true, 1, 1, 1);
	}
	pointer.pollInput();
	const canceled = (1 << INP_POINTER_BUTTON_AUX) | (1 << INP_POINTER_BUTTON_SECONDARY) | (1 << INP_POINTER_BUTTON_FORWARD);
	pointer.cancelButtons(canceled, 2);
	pointer.pollInput();
	const snapshot = createInputControllerSnapshot();
	pointer.writeInputControllerPointerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_BACK));
	for (const code of ['pointer_aux', 'pointer_secondary', 'pointer_forward']) {
		assert.equal(pointer.getButtonState(code).pressed, false);
		assert.equal(pointer.getButtonState(code).justreleased, false);
	}
});

test('headless cancellation reaches common input and editor buttons without a primary drop or keyboard reset', () => {
	const clock = new VirtualHeadlessClock();
	const hub = new HeadlessInputHub();
	const input = new Input(clock, hub, -1);
	const player = input.getPlayerInput(1);
	const snapshot = createInputControllerSnapshot();
	const editorButtons: PointerButtons = { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	hub.post({ type: 'button', deviceId: 'keyboard:0', code: 'KeyQ', down: true, value: 1, timestamp: 1, pressId: 1 });
	hub.post({ type: 'button', deviceId: 'pointer:0', code: 'pointer_primary', down: true, value: 1, timestamp: 1, pressId: 2 });
	hub.post({ type: 'button', deviceId: 'pointer:0', code: 'pointer_aux', down: true, value: 1, timestamp: 1, pressId: 3 });
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_AUX));
	hub.post({ type: 'cancel-pointer-buttons', deviceId: 'pointer:0', buttons: 1 << INP_POINTER_BUTTON_PRIMARY, timestamp: 2 });
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_AUX));
	readEditorPointerButtons(player, editorButtons);
	assert.equal(editorButtons.justReleasedButtons & PointerButton.Primary, 0, 'IDE release/drop signal is absent immediately');
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_AUX);
	readEditorPointerButtons(player, editorButtons);
	assert.deepEqual(editorButtons, { pressedButtons: PointerButton.Auxiliary, justPressedButtons: 0, justReleasedButtons: 0 });
	assert.equal(player.getRawButtonState('KeyQ', 'keyboard').pressed, true);
	assert.equal(player.getRawButtonState('pointer_aux', 'pointer').pressId, 3);
	input.dispose();
});
