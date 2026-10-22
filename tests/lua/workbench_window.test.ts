import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const pointer = (x: number, y: number, buttons = 0, pressed = 0, released = 0): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: buttons, justPressedButtons: pressed, justReleasedButtons: released, modifiers: KeyModifier.none, spaceDown: false,
});

function fixture() {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService();
	const workArea = { left: 0, top: 20, right: 500, bottom: 380 };
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, isVisible: () => true,
		getBounds: () => workArea, getClip: () => workArea, draw() {} });
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string, from: number, to: number) => { measurements += 1; return font.measure(text.slice(from, to)); };
	const measureText = (text: string) => { measurements += 1; return font.measure(text); };
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => focus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => focus.executeCommand(command, target),
	};
	function window(name: string, left = 40, top = 40, onRetireContent?: () => void) {
		const model = new WorkbenchWindowModel({ left, top, right: left + 240, bottom: top + 180 }, 120, 80);
		model.title = name;
		const actions = createWorkbenchActionBar('window.title');
		let input = false, layouts = 0, restores = 0, retires = 0, painted = 0, clicked = 0, hidden = 0;
		const control = new WorkbenchFloatingWindow(focus, capture, hover, surfaces, commands, {
			model, actionBar: actions, lifetimeOwner: owner, focusReturn: parent, getWorkArea: () => workArea,
			content: { draw() { painted += 1; }, handlePointer() { clicked += 1; } },
			layoutContent() { layouts += 1; }, retireContentInput() { input = false; retires += 1; onRetireContent?.(); },
			restoreContentInput() { input = true; restores += 1; }, focusContent() { client.focus(); }, onDidHide() { hidden += 1; },
		});
		const client = focus.createTarget(control.clientFocusTarget);
		client.commandContext = control.focusTarget;
		client.canFocus = () => input;
		client.bindKeyboard(() => {});
		const layout = () => control.layout(font, measure, measureText);
		const show = (activate = false) => { control.show(activate); layout(); control.update(); };
		return { control, model, client, actions, layout, show, input: () => input, layouts: () => layouts, restores: () => restores,
			retires: () => retires, painted: () => painted, clicked: () => clicked, hidden: () => hidden };
	}
	return { focus, capture, surfaces, workArea, parent, owner, font, window, measurements: () => measurements };
}

test('requested placement survives narrow work areas and collapse preserves expanded dimensions', () => {
	const model = new WorkbenchWindowModel({ left: 170, top: 90, right: 470, bottom: 330 }, 150, 100);
	const area = { left: 0, top: 20, right: 500, bottom: 380 };
	model.arrange(area, 16);
	const requested = { ...model.requestedBounds };
	model.arrange({ left: 0, top: 20, right: 100, bottom: 90 }, 16);
	assert.deepEqual(model.bounds, { left: 0, top: 20, right: 100, bottom: 90 });
	assert.deepEqual(model.requestedBounds, requested);
	model.arrange(area, 16); assert.deepEqual(model.bounds, requested);
	model.setCollapsed(true); model.arrange(area, 16);
	assert.equal(model.bounds.bottom - model.bounds.top, 16);
	assert.equal(model.client.bottom, model.client.top);
	assert.deepEqual(model.requestedBounds, requested);
	model.setCollapsed(false); model.arrange(area, 16); assert.deepEqual(model.bounds, requested);
	assert.equal(model.arrange(area, 16), false);
});

test('two real overlapping windows share paint/hit order but retain independent subjects and lifetimes', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 100, 70);
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	a.show(); b.show();
	assert.equal(f.surfaces.hitTest(140, 120), b.control.clientSurface);
	f.surfaces.hitTest(50, 48)!.handlePointer!(pointer(50, 48, 2, 2), 0);
	assert.equal(f.surfaces.hitTest(140, 120), a.control.clientSurface);
	const { presenter, renderer } = createHostOverlayFixture(500, 400);
	renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame();
	assert.equal(a.painted(), 1); assert.equal(b.painted(), 1);
	assert.equal(a.model.title, 'FIRST'); assert.equal(b.model.title, 'SECOND');
	b.client.focus(); a.control.hide();
	assert.equal(f.focus.target, b.client, 'hiding an unrelated window cannot steal keyboard focus');
	assert.equal(a.control.surface, undefined); assert.equal(a.model.open, false); assert.equal(a.hidden(), 1);
	assert.equal(f.surfaces.hitTest(140, 120), b.control.clientSurface);
});

test('surface retirement returns owned client focus without relying on content cleanup', t => {
	const f = fixture(), a = f.window('RETIRED'), b = f.window('RETAINED', 100, 70);
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	a.show(true); b.show();
	assert.equal(f.focus.target, a.client);
	a.control.surface!.dispose();
	assert.equal(a.control.surface, undefined);
	assert.equal(a.control.clientSurface, undefined);
	assert.equal(a.input(), false);
	assert.equal(f.focus.target, f.parent, 'the window owns focus return when its attachment is retired externally');
	a.show(); b.client.focus();
	a.control.surface!.dispose();
	assert.equal(f.focus.target, b.client, 'retiring a sibling attachment never takes focus back');
});

test('content retirement may transfer focus to a live sibling without a trailing window override', t => {
	const f = fixture();
	const a = f.window('RETIRED', 40, 40, () => b.client.focus()), b = f.window('RETAINED', 100, 70);
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	a.show(true); b.show();
	a.control.detach();
	assert.equal(a.input(), false);
	assert.equal(f.focus.target, b.client);
});

test('window drag and all-edge resize use central capture, root work area and current scope', t => {
	const f = fixture(), a = f.window('DRAG'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const down = pointer(60, 48, 1, 1);
	f.capture.beginRoute(a.control.scope.surfaceScope, down);
	a.control.surface!.handlePointer!(down, 0);
	assert.equal(f.capture.active, true);
	f.parent.focus();
	assert.equal(f.capture.active, true, 'keyboard focus and the established pointer gesture have independent owners');
	f.capture.dispatch({ ...pointer(-100, -100, 1), insideViewport: false }, false, 1, a.control.scope.surfaceScope);
	assert.equal(a.model.bounds.left, 0); assert.equal(a.model.bounds.top, f.workArea.top);
	f.capture.dispatch(pointer(900, 900, 0, 0, 1), false, 2, a.control.scope.surfaceScope);
	assert.equal(a.model.bounds.right, f.workArea.right); assert.equal(a.model.bounds.bottom, f.workArea.bottom);
	assert.equal(f.capture.active, false);
	const start = { ...a.model.bounds };
	const resize = pointer(start.left + 1, start.top + 1, 1, 1);
	f.capture.beginRoute(a.control.scope.surfaceScope, resize); f.surfaces.hitTest(resize.viewportX, resize.viewportY)!.handlePointer!(resize, 3);
	f.capture.dispatch(pointer(start.right + 200, start.bottom + 200, 1), false, 4, a.control.scope.surfaceScope);
	assert.equal(a.model.bounds.right - a.model.bounds.left, a.model.minimumWidth);
	assert.equal(a.model.bounds.bottom - a.model.bounds.top, a.model.minimumHeight);
	f.capture.dispatch(pointer(start.right + 200, start.bottom + 200, 0, 0, 1), false, 5, a.control.scope.surfaceScope);
	const bottomRight = pointer(a.model.bounds.right - 2, a.model.bounds.bottom - 2, 1, 1);
	assert.equal(f.surfaces.hitTest(bottomRight.viewportX, bottomRight.viewportY), a.control.surface, 'the actual client hit region leaves the full resize margin to chrome');
	f.capture.beginRoute(a.control.scope.surfaceScope, bottomRight);
	f.surfaces.hitTest(bottomRight.viewportX, bottomRight.viewportY)!.handlePointer!(bottomRight, 6);
	f.capture.dispatch(pointer(bottomRight.viewportX - 20, bottomRight.viewportY - 20, 0, 0, 1), false, 7, a.control.scope.surfaceScope);
});

test('collapse structurally retires client capture and transients, focuses expand, and preserves the model', t => {
	const f = fixture(), a = f.window('COLLAPSE'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const height = a.model.requestedBounds.bottom - a.model.requestedBounds.top;
	const clientSurface = a.control.clientSurface!;
	let popupRetired = 0, cancelled = 0;
	const popup = f.surfaces.attach({ role: 'transient', outsidePress: 'consume', lifetimeOwner: clientSurface,
		presentationParent: a.control.surface, captureScope: Symbol('client popup'), isVisible: () => true,
		getBounds: () => a.model.client, getClip: () => f.workArea, draw() {}, onRetire() { popupRetired += 1; } });
	const popupFocus = f.focus.createTarget(a.client, new InputFocusScope(popup.captureScope));
	popupFocus.canFocus = () => !popup.retired;
	popupFocus.focus();
	f.capture.beginRoute(a.control.clientScope.surfaceScope, pointer(100, 100, 1, 1));
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('collapse is not a physical release'); }, cancelPointer() { cancelled += 1; } });
	a.control.setCollapsed(true);
	assert.equal(a.control.clientSurface, undefined); assert.equal(clientSurface.retired, true); assert.equal(popup.retired, true);
	assert.equal(popupRetired, 1); assert.equal(cancelled, 1); assert.equal(f.capture.draining, true);
	assert.equal(a.input(), false); assert.equal(a.retires(), 1);
	assert.equal(f.focus.target!.scope, a.control.scope);
	assert.equal(a.actions.items[a.actions.focusedIndex].command, 'window.collapse');
	assert.equal(a.actions.items[a.actions.focusedIndex].label, '+');
	a.control.focusTarget.focus(); f.focus.moveFocus(true);
	assert.equal(f.focus.target, a.control.actionFocusTarget, 'collapsed chrome-only reverse Tab order excludes the retired inspector');
	assert.equal(a.model.requestedBounds.bottom - a.model.requestedBounds.top, height);
	assert.equal(f.surfaces.hitTest(100, 100), f.owner, 'collapsed client no longer excludes the preview below');
	f.parent.focus(); a.control.setCollapsed(false);
	assert.equal(a.input(), true); assert.equal(f.focus.target, f.parent, 'expanding does not seize unrelated focus');
	assert.equal(a.model.bounds.bottom - a.model.bounds.top, height);
	assert.equal(a.control.clientSurface!.retired, false);
});

test('collapsing another window preserves an unrelated gesture; collapsed horizontal resizing retains expanded height', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 200, 70);
	a.show(); b.show();
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	let cancelled = 0;
	f.capture.beginRoute(b.control.clientScope.surfaceScope, pointer(250, 150, 1, 1));
	const unrelated = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled += 1; } };
	f.capture.capture(unrelated);
	a.control.setCollapsed(true);
	assert.equal(f.capture.active, true); assert.equal(cancelled, 0);
	f.capture.release(unrelated); f.capture.endRoute(pointer(250, 150));
	const expandedHeight = a.model.requestedBounds.bottom - a.model.requestedBounds.top;
	const right = a.model.bounds.right, top = a.model.bounds.top;
	const down = pointer(right - 1, top + 7, 1, 1);
	f.capture.beginRoute(a.control.scope.surfaceScope, down); a.control.surface!.handlePointer!(down, 0);
	f.capture.dispatch(pointer(right + 40, top + 7, 1), false, 1, a.control.scope.surfaceScope);
	f.capture.dispatch(pointer(right + 40, top + 7, 0, 0, 1), false, 2, a.control.scope.surfaceScope);
	assert.equal(a.model.requestedBounds.bottom - a.model.requestedBounds.top, expandedHeight);
	assert.equal(a.model.bounds.bottom - a.model.bounds.top, a.model.header.bottom - a.model.header.top);
	assert.equal(a.model.bounds.right - a.model.bounds.left, 281);
});

test('idle frames do no chrome measurement/layout and hide differs from pane detachment', t => {
	const f = fixture(), a = f.window('RETAIN'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const measured = f.measurements(), layouts = a.layouts();
	for (let frame = 0; frame < 100; frame += 1) { a.layout(); a.control.update(); }
	assert.equal(f.measurements(), measured); assert.equal(a.layouts(), layouts);
	a.model.title = 'CHANGED SUBJECT'; a.layout();
	assert.ok(f.measurements() > measured); assert.equal(a.layouts(), layouts, 'title changes do not reformat unchanged content');
	a.model.title = 'World/Actor/VeryLongParentName/VeryLongComponentName/SubjectSuffix'; a.layout();
	assert.ok(a.model.displayTitle.includes('...') && a.model.displayTitle.endsWith('SubjectSuffix'), 'middle truncation retains the identifying subject suffix');
	a.control.detach(); assert.equal(a.control.surface, undefined); assert.equal(a.model.open, true); assert.equal(a.hidden(), 0);
	a.control.attach(); a.layout(); assert.equal(a.control.visible, true); assert.equal(a.restores(), 2);
	a.client.focus(); a.control.focusTarget.focus();
	const escape = new KeyInputEvent('Escape', KeyModifier.none, false, true);
	f.focus.handleKeyboard(escape);
	assert.equal(f.focus.target, f.parent); assert.equal(a.model.open, true); assert.equal(escape.consumed, true);
	a.control.actionFocusTarget.focus();
	const actionEscape = new KeyInputEvent('Escape', KeyModifier.none, false, true);
	f.focus.handleKeyboard(actionEscape);
	assert.equal(f.focus.target, f.parent); assert.equal(a.model.open, true); assert.equal(actionEscape.consumed, true);
	a.control.hide(); assert.equal(a.model.open, false); assert.equal(a.hidden(), 1);
});
