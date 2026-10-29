import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WorkbenchFixedEdgeSplitView, WorkbenchSplitView } from '../../ide/workbench/ui/split_view';

function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService(() => focus.notifyTargetChanged());
	const area = { left: 20, top: 30, right: 620, bottom: 430 };
	const parent = focus.createTarget(); parent.bindKeyboard(() => {});
	const root = surfaces.attach({ role: 'window', captureScope: parent.scope.surfaceScope,
		isVisible: () => true, getBounds: () => area, getClip: () => area, draw() {} });
	const origin = focus.createTarget(parent, new InputFocusScope(Symbol('native resize invoker'), parent.scope));
	origin.bindKeyboard(() => {});
	const originSurface = surfaces.attach({ role: 'content', lifetimeOwner: root, presentationParent: root,
		captureScope: origin.scope.surfaceScope, isVisible: () => true, getBounds: () => area, getClip: () => area, draw() {} });
	const sibling = focus.createTarget(parent); sibling.bindKeyboard(() => {});
	const unbindAdmission = focus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope);
		return surface !== undefined && surfaces.isFocusAdmitted(surface);
	});
	const split = new WorkbenchSplitView(0.5); split.minimumFirstSize = split.minimumSecondSize = 80;
	split.layout(area.left, area.top, area.right, area.bottom);
	const control = new WorkbenchSplitControl(focus, capture, hover, parent, new InputFocusScope(Symbol('native sash'), parent.scope));
	control.setInput(split);
	const sashSurface = surfaces.attach({ role: 'content', lifetimeOwner: root, presentationParent: root,
		captureScope: control.focusTarget.scope.surfaceScope, isVisible: () => control.input !== undefined,
		getBounds: () => area, getClip: () => area, draw() {}, onRetire: () => control.clearInput() });
	origin.focus();
	const key = (code: string, repeat = false, modifiers = KeyModifier.none) => {
		const event = new KeyInputEvent(code, modifiers, repeat); focus.handleKeyboard(event);
		focus.handleKeyboard(new KeyInputEvent(code, modifiers, false, false)); return event;
	};
	t.after(() => { control.dispose(); surfaces.dispose(); unbindAdmission(); focus.setTarget(null); });
	return { focus, capture, surfaces, area, root, parent, origin, sibling, originSurface, sashSurface, split, control, key };
}

test('shared tool-local Tab-linked sashes retain continuous keyboard admission without an invocation-only session', t => {
	const f = fixture(t), before = f.split.ratio;
	f.origin.next = f.control.focusTarget; f.control.focusTarget.next = f.origin;
	assert.equal(f.focus.moveFocus(false), true); assert.ok(f.focus.admittedTarget === f.control.focusTarget);
	assert.equal(f.control.interactionActive, false);
	assert.equal(f.key('ArrowRight').consumed, true); assert.ok(f.split.ratio > before);
	f.key('Home'); assert.equal(f.split.ratio, f.split.defaultRatio);
	assert.equal(f.focus.moveFocus(false), true); assert.ok(f.focus.admittedTarget === f.origin);
});

for (const finish of ['Enter', 'Escape'] as const)
	test(`shared sash ${finish} returns to its exact invoker without rolling back live keyboard sizing`, t => {
		const f = fixture(t), before = f.split.ratio;
		assert.ok(f.control.input === f.split);
		assert.equal(f.control.focusForResize(f.origin), true);
		assert.ok(f.focus.admittedTarget === f.control.focusTarget);
		assert.equal(f.key('ArrowRight').consumed, true); assert.ok(f.split.ratio > before);
		const first = f.split.ratio;
		assert.equal(f.key('ArrowRight', true).consumed, true); assert.ok(f.split.ratio > first);
		const finePosition = f.split.position;
		assert.equal(f.key('ArrowRight', false, KeyModifier.ctrl).consumed, true);
		assert.equal(f.split.position, finePosition + 1, 'the focused control owns the one-pixel fine keyboard step');
		const resized = f.split.ratio;
		assert.equal(f.key(finish).consumed, true);
		assert.ok(f.focus.admittedTarget === f.origin);
		assert.equal(f.split.ratio, resized, 'finishing is focus departure, not a transaction rollback');
		assert.equal(f.capture.active, false);
	});

test('shared sash Home invokes its actual ratio owner and ignores the other resize axis', t => {
	const f = fixture(t); f.split.ratio = 0.7;
	assert.equal(f.control.focusForResize(f.origin), true);
	assert.equal(f.key('ArrowDown').consumed, false); assert.equal(f.split.ratio, 0.7);
	assert.equal(f.key('ArrowLeft', false, KeyModifier.alt).consumed, false); assert.equal(f.split.ratio, 0.7);
	assert.equal(f.key('Home').consumed, true); assert.equal(f.split.ratio, f.split.defaultRatio);
	f.key('Escape'); assert.ok(f.focus.admittedTarget === f.origin);
});

test('a constrained resettable sash retains reset authority without offering an inert keyboard-resize entry', t => {
	const f = fixture(t), split = new WorkbenchFixedEdgeSplitView('end', 'vertical');
	split.preferredSize = 100; split.requestedSize = 150;
	split.minimumFirstSize = split.minimumSecondSize = 200;
	split.layout(f.area.left, f.area.top, f.area.right, f.area.bottom); f.control.setInput(split);
	assert.equal(split.resizable, false); assert.equal(split.canReset, true);
	assert.equal(f.control.focusForResize(f.origin), false);
	assert.equal(split.requestedSize, 150); assert.ok(f.focus.admittedTarget === f.origin);
});

test('a newer focus chosen by the departing invoker prevents a resize entry from being admitted', t => {
	const f = fixture(t); let departed = 0;
	const unbind = f.origin.onDidBlur(() => { departed++; f.sibling.focus(); }); t.after(unbind);
	assert.equal(f.control.focusForResize(f.origin), false);
	assert.equal(departed, 1); assert.ok(f.focus.admittedTarget === f.sibling);
	f.key('Enter'); assert.ok(f.focus.admittedTarget === f.sibling); assert.equal(f.split.ratio, f.split.defaultRatio);
});

test('invoker retirement during focus departure cannot leave an uncaptured incoming resize handle focused', t => {
	const f = fixture(t);
	const unbind = f.origin.onDidBlur(() => { unbind(); f.origin.scope.retireContext(); }); t.after(unbind);
	assert.equal(f.control.focusForResize(f.origin), false);
	assert.equal(f.control.interactionActive, false); assert.ok(f.focus.admittedTarget !== f.control.focusTarget);
	f.key('ArrowRight'); assert.equal(f.split.ratio, f.split.defaultRatio);
});

for (const retirement of ['input replacement', 'input clear', 'attachment', 'handle context', 'focus', 'cancelInput', 'modal'] as const)
	test(`${retirement} ends the shared sash keyboard interaction without reverting accepted resize intent`, t => {
		const f = fixture(t); assert.equal(f.control.focusForResize(f.origin), true); f.key('ArrowRight');
		const resized = f.split.ratio, replacement = new WorkbenchSplitView(0.25);
		replacement.layout(f.area.left, f.area.top, f.area.right, f.area.bottom);
		switch (retirement) {
			case 'input replacement': f.control.setInput(replacement); break;
			case 'input clear': f.control.clearInput(); break;
			case 'attachment': f.sashSurface.dispose(); break;
			case 'handle context': f.control.focusTarget.scope.retireContext(); break;
			case 'focus': f.sibling.focus(); break;
			case 'cancelInput': f.focus.cancelInput(); break;
			case 'modal': {
				const modal = f.surfaces.attach({ role: 'modal', blockedScope: f.root, lifetimeOwner: f.root, presentationParent: null,
					captureScope: Symbol('resize admission decision'), isVisible: () => true,
					getBounds: () => f.area, getClip: () => f.area, draw() {} });
				assert.equal(f.focus.admittedTarget, null);
				// Losing and regaining admission without a key must not resume the handle.
				modal.dispose(); break;
			}
		}
		assert.equal(f.control.interactionActive, false);
		f.key('ArrowRight');
		assert.equal(f.split.ratio, resized, 'a canceled keyboard session cannot keep sizing through its retained handle');
		assert.equal(replacement.ratio, replacement.defaultRatio);
		assert.ok(f.focus.admittedTarget !== f.control.focusTarget);
		f.sibling.focus(); f.key('Enter');
		assert.ok(f.focus.admittedTarget === f.sibling);
		assert.equal(f.split.ratio, resized); assert.equal(replacement.ratio, replacement.defaultRatio);
	});

for (const retirement of ['origin context', 'origin attachment'] as const)
	test(`${retirement} cannot be reacquired as a sash return target`, t => {
		const f = fixture(t); assert.equal(f.control.focusForResize(f.origin), true); f.key('ArrowRight');
		const resized = f.split.ratio;
		if (retirement === 'origin context') f.origin.scope.retireContext(); else f.originSurface.dispose();
		f.key('Escape');
		assert.ok(f.focus.admittedTarget !== f.origin); assert.equal(f.split.ratio, resized);
	});

test('clearing an old sash input cannot withdraw a newer input and keyboard interaction admitted by its focus departure', t => {
	const f = fixture(t), replacement = new WorkbenchSplitView(0.25);
	replacement.layout(f.area.left, f.area.top, f.area.right, f.area.bottom);
	assert.equal(f.control.focusForResize(f.origin), true); f.key('ArrowRight');
	const oldRatio = f.split.ratio; let rebound = 0;
	const unbind = f.control.focusTarget.onDidBlur(() => {
		unbind(); f.control.setInput(replacement); f.origin.focus();
		assert.equal(f.control.focusForResize(f.origin), true); rebound++;
	}); t.after(unbind);
	f.control.clearInput();
	assert.equal(rebound, 1); assert.ok(f.control.input === replacement);
	assert.equal(f.control.interactionActive, true); assert.ok(f.focus.admittedTarget === f.control.focusTarget);
	f.key('ArrowRight');
	assert.ok(replacement.ratio > replacement.defaultRatio); assert.equal(f.split.ratio, oldRatio);
	f.key('Escape'); assert.ok(f.focus.admittedTarget === f.origin);
});
