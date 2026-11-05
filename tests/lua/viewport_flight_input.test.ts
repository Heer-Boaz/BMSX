import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewportFlightInput } from '../../ide/input/viewport_flight';

test('held flight aliases retain independent physical keys, without repeat acceleration', () => {
	const input = new ViewportFlightInput(); input.begin(100);
	assert.equal(input.key('KeyW', true), true);
	assert.equal(input.key('ArrowUp', true), true);
	input.key('KeyW', true);
	assert.equal(input.advance(200, 10), true); assert.equal(input.forward, 1);
	input.key('KeyW', false);
	assert.equal(input.advance(300, 10), true); assert.equal(input.forward, 1);
	input.key('ArrowUp', false);
	assert.equal(input.advance(400, 10), false);
	assert.equal(input.key('KeyZ', true), false);
});

test('flight integrates time before transitions, including idle intervals and changed speed', () => {
	const input = new ViewportFlightInput(); input.begin(100);
	assert.equal(input.advance(1100, 10), false);
	input.key('KeyW', true);
	assert.equal(input.advance(1200, 10), true); assert.equal(input.forward, 1);
	assert.equal(input.advance(1200, 20), false, 'two deliveries at one host time cannot move twice');
	assert.equal(input.advance(1300, 20), true); assert.equal(input.forward, 2);
	input.clear(); assert.equal(input.advance(1400, 20), false);
	input.begin(2000); assert.equal(input.advance(3000, 20), false, 'a new capture cannot inherit a lost key-up');
	input.key('KeyW', true);
	assert.equal(input.advance(3100, 20), true); assert.equal(input.forward, 2);
});

test('opposing flight directions cancel and world up remains independent of camera up', () => {
	const input = new ViewportFlightInput(); input.begin(0);
	for (const code of ['Numpad8', 'ArrowDown', 'KeyA', 'ArrowRight', 'Numpad7', 'PageUp', 'KeyR', 'KeyF']) input.key(code, true);
	assert.equal(input.advance(100, 10), false);
	for (const code of ['Numpad8', 'KeyA', 'Numpad7', 'KeyF']) input.key(code, false);
	assert.equal(input.advance(200, 10), true);
	assert.deepEqual([input.right, input.up, input.forward, input.localUp], [1, 1, -1, 1]);
});
