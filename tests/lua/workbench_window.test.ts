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
import { WorkbenchFloatingWindow, type WorkbenchWindowOptions } from '../../ide/workbench/ui/window/control';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { ELLIPSIS } from '../../ide/common/text';
import { drawWorkbenchWindow } from '../../ide/workbench/render/window';
import * as colors from '../../ide/common/constants';
import { WorkbenchTooltip } from '../../ide/workbench/ui/tooltip';

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
	function window(name: string, left = 40, top = 40, onRetireContent?: () => void, getTitleTooltip?: () => string,
		windowOptions: Pick<WorkbenchWindowOptions, 'focusScope' | 'requestClose'> = { focusScope: parent.scope }) {
		const model = new WorkbenchWindowModel({ left, top, right: left + 240, bottom: top + 180 }, 120, 80);
		model.title = name;
		const actions = createWorkbenchActionBar('window.title');
		let input = false, layouts = 0, restores = 0, retires = 0, painted = 0, clicked = 0, hidden = 0;
		const control = new WorkbenchFloatingWindow(focus, capture, hover, surfaces, commands, {
			model, actionBar: actions, lifetimeOwner: owner, ...windowOptions, focusReturn: parent, workArea,
			getTitleTooltip,
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

test('window client and focused chrome publish their actual window commands without parent lookup', t => {
	const f = fixture(), a = f.window('Owned window');
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.show(true); a.control.clientFocusTarget.focus();
	for (const command of ['window.collapse', 'window.hide'] as const)
		assert.equal(a.control.clientFocusTarget.getCommand(command), a.control.focusTarget.getCommand(command));
	f.focus.executeCommand('window.collapse');
	assert.equal(a.model.collapsed, true); assert.equal(f.focus.target, a.control.actionFocusTarget);
	f.focus.executeCommand('window.collapse');
	assert.equal(a.model.collapsed, false, 'the actual focused expand action owns its complete command');
	f.focus.executeCommand('window.hide', a.control.clientFocusTarget);
	assert.equal(a.model.open, false); assert.equal(a.hidden(), 1);
	assert.equal(f.owner.visible, true, 'closing a window does not retire its owning content');
});

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

test('attached window and client borrow the retained root work area through in-place shrink and restoration', t => {
	const f = fixture(), a = f.window('RETAINED AREA', 170, 90); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const area = f.workArea, surface = a.control.surface!, client = a.control.clientSurface!;
	const clientBounds = a.model.client, requestedBounds = a.model.requestedBounds;
	const requested = { ...requestedBounds };
	assert.equal(surface.getClip(), area, 'the window borrows its layout owner, not a copied work-area snapshot');
	assert.equal(surface.getBounds(), a.model.bounds);
	assert.equal(client.getBounds(), clientBounds); assert.equal(client.getClip(), clientBounds);
	assert.equal(f.surfaces.hitTest(200, 120), client);
	area.left = 10; area.top = 30; area.right = 110; area.bottom = 110;
	assert.equal(surface.getClip(), area);
	assert.equal(surface.getClip().right, 110, 'an attached surface observes current clipping before its next arrange');
	assert.equal(f.surfaces.hitTest(200, 120), null, 'the old visible placement cannot hit through the new root clip');
	a.layout();
	assert.equal(a.control.surface, surface); assert.equal(a.control.clientSurface, client);
	assert.equal(surface.retired, false); assert.equal(client.retired, false);
	assert.deepEqual(a.model.bounds, { left: 10, top: 30, right: 110, bottom: 110 });
	assert.equal(a.model.requestedBounds, requestedBounds); assert.deepEqual(requestedBounds, requested);
	assert.equal(client.getBounds(), clientBounds); assert.equal(client.getClip(), clientBounds);
	assert.ok(clientBounds.left >= area.left && clientBounds.top >= area.top
		&& clientBounds.right <= area.right && clientBounds.bottom <= area.bottom);
	assert.equal(f.surfaces.hitTest(50, 70), client);
	area.left = 0; area.top = 20; area.right = 500; area.bottom = 380;
	a.layout();
	assert.equal(a.control.surface, surface); assert.equal(a.control.clientSurface, client);
	assert.equal(surface.getClip(), area); assert.equal(client.getBounds(), clientBounds);
	assert.deepEqual(a.model.bounds, requested); assert.deepEqual(a.model.requestedBounds, requested);
	assert.equal(f.surfaces.hitTest(200, 120), client);
	assert.equal(a.retires(), 0); assert.equal(a.restores(), 1, 'work-area changes arrange the existing client, never reattach it');
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

test('window focus includes lifetime-owned promoted popups, not unrelated controls or paint order', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 100, 70);
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	a.show(); b.show();
	assert.equal(a.control.hasFocus, false);
	a.client.focus();
	assert.equal(a.control.hasFocus, true);
	const popupScope = new InputFocusScope(Symbol('promoted popup'));
	const popup = f.surfaces.attach({ role: 'transient', outsidePress: 'consume', lifetimeOwner: a.control.clientSurface!,
		captureScope: popupScope.surfaceScope, isVisible: () => true,
		getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const popupFocus = f.focus.createTarget(a.client, popupScope);
	popupFocus.focus();
	assert.equal(popup.presentationParent, undefined, 'the popup is promoted outside the window presentation tree');
	assert.equal(a.control.hasFocus, true);
	assert.equal(b.control.hasFocus, false);
	f.surfaces.raise(b.control.surface!);
	assert.equal(a.control.hasFocus, true, 'raising a sibling cannot change the focused family');
	b.client.focus();
	assert.equal(a.control.hasFocus, false);
	assert.equal(b.control.hasFocus, true);
	f.parent.focus();
	assert.equal(b.control.hasFocus, false);
	popup.dispose();
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

test('collapse retires client input and transients while retaining the attached client and descendant surfaces', t => {
	const f = fixture(), a = f.window('COLLAPSE'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const height = a.model.requestedBounds.bottom - a.model.requestedBounds.top;
	const clientSurface = a.control.clientSurface!;
	let descendantRetired = 0, contextRetired = 0;
	const descendant = f.surfaces.attach({ role: 'content', lifetimeOwner: clientSurface, presentationParent: clientSurface,
		captureScope: Symbol('retained descendant'), isVisible: () => true, getBounds: () => a.model.client,
		getClip: () => a.model.client, draw() {}, onRetire() { descendantRetired++; } });
	t.after(a.control.clientScope.onDidRetireContext(() => { contextRetired++; }));
	let popupRetired = 0, cancelled = 0;
	const popup = f.surfaces.attach({ role: 'transient', outsidePress: 'consume', lifetimeOwner: clientSurface,
		presentationParent: a.control.surface, captureScope: Symbol('client popup'), isVisible: () => true,
		getBounds: () => a.model.client, getClip: () => f.workArea, draw() {}, onRetire() { popupRetired += 1; } });
	const popupFocus = f.focus.createTarget(a.client, new InputFocusScope(popup.captureScope));
	popupFocus.canFocus = () => !popup.retired;
	popupFocus.focus();
	f.capture.beginRoute(descendant.captureScope, pointer(100, 100, 1, 1));
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('collapse is not a physical release'); }, cancelPointer() { cancelled += 1; } });
	a.control.setCollapsed(true);
	assert.ok(a.control.clientSurface === clientSurface); assert.equal(clientSurface.retired, false); assert.equal(clientSurface.visible, false);
	assert.equal(descendant.retired, false); assert.equal(descendant.visible, false); assert.equal(descendantRetired, 0);
	assert.equal(contextRetired, 1); assert.equal(popup.retired, true);
	assert.equal(popupRetired, 1); assert.equal(cancelled, 1); assert.equal(f.capture.draining, true);
	assert.equal(a.input(), false); assert.equal(a.retires(), 1);
	assert.equal(f.focus.target!.scope, a.control.scope);
	assert.equal(a.actions.items[a.actions.focusedIndex].command, 'window.collapse');
	assert.equal(a.actions.items[a.actions.focusedIndex].checked, true);
	assert.equal(a.actions.items[a.actions.focusedIndex].checkedIcon, 'expand');
	a.control.focusTarget.focus(); f.focus.moveFocus(true);
	assert.equal(f.focus.target, a.control.actionFocusTarget, 'collapsed chrome-only reverse Tab order excludes the retired inspector');
	assert.equal(a.model.requestedBounds.bottom - a.model.requestedBounds.top, height);
	assert.equal(f.surfaces.hitTest(100, 100), f.owner, 'collapsed client no longer excludes the preview below');
	f.parent.focus(); a.control.setCollapsed(false);
	assert.equal(a.input(), true); assert.equal(f.focus.target, f.parent, 'expanding does not seize unrelated focus');
	assert.equal(a.model.bounds.bottom - a.model.bounds.top, height);
	assert.ok(a.control.clientSurface === clientSurface); assert.equal(clientSurface.visible, true);
	assert.equal(descendant.visible, true); assert.equal(descendantRetired, 0);
	assert.ok(f.surfaces.hitTest(100, 100) === descendant, 'expansion admits the same retained descendant');
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
	assert.ok(a.model.displayTitle.includes(ELLIPSIS) && a.model.displayTitle.endsWith('SubjectSuffix'), 'middle truncation retains the identifying subject suffix');
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

test('window icon tooltips are passive, modal-admitted, retained feedback with no idle measurement', t => {
	const f = fixture(), a = f.window('SUBJECT'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const close = a.actions.items[1];
	a.control.surface!.handlePointer!(pointer((close.bounds.left + close.bounds.right) >> 1,
		(close.bounds.top + close.bounds.bottom) >> 1), 0);
	a.control.update();
	const labels: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', label => { labels.push(label); });
	const { presenter, renderer } = createHostOverlayFixture(500, 400);
	const paint = () => {
		labels.length = 0;
		renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame();
	};
	paint();
	assert.ok(labels.includes('Close Window'), 'the icon exposes the actual command, not a hidden text abbreviation');
	const tipX = close.bounds.right - f.font.measure('Close Window') - 4, tipY = close.bounds.bottom + 5;
	assert.equal(f.surfaces.hitTest(tipX, tipY), a.control.clientSurface, 'tooltip pixels do not intercept underlying client input');
	const measurements = f.measurements();
	for (let frame = 0; frame < 1000; frame++) { a.layout(); a.control.update(); }
	assert.equal(f.measurements(), measurements);
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, presentationParent: null, captureScope: Symbol('modal'), lifetimeOwner: f.owner,
		getBounds: () => f.workArea, getClip: () => f.workArea, isVisible: () => true, draw() {} });
	paint();
	assert.equal(labels.includes('Close Window'), false, 'a blocked window cannot paint its tooltip above a modal');
	modal.dispose();
	a.control.hide(); a.show(); paint();
	assert.equal(labels.includes('Close Window'), false, 'reattachment does not restore stale pointer feedback');
});

test('floating windows share a translucent surface shadow without extending their hit bounds', t => {
	const f = fixture(), a = f.window('SUBJECT'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const fills: number[][] = [];
	t.mock.method(api, 'fill_rect', (...args) => { fills.push(args); });
	t.mock.method(api, 'blit_rect', () => {});
	t.mock.method(api, 'blit_text_inline_with_font', () => {});
	t.mock.method(api, 'pushClipRect', () => {});
	t.mock.method(api, 'popClipRect', () => {});
	drawWorkbenchWindow(a.model, a.actions, true);
	const bounds = a.model.bounds;
	assert.deepEqual(fills[0], [bounds.left + 2, bounds.top + 2, bounds.right + 2, bounds.bottom + 2, 0, colors.COLOR_SURFACE_SHADOW]);
	assert.ok(fills.some(fill => fill[5] === colors.COLOR_WINDOW_HEADER_ACTIVE_BACKGROUND));
	assert.equal(f.surfaces.hitTest(bounds.right + 1, bounds.bottom - 1), f.owner);
	fills.length = 0;
	drawWorkbenchWindow(a.model, a.actions, false);
	assert.ok(fills.some(fill => fill[5] === colors.COLOR_WINDOW_HEADER_INACTIVE_BACKGROUND));
});

test('a compact window caption exposes its full owner-supplied path without spending permanent layout rows', t => {
	const f = fixture(), title = 'CART 0 / nemesis_s.intro / Timelines / logo';
	const a = f.window('logo', 40, 40, undefined, () => title); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const header = a.model.header;
	a.control.surface!.handlePointer!(pointer(header.left + 12, header.top + 7), 0);
	a.control.update();
	const labels: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', label => { labels.push(label); });
	const { presenter, renderer } = createHostOverlayFixture(500, 400);
	const paint = () => {
		labels.length = 0;
		renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame();
	};
	paint();
	assert.ok(labels.includes('logo')); assert.ok(labels.includes(title));
	assert.equal(a.model.header.bottom - a.model.header.top, f.font.lineHeight + 8);
	a.control.onPointerLeave(); a.control.update(); paint();
	assert.equal(labels.includes(title), false);
});

test('font changes reserve stable icon cells and measure the caption only in the remaining title budget', t => {
	const f = fixture(), a = f.window('World/Actor/Component/SubjectSuffix'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.model.setRequestedBounds({ left: 40, top: 40, right: 170, bottom: 180 });
	for (const variant of ['tiny', 'msx', 'tiny'] as const) {
		const font = new Font({ variant });
		a.control.layout(font, (text, from, to) => font.measure(text.slice(from, to)), text => font.measure(text));
		const first = a.actions.items[0].bounds;
		assert.ok(font.measure(a.model.displayTitle) <= first.left - a.model.header.left - 8);
		assert.equal(a.model.header.bottom - a.model.header.top, font.lineHeight + 8);
		assert.equal(a.actions.items[1].bounds.right, a.model.header.right - 3);
		assert.ok(a.actions.items.every(item => item.bounds.left >= a.model.header.left));
	}
});

test('long title tooltips wrap every path glyph instead of moving caption truncation into the hint', t => {
	const f = fixture(), tooltip = new WorkbenchTooltip();
	t.after(() => { tooltip.detach(); f.surfaces.dispose(); });
	const area = { left: 0, top: 20, right: 120, bottom: 180 };
	tooltip.attach(f.surfaces, f.owner, area);
	const title = 'World/ActorWithALongName/ComponentWithALongName/FinalSubjectSuffix';
	const labels: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', label => { labels.push(label); });
	const { presenter, renderer } = createHostOverlayFixture(500, 400);
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new Font({ variant });
		let measurements = 0;
		const measure = (text: string, from: number, to: number) => { measurements++; return font.measure(text.slice(from, to)); };
		const measureText = (text: string) => { measurements++; return font.measure(text); };
		const anchor = { left: 95, top: 160, right: 115, bottom: 175 };
		tooltip.show(title, anchor, font, measure, measureText, area);
		labels.length = 0;
		renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame();
		assert.ok(labels.length > 1);
		assert.equal(labels.join(''), title);
		assert.ok(labels.every(label => font.measure(label) <= area.right - area.left - 8));
		assert.ok(tooltip.bounds.left >= area.left && tooltip.bounds.right <= area.right);
		assert.ok(tooltip.bounds.top >= area.top && tooltip.bounds.bottom <= area.bottom);
		const measured = measurements;
		for (let frame = 0; frame < 1000; frame++) tooltip.show(title, anchor, font, measure, measureText, area);
		assert.equal(measurements, measured);
		anchor.left -= 10; anchor.right -= 10;
		tooltip.show(title, anchor, font, measure, measureText, area);
		assert.equal(measurements, measured, 'moving an anchor only places retained lines; it does not wrap the title again');
	}
});


test('restored collapsed attachments publish a retained client without restoring client input', t => {
	const f = fixture(), a = f.window('RESTORED');
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.model.setCollapsed(true); a.show();
	const client = a.control.clientSurface!;
	assert.ok(client !== undefined); assert.equal(client.visible, false); assert.equal(client.retired, false);
	assert.equal(a.input(), false); assert.equal(a.restores(), 0); assert.equal(a.retires(), 0);
	const descendant = f.surfaces.attach({ role: 'content', lifetimeOwner: client, presentationParent: client,
		captureScope: Symbol('restored group'), isVisible: () => true, getBounds: () => a.model.client,
		getClip: () => a.model.client, draw() {} });
	assert.equal(descendant.visible, false);
	a.control.setCollapsed(false);
	assert.ok(a.control.clientSurface === client); assert.equal(descendant.visible, true);
	assert.equal(a.restores(), 1); assert.equal(a.input(), true); assert.ok(a.layouts() > 0);
});

test('window ownership ancestry is independent of focus return and close admission leaves presentation attached', t => {
	const f = fixture(), ownerScope = new InputFocusScope(Symbol('document parent'), f.focus.workbenchScope);
	const ownCommands: EditorCommandRunner = { isEnabled: () => false, execute() {} };
	ownerScope.commands = ownCommands;
	let closeRequests = 0;
	const a = f.window('DOCUMENT', 40, 40, undefined, undefined,
		{ focusScope: ownerScope, requestClose() { closeRequests++; } });
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.show(true);
	assert.ok(f.focus.commandRunner === ownCommands, 'client commands follow the declared logical owner, not the return target');
	f.focus.executeCommand('window.hide', a.control.clientFocusTarget);
	assert.equal(closeRequests, 1); assert.equal(a.model.open, true); assert.equal(a.hidden(), 0);
	assert.equal(a.control.visible, true); assert.equal(a.input(), true);
	const escape = new KeyInputEvent('Escape', KeyModifier.none, false, true);
	a.control.focusTarget.focus(); f.focus.handleKeyboard(escape);
	assert.ok(f.focus.target === f.parent, 'Escape still returns to the explicitly supplied control');
	a.control.hide();
	assert.equal(closeRequests, 1); assert.equal(a.model.open, false); assert.equal(a.hidden(), 1);
});

test('placement notifications publish requested placement and collapse, not passive arrangement or chrome updates', () => {
	const bounds = { left: 40, top: 40, right: 280, bottom: 220 };
	const model = new WorkbenchWindowModel(bounds, 120, 80), changes: boolean[] = [];
	const unbind = model.onDidChangePlacement(() => changes.push(model.collapsed));
	model.setRequestedBounds(bounds); model.setCollapsed(false);
	model.arrange({ left: 0, top: 20, right: 500, bottom: 380 }, 16);
	model.title = 'CHROME'; model.invalidate(); model.setMinimumSize(140, 90);
	assert.deepEqual(changes, []);
	model.setRequestedBounds({ left: 60, top: 50, right: 300, bottom: 230 });
	model.setCollapsed(true); model.setCollapsed(true);
	model.arrange({ left: 0, top: 20, right: 100, bottom: 90 }, 16);
	assert.deepEqual(changes, [false, true]);
	unbind(); model.setCollapsed(false);
	assert.deepEqual(changes, [false, true]);
});
