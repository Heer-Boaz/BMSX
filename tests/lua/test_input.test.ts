import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestInput } from '../../ide/testing/input';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';

test('test input owns keyboard holds and exactly sampled, one-based gamepad presses', () => {
	const input = new TestInput();
	const snapshot = createInputControllerSnapshot();
	const key = hidKeyUsageForCode('KeyA');
	input.key('KeyA', true, null);
	assert.equal(input.press('a', 3, 2), 4);
	for (let sample = 1; sample <= 4; sample++) {
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(snapshot.pads[0].buttons, 0);
		assert.equal(snapshot.pads[1].buttons, sample <= 3 ? 1 << InputControllerGamepadButtonBit.A : 0);
		assert.ok(snapshot.keyWords[key >>> 5] & (1 << (key & 31)));
	}
	input.press('b', 10, 1);
	input.reset();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pads[0].buttons, 0);
	assert.equal(snapshot.keyWords[key >>> 5] & (1 << (key & 31)), 0);
	assert.equal(input.supervisorRequestLineHigh(), false);
});
