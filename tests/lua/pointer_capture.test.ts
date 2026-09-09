import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../ide/common/models';

const held: PointerSnapshot = { valid: true, insideViewport: true, primaryPressed: true, viewportX: 10, viewportY: 20 };

test('pointer capture delivers held movement and consumes release without inventing a new press', () => {
	const capture = new PointerCaptureService();
	let moves = 0;
	let stops = 0;
	const target = { handleCapturedPointer(snapshot: PointerSnapshot) { assert.equal(snapshot, held); moves += 1; }, cancelPointer() { stops += 1; } };
	assert.equal(capture.dispatch(held, false), false);
	capture.capture(target);
	assert.equal(capture.dispatch(held, false), true);
	assert.equal(moves, 1);
	assert.equal(capture.dispatch({ ...held, primaryPressed: false }, false), true);
	assert.equal(stops, 1);
	assert.equal(capture.dispatch(held, false), false);
});

test('a modal, invalid pointer or departed viewport ends capture instead of suspending it', () => {
	for (const [snapshot, blocked] of [[held, true], [{ ...held, valid: false }, false], [{ ...held, insideViewport: false }, false]] as const) {
		const capture = new PointerCaptureService();
		let stops = 0;
		capture.capture({ handleCapturedPointer() { assert.fail('interrupted capture must not move'); }, cancelPointer() { stops += 1; } });
		assert.equal(capture.dispatch(snapshot, blocked), false);
		assert.equal(stops, 1);
		assert.equal(capture.dispatch(held, false), false);
	}
});

test('capture replacement detaches before notifying the old owner; stale releases cannot release the new owner', () => {
	const capture = new PointerCaptureService();
	let stops = 0;
	let moves = 0;
	const first = { handleCapturedPointer() {}, cancelPointer() { capture.release(first); stops += 1; } };
	const second = { handleCapturedPointer() { moves += 1; }, cancelPointer() { stops += 1; } };
	capture.capture(first);
	capture.capture(second);
	capture.release(first);
	capture.dispatch(held, false);
	assert.equal(moves, 1);
	assert.equal(stops, 1);
	capture.cancel();
	assert.equal(stops, 2);
});
