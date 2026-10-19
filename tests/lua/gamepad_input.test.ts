import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostClock } from '../../hosts/common/clock';
import type { GamepadDevice } from '../../hosts/common/input/contracts';
import { GamepadInput } from '../../hosts/common/input/gamepad';

const device: GamepadDevice = {
	id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'GAMEPAD',
	vibrationInitialization: null, supportsVibration: false, setVibration() {},
};

for (const origin of [0, 1000]) {
	test(`button edges publish once independently of clock origin ${origin}`, () => {
		let time = origin;
		const input = new GamepadInput({ now: () => time } as HostClock, device.id, device);
		const state = input.getButtonState('a');
		input.ingestButton('a', true, 1, time, 1);
		input.pollInput();
		assert.equal(state.justpressed, true, 'a fresh press reaches its first poll');
		input.pollInput();
		assert.equal(state.justpressed, false, 'the same press is not republished at the same clock value');
		time += 20;
		input.pollInput();
		assert.equal(state.justpressed, false);
		assert.equal(state.pressed, true);
		assert.equal(state.presstime, 20, 'timestamps still determine elapsed hold time');
		input.ingestButton('a', false, 0, time, 1);
		input.pollInput();
		assert.equal(state.justreleased, true, 'a release after the preceding same-time poll is new input');
		input.pollInput();
		assert.equal(state.justreleased, false, 'the release is published only once');
		input.ingestButton('a', true, 1, time, 2);
		input.pollInput();
		assert.equal(state.justpressed, true, 'a new press at that same timestamp is still a new edge');
		input.pollInput();
		assert.equal(state.justpressed, false);
		input.ingestButton('a', false, 0, time, 2);
		input.reset();
		input.pollInput();
		assert.equal(input.getButtonState('a').justreleased, false, 'reset discards unpublished events');
	});

	test(`stick edges publish once independently of clock origin ${origin}`, () => {
		const input = new GamepadInput({ now: () => origin } as HostClock, device.id, device);
		const state = input.getButtonState('ls');
		input.pollInput();
		input.ingestAxis2('ls', 0.5, 0, origin);
		input.pollInput();
		assert.equal(state.justpressed, true, 'stick motion after a same-time neutral poll is a fresh edge');
		input.pollInput();
		assert.equal(state.justpressed, false);
		assert.equal(state.pressed, true);
		input.ingestAxis2('ls', 0, 0, origin);
		input.pollInput();
		assert.equal(state.justreleased, true, 'centering the stick publishes a fresh release');
		input.pollInput();
		assert.equal(state.justreleased, false);
		input.ingestAxis2('ls', 0, -0.5, origin);
		input.pollInput();
		assert.equal(state.justpressed, true, 'a new motion at the same timestamp is not discarded');
		input.pollInput();
		assert.equal(state.justpressed, false);
	});
}

test('analog trigger motion updates sampled magnitude without repeating button edges', () => {
	const input = new GamepadInput({ now: () => 0 } as HostClock, device.id, device);
	const snapshot = { buttons: 0, axesQ16: new Uint32Array(6) };
	input.ingestButton('lt', true, 0.6, 0, 1);
	input.pollInput();
	assert.equal(input.getButtonState('lt').justpressed, true);
	input.ingestAxis1('lt', 0.75, 1);
	input.pollInput();
	input.writeInputControllerPadSnapshot(snapshot);
	assert.equal(snapshot.axesQ16[4], 0xc000);
	assert.equal(input.getButtonState('lt').pressed, true);
	assert.equal(input.getButtonState('lt').justpressed, false);
	input.ingestButton('lt', false, 0.25, 2, 1);
	input.pollInput();
	input.writeInputControllerPadSnapshot(snapshot);
	assert.equal(snapshot.axesQ16[4], 0x4000, 'below-threshold analog travel is independent of the button level');
	assert.equal(input.getButtonState('lt').justreleased, true);
});
