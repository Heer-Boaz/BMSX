import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { create_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../ide/common/constants';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel, type WindowPlacement } from '../../ide/workbench/ui/window/model';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext, placement: WindowPlacement = 'normal', areaWidth = 600, minimumWidth = 120) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService(), font = new Font({ variant: 'tiny' });
	const area = { left: 20, top: 30, right: 20 + areaWidth, bottom: 430 };
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope,
		isVisible: () => true, getBounds: () => area, getClip: () => area, draw() {} });
	const model = new WorkbenchWindowModel({ left: 180, top: 120, right: 420, bottom: 300 }, minimumWidth, 80);
	model.title = 'Window'; model.setPlacement(placement);
	let restores = 0, retires = 0;
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => focus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => focus.executeCommand(command, target),
	};
	const control = new WorkbenchFloatingWindow(focus, capture, hover, surfaces, commands, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: owner, presentationParent: null,
		focusScope: parent.scope, focusReturn: parent, workArea: area, content: { draw() {} }, layoutContent() {},
		retireContentInput() { retires++; }, restoreContentInput() { restores++; }, focusContent() { client.focus(); },
	});
	const client = focus.createTarget(control.clientFocusTarget); client.bindKeyboard(() => {});
	const layout = () => control.layout(font, (text, from, to) => font.measure(text.slice(from, to)), text => font.measure(text));
	control.show(false); layout(); control.update();
	const overlay = createHostOverlayFixture(640, 480), outlines: RectBounds[] = [];
	const outline = api.blit_rect.bind(api);
	t.mock.method(api, 'blit_rect', (...args: Parameters<typeof outline>) => {
		const [left, top, right, bottom] = args; outlines.push({ left, top, right, bottom }); outline(...args);
	});
	const paint = () => {
		outlines.length = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		overlay.queue.consumeOverlayFrame();
		return outlines;
	};
	const dispatch = (x: number, y: number, buttons: number, pressed = 0, released = 0) => {
		const snapshot: PointerInputSnapshot = { viewportX: x, viewportY: y, valid: true, insideViewport: true,
			pressedButtons: buttons, justPressedButtons: pressed, justReleasedButtons: released, modifiers: KeyModifier.none, spaceDown: false };
		const route = capture.routeScope, surface = route === undefined ? surfaces.hitTest(x, y) : surfaces.findByScope(route);
		const scope = surface?.captureScope ?? parent.scope.surfaceScope;
		try {
			if (capture.dispatch(snapshot, false, 0, scope)) return;
			if (surface == null) return;
			capture.beginRoute(scope, snapshot); surface.handlePointer?.(snapshot, 0);
			if (released !== 0) capture.dispatch(snapshot, false, 0, scope);
		} finally { capture.endRoute(snapshot); }
	};
	const title = () => ({ x: model.header.left + (model.header.right - model.header.left) * 0.6,
		y: (model.header.top + model.header.bottom) / 2 });
	t.after(() => { control.dispose(); surfaces.dispose(); focus.setTarget(null); });
	return { focus, capture, surfaces, model, control, client, commands, area, layout, paint, dispatch, title,
		restores: () => restores, retires: () => retires };
}

function hasOutline(outlines: readonly RectBounds[], bounds: Readonly<RectBounds>): boolean {
	return outlines.some(outline => outline.left === bounds.left && outline.top === bounds.top
		&& outline.right === bounds.right && outline.bottom === bounds.bottom);
}

for (const placement of ['left', 'right', 'maximized'] as const) test(`${placement} edge preview is passive and commits only its mode on the physical release`, t => {
	const f = fixture(t), requested = { ...f.model.requestedBounds }, client = f.control.clientSurface!, down = f.title();
	const changes = t.mock.method(f.model, 'setRequestedBounds');
	const point = placement === 'left' ? { x: f.area.left + 1, y: f.area.top + 100 }
		: placement === 'right' ? { x: f.area.right - 1, y: f.area.top + 100 }
			: { x: (f.area.left + f.area.right) / 2, y: f.area.top + 1 };
	f.dispatch(down.x, down.y, PointerButton.Primary, PointerButton.Primary);
	f.dispatch(point.x, point.y, PointerButton.Primary);
	assert.equal(f.model.placement, 'normal'); assert.deepEqual(f.model.requestedBounds, requested); assert.equal(changes.mock.callCount(), 0);
	const expected = create_rect_bounds(); f.model.writePlacementBounds(placement, f.area, expected);
	assert.equal(hasOutline(f.paint(), expected), true, 'the prospective frame advertises the same geometry that release will commit');
	assert.ok(f.surfaces.hitTest((expected.left + expected.right) / 2, (expected.top + expected.bottom) / 2)?.role !== 'feedback');
	f.dispatch(point.x, point.y, 0, 0, PointerButton.Primary);
	assert.equal(f.model.placement, placement); assert.deepEqual(f.model.bounds, expected); assert.deepEqual(f.model.requestedBounds, requested);
	assert.equal(changes.mock.callCount(), 0); assert.ok(f.control.clientSurface === client);
	assert.equal(f.restores(), 1); assert.equal(f.retires(), 0); assert.equal(f.capture.active, false);
	f.commands.execute('window.restore', f.control.focusTarget);
	assert.equal(f.model.placement, 'normal'); assert.deepEqual(f.model.bounds, requested);
});

for (const placement of ['left', 'right', 'maximized'] as const) test(`dragging a ${placement} title stages the normal size under its press anchor and cancel restores canonical presentation`, t => {
	const f = fixture(t, placement), requested = { ...f.model.requestedBounds }, canonical = { ...f.model.bounds }, down = f.title();
	const titleOffsetY = down.y - f.model.header.top, fraction = (down.x - canonical.left) / (canonical.right - canonical.left);
	const point = { x: f.area.left + 350, y: f.area.top + 110 }, changes = t.mock.method(f.model, 'setRequestedBounds');
	f.dispatch(down.x, down.y, PointerButton.Primary, PointerButton.Primary);
	f.dispatch(point.x, point.y, PointerButton.Primary);
	assert.equal(f.model.placement, placement); assert.equal(f.model.arrangedPlacement, 'normal');
	assert.deepEqual(f.model.requestedBounds, requested); assert.equal(changes.mock.callCount(), 0);
	assert.equal(f.model.bounds.right - f.model.bounds.left, requested.right - requested.left);
	assert.equal(f.model.bounds.bottom - f.model.bounds.top, requested.bottom - requested.top);
	assert.equal(f.model.bounds.left, point.x - Math.round((requested.right - requested.left) * fraction));
	assert.equal(f.model.bounds.top, point.y - titleOffsetY);
	f.capture.cancel();
	assert.equal(f.model.placement, placement); assert.equal(f.model.arrangedPlacement, placement);
	assert.deepEqual(f.model.bounds, canonical); assert.deepEqual(f.model.requestedBounds, requested);
	f.dispatch(point.x, point.y, 0, 0, PointerButton.Primary);
	assert.equal(f.capture.draining, false); assert.deepEqual(f.model.bounds, canonical); assert.equal(changes.mock.callCount(), 0);
});

test('free release commits one staged normal placement and title jitter commits nothing', t => {
	const f = fixture(t, 'maximized'), requested = { ...f.model.requestedBounds }, down = f.title();
	const changes = t.mock.method(f.model, 'setRequestedBounds');
	f.dispatch(down.x, down.y, PointerButton.Primary, PointerButton.Primary);
	f.dispatch(down.x + POINTER_DRAG_ACTIVATION_THRESHOLD - 1, down.y, PointerButton.Primary);
	assert.equal(f.model.arrangedPlacement, 'maximized'); assert.deepEqual(f.model.requestedBounds, requested);
	f.dispatch(f.area.left + 350, f.area.top + 110, PointerButton.Primary);
	const draft = { ...f.model.bounds };
	assert.equal(changes.mock.callCount(), 0); assert.equal(f.model.placement, 'maximized');
	f.dispatch(f.area.left + 350, f.area.top + 110, 0, 0, PointerButton.Primary);
	assert.equal(f.model.placement, 'normal'); assert.deepEqual(f.model.bounds, draft); assert.deepEqual(f.model.requestedBounds, draft);
	assert.equal(changes.mock.callCount(), 1);
});

test('release coordinates choose the final snap even when no move event published that edge', t => {
	const f = fixture(t, 'left'), requested = { ...f.model.requestedBounds }, down = f.title();
	f.dispatch(down.x, down.y, PointerButton.Primary, PointerButton.Primary);
	f.dispatch(f.area.left + 1, f.area.top + 100, PointerButton.Primary);
	f.dispatch(f.area.right - 1, f.area.top + 100, 0, 0, PointerButton.Primary);
	assert.equal(f.model.placement, 'right'); assert.deepEqual(f.model.requestedBounds, requested);
	f.commands.execute('window.maximize', f.control.focusTarget); assert.equal(f.model.placement, 'maximized');
	f.commands.execute('window.maximize', f.control.focusTarget); assert.equal(f.model.placement, 'normal');
	assert.deepEqual(f.model.bounds, requested);
});

test('half eligibility suppresses both the actual command and drag preview instead of expanding a half past its minimum', t => {
	const f = fixture(t, 'normal', 210, 160), down = f.title();
	assert.equal(f.commands.isEnabled('window.snapLeft', f.control.focusTarget), false);
	assert.equal(f.commands.isEnabled('window.snapRight', f.control.focusTarget), false);
	f.dispatch(down.x, down.y, PointerButton.Primary, PointerButton.Primary);
	f.dispatch(f.area.left + 1, f.area.top + 100, PointerButton.Primary);
	const half = create_rect_bounds(); f.model.writePlacementBounds('left', f.area, half);
	assert.equal(hasOutline(f.paint(), half), false);
	f.dispatch(f.area.left + 1, f.area.top + 100, 0, 0, PointerButton.Primary);
	assert.equal(f.model.placement, 'normal');
});
