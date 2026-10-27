import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import type { PointerInputSnapshot } from '../../ide/common/models';

const held: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0, viewportX: 10, viewportY: 20 };

test('pointer capture delivers movement and a physical release, detached before the drop callback', () => {
	const capture = new PointerCaptureService();
	let moves = 0;
	let releases = 0;
	const next = { handleCapturedPointer() { moves += 1; }, releaseCapturedPointer() {}, cancelPointer() {} };
	const target = {
		handleCapturedPointer(snapshot: PointerInputSnapshot, now: number) { assert.equal(snapshot, held); assert.equal(now, 20); moves += 1; },
		releaseCapturedPointer(snapshot: PointerInputSnapshot, now: number) {
			assert.equal(snapshot.pressedButtons, 0);
			assert.equal(now, 40);
			releases += 1;
			capture.capture(next);
			capture.release(target); // Old drop/source navigation must not release a newly focused control.
		},
		cancelPointer() { assert.fail('a physical release is not a cancel'); },
	};
	assert.equal(capture.dispatch(held, false, 0), false);
	capture.capture(target);
	assert.equal(capture.dispatch(held, false, 20), true);
	assert.equal(moves, 1);
	assert.equal(capture.dispatch({ ...held, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 40), true);
	assert.equal(releases, 1);
	capture.dispatch(held, false, 60);
	assert.equal(moves, 2);
	capture.cancel();
});

test('modal, invalid pointer or consumed/lost input cancels; none authorizes a drop', () => {
	for (const [snapshot, blocked, released, consumed] of [
		[held, true, false, false], [{ ...held, valid: false }, false, true, false],
		[{ ...held, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false, false, true],
	] as const) {
		const capture = new PointerCaptureService();
		let stops = 0;
		capture.capture({
			handleCapturedPointer() { assert.fail('interrupted capture must not move'); },
			releaseCapturedPointer() { assert.fail('interrupted capture must not drop'); },
			cancelPointer() { stops += 1; },
		});
		assert.equal(capture.dispatch({ ...snapshot, justReleasedButtons: released ? PointerButton.Primary : 0 }, blocked, 20), consumed);
		assert.equal(stops, 1);
		assert.equal(capture.dispatch(held, false, 40), false);
	}
});

test('native capture continues outside the viewport and only physical release completes it', () => {
	const capture = new PointerCaptureService();
	let moves = 0, releases = 0;
	capture.capture({ handleCapturedPointer() { moves++; }, releaseCapturedPointer() { releases++; }, cancelPointer() { assert.fail('outside coordinates are not capture loss'); } });
	capture.dispatch({ ...held, insideViewport: false, viewportX: -12 }, false, 1);
	capture.dispatch({ ...held, insideViewport: false, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 2);
	assert.equal(moves, 1); assert.equal(releases, 1);
});

test('a surface route outlives its initiating control until all physical buttons are up', () => {
	const capture = new PointerCaptureService(), scope = Symbol('window');
	const first = { ...held, justPressedButtons: PointerButton.Primary };
	capture.beginRoute(scope, first);
	let releases = 0;
	capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { releases++; }, cancelPointer() {} });
	capture.dispatch({ ...held, pressedButtons: PointerButton.Primary | PointerButton.Secondary, justPressedButtons: PointerButton.Secondary }, false, 1, scope);
	const primaryUp = { ...held, pressedButtons: PointerButton.Secondary, justReleasedButtons: PointerButton.Primary };
	capture.dispatch(primaryUp, false, 2, scope);
	capture.endRoute(primaryUp);
	assert.equal(releases, 1); assert.equal(capture.active, false); assert.equal(capture.routeScope, scope);
	capture.endRoute({ ...held, pressedButtons: 0, justReleasedButtons: PointerButton.Secondary });
	assert.equal(capture.routeScope, undefined);
});

test('retirement cancels only the owning scope and drains its remaining hold without retargeting', () => {
	const capture = new PointerCaptureService(), scope = Symbol('first'), other = Symbol('second');
	capture.beginRoute(scope, { ...held, justPressedButtons: PointerButton.Primary });
	let cancels = 0;
	capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('cancel must not commit'); }, cancelPointer() { cancels++; } });
	capture.cancelScope(other);
	assert.equal(capture.active, true);
	capture.cancelScope(scope);
	assert.equal(cancels, 1); assert.equal(capture.draining, true);
	capture.beginRoute(other, { ...held, pressedButtons: PointerButton.Primary | PointerButton.Secondary, justPressedButtons: PointerButton.Secondary });
	assert.equal(capture.routeScope, undefined);
	assert.equal(capture.dispatch(held, false, 1, other), true);
	assert.equal(capture.dispatch({ ...held, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 2, other), true);
	assert.equal(capture.draining, false);
	capture.beginRoute(other, { ...held, justPressedButtons: PointerButton.Primary });
	assert.equal(capture.routeScope, other);
});

test('capture replacement detaches before notifying the old owner; stale releases cannot release the new owner', () => {
	const capture = new PointerCaptureService();
	let stops = 0;
	let moves = 0;
	const first = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { capture.release(first); stops += 1; } };
	const second = { handleCapturedPointer() { moves += 1; }, releaseCapturedPointer() {}, cancelPointer() { stops += 1; } };
	capture.capture(first);
	capture.capture(second);
	capture.release(first);
	capture.dispatch(held, false, 20);
	assert.equal(moves, 1);
	assert.equal(stops, 1);
	capture.cancel();
	assert.equal(stops, 2);
});

test('capture latches each initiating button; another release cannot finish it and consumption cancels it', () => {
	for (const button of [PointerButton.Primary, PointerButton.Secondary, PointerButton.Auxiliary]) {
		const capture = new PointerCaptureService();
		let moves = 0;
		let releases = 0;
		let cancels = 0;
		const target = { handleCapturedPointer() { moves += 1; }, releaseCapturedPointer() { releases += 1; }, cancelPointer() { cancels += 1; } };
		capture.capture(target, button);
		capture.dispatch({ ...held, pressedButtons: button, justReleasedButtons: (PointerButton.Primary | PointerButton.Secondary | PointerButton.Auxiliary) & ~button }, false, 1);
		assert.equal(moves, 1);
		assert.equal(releases, 0);
		capture.dispatch({ ...held, pressedButtons: 0, justReleasedButtons: button }, false, 2);
		assert.equal(releases, 1);
		assert.equal(cancels, 0);
		capture.capture(target, button);
		capture.dispatch({ ...held, pressedButtons: 0 }, false, 3);
		assert.equal(cancels, 1, 'lost/consumed input has no release edge');
		assert.equal(releases, 1);
	}
});

test('admission interruption drains an unowned physical hold; source loss clears that drain immediately', () => {
	const capture = new PointerCaptureService();
	const scope = Symbol('new admitted surface');
	capture.interrupt(true);
	capture.beginRoute(scope, { ...held, pressedButtons: PointerButton.Primary | PointerButton.Secondary, justPressedButtons: PointerButton.Secondary });
	assert.equal(capture.routeScope, undefined);
	assert.equal(capture.dispatch(held, false, 0, scope), true);
	capture.interrupt(false);
	assert.equal(capture.draining, false);
	capture.beginRoute(scope, { ...held, justPressedButtons: PointerButton.Primary });
	assert.equal(capture.routeScope, scope);
	capture.cancelButtons(PointerButton.Primary);
	assert.equal(capture.routeScope, undefined);
	assert.equal(capture.draining, true);
	assert.equal(capture.dispatch({ ...held, pressedButtons: PointerButton.Secondary }, false, 0, scope), true);
	assert.equal(capture.dispatch({ ...held, pressedButtons: 0 }, false, 0, scope), true);
	assert.equal(capture.draining, false);
});
