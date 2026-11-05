import assert from 'node:assert/strict';
import test from 'node:test';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../ide/common/constants';
import { PointerClickSequence } from '../../ide/input/pointer/click_sequence';

test('item activation requires a pair at one physical location and accepts the first host timestamp', () => {
	const clicks = new PointerClickSequence<object>(), item = {};
	assert.equal(clicks.click(item, 10, 20, 0), false);
	assert.equal(clicks.click(item, 11, 21, 1), true);
	assert.equal(clicks.click(item, 11, 21, 2), false, 'a third click starts a new pair');
	assert.equal(clicks.click(item, 11 + POINTER_DRAG_ACTIVATION_THRESHOLD, 21, 3), false, 'two distant clicks on a wide row do not activate it');
	assert.equal(clicks.click(item, 11 + POINTER_DRAG_ACTIVATION_THRESHOLD, 21, 3 + DOUBLE_CLICK_MAX_INTERVAL_MS + 1), false);
});

test('different occurrences and retired bindings cannot inherit an activation', () => {
	const clicks = new PointerClickSequence<object>(), a = { id: 'same' }, b = { id: 'same' };
	assert.equal(clicks.click(a, 10, 20, 0), false);
	assert.equal(clicks.click(b, 10, 20, 1), false);
	clicks.clear();
	assert.equal(clicks.click(b, 10, 20, 2), false);
	assert.equal(clicks.click(b, 10, 20, 3), true);
});
