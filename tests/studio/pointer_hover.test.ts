import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { InputFocusService } from '../../ide/input/focus';
import { KeyModifier } from '../../hosts/common/input/text';

test('hover enters once, retains an actual nested route and leaves unvisited targets once', () => {
	const hover = new PointerHoverService(), calls: string[] = [];
	const parent = { onPointerEnter: () => calls.push('parent enter'), onPointerLeave: () => calls.push('parent leave') };
	const child = { onPointerEnter: () => calls.push('child enter'), onPointerLeave: () => calls.push('child leave') };
	for (let frame = 0; frame < 3; frame += 1) {
		hover.beginDispatch(); hover.visit(parent); hover.visit(child); hover.visit(child); hover.endDispatch();
	}
	assert.deepEqual(calls, ['parent enter', 'child enter']);
	hover.beginDispatch(); hover.visit(parent); hover.endDispatch();
	assert.deepEqual(calls, ['parent enter', 'child enter', 'child leave']);
	hover.beginDispatch(); hover.endDispatch(); hover.clear();
	assert.deepEqual(calls, ['parent enter', 'child enter', 'child leave', 'parent leave']);
});

test('hover release detaches before notification, including synchronous enter/leave removal', () => {
	const hover = new PointerHoverService(), calls: string[] = [];
	const first = { onPointerLeave() { calls.push('first'); hover.release(first); hover.release(second); } };
	const second = { onPointerLeave() { calls.push('second'); hover.release(first); } };
	hover.beginDispatch(); hover.visit(first); hover.visit(second); hover.endDispatch();
	hover.clear(); hover.release(first); hover.release(second);
	assert.deepEqual(calls, ['first', 'second']);
	const selfRemoving = { onPointerEnter() { hover.release(selfRemoving); }, onPointerLeave() { calls.push('self'); } };
	hover.beginDispatch(); hover.visit(selfRemoving); hover.endDispatch(); hover.clear();
	assert.deepEqual(calls, ['first', 'second', 'self']);
});

test('leave may detach another target or enter a new target without stale sweep removal', () => {
	const hover = new PointerHoverService(), calls: string[] = [];
	const replacement = { onPointerEnter() { calls.push('replacement enter'); }, onPointerLeave() { calls.push('replacement leave'); } };
	const second = { onPointerLeave() { calls.push('second leave'); } };
	const first = { onPointerLeave() { calls.push('first leave'); hover.release(second); hover.visit(replacement); } };
	hover.beginDispatch(); hover.visit(first); hover.visit(second); hover.endDispatch();
	hover.beginDispatch(); hover.endDispatch();
	assert.deepEqual(calls, ['first leave', 'second leave', 'replacement enter']);
	hover.beginDispatch(); hover.endDispatch();
	assert.equal(calls.at(-1), 'replacement leave');
});

test('popup/capture early routes revoke hover, never focus or capture', () => {
	const hover = new PointerHoverService(), capture = new PointerCaptureService(), focus = new InputFocusService();
	const field = focus.createTarget(); field.focus();
	let leaves = 0;
	const target = { onPointerLeave() { leaves += 1; }, handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() {} };
	hover.beginDispatch(); hover.visit(target); hover.endDispatch(); capture.capture(target);
	hover.beginDispatch(); hover.endDispatch();
	assert.equal(leaves, 1); assert.equal(focus.target, field); assert.equal(capture.active, true);
	hover.beginDispatch(); hover.visit(target); hover.endDispatch(); hover.release(target);
	assert.equal(leaves, 2); assert.equal(focus.target, field); assert.equal(capture.active, true);
	assert.equal(Object.hasOwn(target, 'onPointerEnter'), false, 'leave-only controls need no no-op enter implementation');
});

test('presentation changes retain only the same physically routed hover path', () => {
	const hover = new PointerHoverService(), owner = Symbol('owner'), sibling = Symbol('sibling');
	const modifiers: KeyModifier[] = [];
	let leaves = 0;
	const target = { onPointerModifiersChanged(value: KeyModifier) { modifiers.push(value); }, onPointerLeave() { leaves += 1; } };
	hover.beginDispatch(owner); hover.visit(target); hover.endDispatch();
	hover.reconcileRoute(owner); hover.dispatchModifiers(KeyModifier.ctrl);
	assert.equal(hover.has(target), true); assert.deepEqual(modifiers, [KeyModifier.ctrl]); assert.equal(leaves, 0);
	hover.reconcileRoute(sibling); hover.dispatchModifiers(KeyModifier.alt);
	assert.equal(hover.has(target), false); assert.deepEqual(modifiers, [KeyModifier.ctrl]); assert.equal(leaves, 1);
	hover.reconcileRoute(owner);
	assert.equal(hover.has(target), false, 'restored geometry does not replay a pointer occurrence');
	hover.beginDispatch(owner); hover.visit(target); hover.endDispatch(); hover.reconcileRoute(undefined);
	assert.equal(leaves, 2);
	hover.beginDispatch(); hover.visit(target); hover.endDispatch(); hover.reconcileRoute(owner);
	assert.equal(leaves, 3, 'direct control input carries no structural route authority');
});
