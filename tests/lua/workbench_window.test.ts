import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createWorkbenchActionBar, WORKBENCH_ACTION_BAR_ITEM_SPACING } from '../../ide/workbench/ui/action_bar';
import { WorkbenchWindowModel, type WindowPlacement } from '../../ide/workbench/ui/window/model';
import { findWorkbenchWindowSurface, minimizedWorkbenchWindowCount, workbenchWindowForSurface, WorkbenchFloatingWindow, type WorkbenchWindowOptions } from '../../ide/workbench/ui/window/control';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { ELLIPSIS } from '../../ide/common/text';
import { drawWorkbenchWindow } from '../../ide/workbench/render/window';
import * as colors from '../../ide/common/constants';
import { WorkbenchTooltip } from '../../ide/workbench/ui/tooltip';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';

const pointer = (x: number, y: number, buttons = 0, pressed = 0, released = 0): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: buttons, justPressedButtons: pressed, justReleasedButtons: released, modifiers: KeyModifier.none, spaceDown: false,
});

function fixture() {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService();
	const workArea = { left: 0, top: 20, right: 500, bottom: 380 };
	const contextMenu = new ContextMenuController(focus, capture, workArea);
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, isVisible: () => true,
		getBounds: () => workArea, getClip: () => workArea, draw() {}, onRetire: () => contextMenu.dispose() });
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string, from: number, to: number) => { measurements += 1; return font.measure(text.slice(from, to)); };
	const measureText = (text: string) => { measurements += 1; return font.measure(text); };
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => focus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => focus.executeCommand(command, target),
	};
	function window(name: string, left = 40, top = 40, onRetireContent?: () => void, getTitleTooltip?: () => string,
		windowOptions: Pick<WorkbenchWindowOptions, 'focusScope' | 'requestClose' | 'requestMinimize'>
			& Partial<Pick<WorkbenchWindowOptions, 'lifetimeOwner' | 'presentationParent' | 'contextMenu'>> = { focusScope: parent.scope },
		actions = createWorkbenchActionBar(windowOptions.requestMinimize === undefined ? 'window.title' : 'window.minimizable.title')) {
		const model = new WorkbenchWindowModel({ left, top, right: left + 240, bottom: top + 180 }, 120, 80);
		model.title = name;
		let input = false, layouts = 0, restores = 0, retires = 0, painted = 0, clicked = 0, hidden = 0;
		const control = new WorkbenchFloatingWindow(focus, capture, hover, surfaces, commands, contextMenu, {
			model, actionBar: actions, lifetimeOwner: owner, presentationParent: null, ...windowOptions, focusReturn: parent, workArea,
			getTitleTooltip,
			content: { draw() { painted += 1; }, handlePointer(snapshot) {
				clicked += 1;
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) client.focus();
			} },
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
	// Exercise the real surface hit target and held route, including a release delivered
	// in the same occurrence as a press. No test calls a window's gesture implementation.
	const dispatch = (snapshot: PointerInputSnapshot, now: number) => {
		const route = capture.routeScope;
		const surface = route === undefined ? surfaces.hitTest(snapshot.viewportX, snapshot.viewportY) : surfaces.findByScope(route);
		const scope = surface?.captureScope ?? parent.scope.surfaceScope;
		try {
			if (capture.dispatch(snapshot, false, now, scope)) return;
			if (surface == null) return;
			capture.beginRoute(scope, snapshot);
			surface.handlePointer?.(snapshot, now);
			if (snapshot.justReleasedButtons !== 0) capture.dispatch(snapshot, false, now, scope);
		} finally { capture.endRoute(snapshot); }
	};
	const click = (x: number, y: number, now: number, button = PointerButton.Primary) => {
		dispatch(pointer(x, y, button, button), now);
		dispatch(pointer(x, y, 0, 0, button), now + 1);
	};
	return { focus, capture, surfaces, contextMenu, workArea, parent, owner, font, window, dispatch, click, measurements: () => measurements };
}

function titlePoint(model: WorkbenchWindowModel) {
	return { x: model.header.left + 16, y: (model.header.top + model.header.bottom) / 2 };
}

test('reset requests owner defaults without retiring body input or a sibling capture', t => {
	const f = fixture(), a = f.window('RESET'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const generation = a.control.clientScope.contextGeneration, retires = a.retires(), restores = a.restores();
	const down = pointer(400, 300, PointerButton.Primary, PointerButton.Primary);
	let cancelled = 0;
	const body = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	f.capture.beginRoute(a.control.clientScope.surfaceScope, down);
	f.capture.capture(body, PointerButton.Primary, a.control.clientScope.surfaceScope);
	a.control.resetPlacement();
	assert.equal(a.model.placementInitialized, false); assert.equal(a.model.open, true);
	assert.ok(f.focus.target === a.client); assert.equal(a.input(), true);
	assert.equal(a.retires(), retires); assert.equal(a.restores(), restores);
	assert.equal(a.control.clientScope.contextGeneration, generation); assert.equal(f.capture.active, true); assert.equal(cancelled, 0);
});

for (const gesture of ['title', 'button'] as const) test(`reset cancels a held ${gesture} gesture before its later release`, t => {
	const f = fixture(), a = f.window('RESET'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model);
	if (gesture === 'button') {
		const bounds = a.actions.items.find(item => item.command === 'window.hide')!.bounds;
		point.x = (bounds.left + bounds.right) / 2; point.y = (bounds.top + bounds.bottom) / 2;
	}
	f.dispatch(pointer(point.x, point.y, PointerButton.Primary, PointerButton.Primary), 0);
	if (gesture === 'title') f.dispatch(pointer(point.x + 20, point.y + 10, PointerButton.Primary), 1);
	a.control.resetPlacement();
	assert.equal(a.model.placementInitialized, false); assert.equal(f.capture.active, false); assert.equal(f.capture.draining, true);
	f.dispatch(pointer(point.x + 20, point.y + 10, 0, 0, PointerButton.Primary), 2);
	assert.equal(a.model.open, true); assert.equal(a.model.placementInitialized, false); assert.equal(f.capture.draining, false);
});

test('reset ends prospective keyboard placement without accepting its later Enter', t => {
	const f = fixture(), a = f.window('RESET'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.control.focusTarget.focus(); f.focus.executeCommand('window.move', a.control.focusTarget);
	f.focus.handleKeyboard(new KeyInputEvent('ArrowRight', KeyModifier.none));
	assert.equal(a.control.interactionActive, true);
	a.control.resetPlacement();
	assert.equal(a.control.interactionActive, false); assert.equal(a.model.placementInitialized, false);
	f.focus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	assert.equal(a.model.placementInitialized, false); assert.equal(a.model.open, true);
});

test('window identity follows moved native controls without borrowing their semantic Main ancestry', t => {
	const f = fixture(), a = f.window('ACTIVITY'); a.show();
	const semanticScope = new InputFocusScope(Symbol('retained activity'), f.parent.scope);
	const retained = f.surfaces.attach({ role: 'content', captureScope: semanticScope.surfaceScope, lifetimeOwner: f.owner,
		presentationParent: f.owner, isVisible: () => true, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const target = f.focus.createTarget(f.parent, semanticScope); target.bindKeyboard(() => {});
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	assert.equal(findWorkbenchWindowSurface(f.parent, f.surfaces), undefined);
	assert.equal(findWorkbenchWindowSurface(null, f.surfaces), undefined);
	assert.equal(findWorkbenchWindowSurface(target, f.surfaces), undefined);
	assert.equal(workbenchWindowForSurface(a.control.surface!), a.control);
	target.focus(); const revision = f.focus.revision;
	f.surfaces.reparent(retained, a.control.clientSurface!);
	assert.equal(findWorkbenchWindowSurface(target, f.surfaces), a.control.surface); assert.equal(a.control.hasFocus, true);
	assert.equal(f.focus.target, target); assert.equal(f.focus.revision, revision);
	assert.equal(semanticScope.commandParent, f.parent.scope);
	const popup = f.surfaces.attach({ role: 'transient', outsidePress: 'consume', captureScope: Symbol('promoted activity popup'),
		lifetimeOwner: retained, isVisible: () => true, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const popupTarget = f.focus.createTarget(target, new InputFocusScope(popup.captureScope)); popupTarget.commandContext = target;
	popupTarget.focus(); assert.equal(a.control.hasFocus, true); assert.equal(findWorkbenchWindowSurface(popupTarget, f.surfaces), a.control.surface);
	f.surfaces.reparent(retained, f.owner);
	assert.equal(a.control.hasFocus, false); assert.equal(findWorkbenchWindowSurface(popupTarget, f.surfaces), undefined);
	a.control.hide(); assert.equal(retained.retired, false); assert.equal(popup.retired, false);
	retained.dispose(); assert.equal(findWorkbenchWindowSurface(target, f.surfaces), null); assert.equal(findWorkbenchWindowSurface(popupTarget, f.surfaces), null);
});

test('native window discovery follows the invoking control and promoted popup owner rather than their shared semantic context', t => {
	const f = fixture(), a = f.window('ACTUAL'), b = f.window('PAINT CONTEXT', 100, 80);
	a.show(); b.show();
	const scope = new InputFocusScope(Symbol('native region'), f.parent.scope);
	const region = f.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, lifetimeOwner: f.owner,
		presentationParent: a.control.clientSurface!, isVisible: () => true, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const target = f.focus.createTarget(f.parent, scope); target.commandContext = f.parent;
	const popup = f.surfaces.attach({ role: 'transient', outsidePress: 'consume', captureScope: Symbol('promoted region popup'),
		lifetimeOwner: region, presentationParent: b.control.clientSurface!, isVisible: () => true,
		getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const popupTarget = f.focus.createTarget(target, new InputFocusScope(popup.captureScope)); popupTarget.commandContext = f.parent;
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	assert.ok(findWorkbenchWindowSurface(target, f.surfaces) === a.control.surface);
	assert.ok(findWorkbenchWindowSurface(popupTarget, f.surfaces) === a.control.surface);
	assert.equal(f.surfaces.isInWindowFamily(popup.captureScope, a.control.surface!.captureScope), true);
	assert.equal(f.surfaces.isInWindowFamily(popup.captureScope, b.control.surface!.captureScope), false);
	f.surfaces.reparent(region, b.control.clientSurface!);
	assert.ok(findWorkbenchWindowSurface(target, f.surfaces) === b.control.surface);
	assert.ok(findWorkbenchWindowSurface(popupTarget, f.surfaces) === b.control.surface);
	region.dispose();
	assert.ok(findWorkbenchWindowSurface(target, f.surfaces) === null);
	assert.ok(findWorkbenchWindowSurface(popupTarget, f.surfaces) === null);
});

test('retiring presentation ancestry cannot lend its still-registered child a surviving window', t => {
	const f = fixture(); let checked = 0;
	const a = f.window('RETIRING', 40, 40, () => {
		assert.equal(retained.retired, false);
		assert.equal(f.surfaces.findByScope(scope.surfaceScope), retained);
		assert.equal(findWorkbenchWindowSurface(target, f.surfaces), null);
		checked++;
	});
	a.show();
	const scope = new InputFocusScope(Symbol('retiring child'), f.parent.scope);
	const retained = f.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, lifetimeOwner: f.owner,
		presentationParent: a.control.clientSurface!, isVisible: () => true, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const target = f.focus.createTarget(f.parent, scope); target.bindKeyboard(() => {});
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	assert.equal(findWorkbenchWindowSurface(target, f.surfaces), a.control.surface);
	a.control.detach(); assert.equal(checked, 1); assert.equal(retained.retired, true);
	assert.equal(findWorkbenchWindowSurface(target, f.surfaces), null);
});

test('physical window discovery separates provisional construction, minimized presentation and native detachment', t => {
	const f = fixture(), a = f.window('PROVISIONAL');
	a.model.open = true; a.control.setPresented(false); a.control.attach();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const surface = a.control.surface!;
	assert.equal(a.control.isOpen, false); assert.equal(workbenchWindowForSurface(surface), a.control);
	assert.ok(f.surfaces.windowSurfaces.includes(surface));
	a.model.setMinimized(true); assert.equal(minimizedWorkbenchWindowCount(f.surfaces), 0);
	a.control.setPresented(true); assert.equal(a.control.isOpen, true);
	a.control.minimize(); assert.equal(a.control.visible, false); assert.equal(a.control.isOpen, true);
	assert.equal(minimizedWorkbenchWindowCount(f.surfaces), 1);
	assert.equal(a.control.surface, surface); assert.ok(f.surfaces.windowSurfaces.includes(surface));
	a.control.detach(); assert.equal(a.control.isOpen, false); assert.equal(workbenchWindowForSurface(surface), undefined);
	assert.equal(minimizedWorkbenchWindowCount(f.surfaces), 0);
	assert.equal(f.surfaces.windowSurfaces.includes(surface), false);
	a.control.attach(); assert.equal(a.control.isOpen, true); assert.notEqual(a.control.surface, surface);
	assert.equal(workbenchWindowForSurface(surface), undefined, 'a retired attachment cannot borrow its replacement');
	assert.equal(findWorkbenchWindowSurface(a.control.clientFocusTarget, f.surfaces), a.control.surface);
});

test('native window lookup distinguishes retained unframed Main controls from neutral root chrome', t => {
	const f = fixture(), mainScope = new InputFocusScope(Symbol('main'), f.parent.scope);
	const main = f.surfaces.attach({ role: 'window', lifetimeOwner: f.owner, presentationParent: null,
		captureScope: mainScope.surfaceScope, isVisible: () => true, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const scope = new InputFocusScope(Symbol('hidden retained activity'), mainScope);
	const content = f.surfaces.attach({ role: 'content', lifetimeOwner: main, presentationParent: main,
		captureScope: scope.surfaceScope, isVisible: () => false, getBounds: () => f.workArea, getClip: () => f.workArea, draw() {} });
	const target = f.focus.createTarget(f.parent, scope);
	t.after(() => f.surfaces.dispose());
	assert.equal(findWorkbenchWindowSurface(target, f.surfaces), main);
	assert.equal(workbenchWindowForSurface(main), undefined, 'unframed Main has no floating chrome controller');
	assert.equal(findWorkbenchWindowSurface(f.parent, f.surfaces), undefined, 'neutral root chrome has no native window');
	content.dispose(); assert.equal(findWorkbenchWindowSurface(target, f.surfaces), null);
});

test('shared window chrome contributes a cached font-aware minimum to zero-width document and tool content', t => {
	const f = fixture(), menu = new WorkbenchMenu([
		{ type: 'command', command: 'window.maximize', icon: 'maximize', showLabel: true },
		{ type: 'command', command: 'window.hide', icon: 'close' },
	], undefined);
	menu.refresh();
	const a = f.window('CHROME CAPTION', 40, 40, undefined, undefined, { focusScope: f.parent.scope }, createWorkbenchActionBar(menu));
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.model.setMinimumSize(0, 0);
	a.model.setRequestedBounds({ left: 40, top: 40, right: 41, bottom: 100 });
	a.show();
	const tinyMinimum = a.model.minimumWidth;
	assert.ok(tinyMinimum > 0);
	// Exact widths specify intrinsic chrome allocation, not incidental screen placement.
	assert.equal(a.model.bounds.right - a.model.bounds.left, tinyMinimum);
	const actions = a.actions.items.filter(item => item.visible);
	assert.equal(tinyMinimum, actions.reduce((width, item) => width + item.width, 0)
		+ (actions.length - 1) * WORKBENCH_ACTION_BAR_ITEM_SPACING + f.font.measure(ELLIPSIS) + 11);
	const measurements = f.measurements(); a.layout(); a.layout();
	assert.equal(f.measurements(), measurements, 'unchanged frames do not measure the caption cell or labels again');
	const halfArea = { ...f.workArea, right: f.workArea.left + tinyMinimum * 2 };
	assert.equal(a.model.canPlace('left', halfArea), true);
	const msx = new Font({ variant: 'msx' });
	a.control.layout(msx, (text, from, to) => msx.measure(text.slice(from, to)), text => msx.measure(text));
	assert.ok(a.model.minimumWidth > tinyMinimum);
	assert.equal(a.model.canPlace('left', halfArea), false, 'snap admission uses the actual new-font shell minimum');
	assert.equal(a.model.bounds.right - a.model.bounds.left, a.model.minimumWidth);
	a.model.setMinimumSize(0, 0);
	assert.ok(a.model.minimumWidth > tinyMinimum, 'a content minimum cannot overwrite its native chrome contribution');
});

test('window title uses its contributed menu with the actual native window command subject', t => {
	const f = fixture();
	const a = f.window('CONTRIBUTED', 40, 40, undefined, undefined, { focusScope: f.parent.scope,
		contextMenu: [{ type: 'command', command: 'window.hide' }] });
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.show();
	const point = titlePoint(a.model); f.click(point.x, point.y, 0, PointerButton.Secondary);
	assert.equal(f.contextMenu.visible, true); assert.equal(f.contextMenu.invocationOrigin, a.control.focusTarget);
	assert.deepEqual(f.contextMenu.model.rows.map(row => row.command), ['window.hide']);
	f.contextMenu.model.selectedIndex = 0; f.contextMenu.accept();
	assert.equal(a.model.open, false); assert.equal(a.control.isOpen, false);
});

test('window client and focused chrome publish their actual window commands without parent lookup', t => {
	const f = fixture(), a = f.window('Owned window');
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.show(true); a.control.clientFocusTarget.focus();
	for (const command of ['window.maximize', 'window.hide'] as const)
		assert.equal(a.control.clientFocusTarget.getCommand(command), a.control.focusTarget.getCommand(command));
	f.focus.executeCommand('window.hide', a.control.clientFocusTarget);
	assert.equal(a.model.open, false); assert.equal(a.hidden(), 1);
	assert.equal(f.owner.visible, true, 'closing a window does not retire its owning content');
});

test('minimize is admitted only by the concrete window owner and its title action retains the editor input', t => {
	const f = fixture();
	let requests = 0;
	const document = f.window('DOCUMENT', 40, 40, undefined, undefined, {
		focusScope: f.parent.scope, requestMinimize() { requests++; document.control.minimize(); f.parent.focus(); },
	});
	const tool = f.window('TOOL', 260, 80);
	t.after(() => { document.control.dispose(); tool.control.dispose(); f.surfaces.dispose(); });
	document.show(true); tool.show();
	assert.equal(tool.actions.items.some(item => item.command === 'window.minimize'), false, 'a utility title does not produce an unsupported action');
	assert.equal(f.focus.getCommand('window.minimize', tool.control.clientFocusTarget)?.isEnabled() === true, false);
	f.focus.executeCommand('window.minimize', tool.control.clientFocusTarget);
	assert.equal(tool.model.minimized, false); assert.equal(requests, 0);
	const client = document.control.clientSurface!, requested = { ...document.model.requestedBounds };
	document.control.setPlacement('maximized'); document.control.update();
	const action = document.actions.items.find(item => item.command === 'window.minimize')!;
	assert.equal(action.visible, true);
	f.click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2, 10);
	assert.equal(requests, 1); assert.equal(document.model.minimized, true); assert.equal(document.model.placement, 'maximized');
	assert.equal(document.model.open, true); assert.equal(document.hidden(), 0); assert.equal(document.retires(), 0);
	assert.ok(document.control.clientSurface === client); assert.equal(client.retired, false); assert.equal(client.visible, false);
	assert.equal(document.input(), true); assert.ok(f.focus.target === f.parent);
	document.show();
	assert.equal(document.model.minimized, false); assert.equal(document.model.placement, 'maximized');
	assert.deepEqual(document.model.requestedBounds, requested); assert.deepEqual(document.model.bounds, f.workArea);
	assert.ok(document.control.clientSurface === client); assert.equal(document.restores(), 1);
});

test('maximized placement fills the work area without replacing normal requested placement', () => {
	const requested = { left: 170, top: 90, right: 470, bottom: 330 };
	const model = new WorkbenchWindowModel(requested, 150, 100);
	const area = { left: 10, top: 20, right: 500, bottom: 380 };
	const retainedRequested = model.requestedBounds;
	model.setPlacement('maximized'); model.arrange(area, 16);
	assert.deepEqual(model.bounds, area);
	assert.equal(model.requestedBounds, retainedRequested); assert.deepEqual(model.requestedBounds, requested);
	assert.equal(model.resizeEdgeAt(area.left, area.top), 0);
	assert.equal(model.resizeEdgeAt(area.right - 1, area.bottom - 1), 0);
	assert.equal(model.arrange(area, 16), false);
	area.left = 30; area.top = 40; area.right = 130; area.bottom = 110;
	model.arrange(area, 16);
	assert.deepEqual(model.bounds, area); assert.deepEqual(model.requestedBounds, requested);
	area.left = 10; area.top = 20; area.right = 500; area.bottom = 380;
	model.arrange(area, 16); model.setPlacement('normal'); model.arrange(area, 16);
	assert.deepEqual(model.bounds, requested); assert.deepEqual(model.requestedBounds, requested);
	assert.equal(model.arrange(area, 16), false);
});

test('focused maximize and restore commands preserve the retained client', t => {
	const f = fixture(), a = f.window('MAXIMIZE'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const client = a.control.clientSurface!, requested = { ...a.model.requestedBounds };
	f.focus.executeCommand('window.maximize', a.control.clientFocusTarget);
	assert.equal(a.model.placement, 'maximized'); assert.deepEqual(a.model.bounds, f.workArea);
	assert.equal(a.control.clientSurface, client); assert.equal(a.retires(), 0); assert.equal(a.restores(), 1);
	assert.equal(f.focus.target, a.client);
	const maximize = a.actions.items.find(item => item.command === 'window.maximize')!;
	assert.equal(maximize.checked, true); assert.equal(maximize.checkedIcon, 'restore');
	f.focus.executeCommand('window.maximize', a.control.actionFocusTarget);
	assert.equal(a.model.placement, 'normal');
	assert.deepEqual(a.model.bounds, requested); assert.equal(maximize.checked, false);
	assert.equal(a.control.clientSurface, client); assert.equal(client.visible, true);
	f.focus.executeCommand('window.maximize', a.control.focusTarget);
	assert.equal(a.model.placement, 'maximized');
	assert.deepEqual(a.model.bounds, f.workArea); assert.deepEqual(a.model.requestedBounds, requested);
	a.control.update();
	const measured = f.measurements(), layouts = a.layouts();
	for (let frame = 0; frame < 100; frame++) { a.layout(); a.control.update(); }
	assert.equal(f.measurements(), measured); assert.equal(a.layouts(), layouts);
});

test('maximize and restore cancel held chrome moves and resizes without committing the remainder of the gesture', t => {
	const f = fixture(), a = f.window('GESTURE'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	for (const resize of [false, true]) {
		const bounds = a.model.bounds;
		const down = resize ? pointer(bounds.left + 1, bounds.top + 1, 1, 1) : pointer(bounds.left + 12, bounds.top + 7, 1, 1);
		f.capture.beginRoute(a.control.scope.surfaceScope, down); a.control.surface!.handlePointer!(down, 0);
		assert.equal(f.capture.active, true);
		f.capture.dispatch(pointer(down.viewportX + 10, down.viewportY + 10, 1), false, 1, a.control.scope.surfaceScope);
		const requested = { ...a.model.requestedBounds };
		f.focus.executeCommand('window.maximize', a.control.focusTarget);
		assert.equal(f.capture.active, false); assert.equal(f.capture.draining, true);
		f.capture.dispatch(pointer(down.viewportX + 40, down.viewportY + 40, 0, 0, 1), false, 2, a.control.scope.surfaceScope);
		assert.equal(f.capture.draining, false); assert.deepEqual(a.model.requestedBounds, requested);
		f.focus.executeCommand('window.maximize', a.control.focusTarget);
		assert.deepEqual(a.model.bounds, requested);
	}
});

test('a maximized title drag presents an uncommitted normal window and cancellation retains placement intent', t => {
	const f = fixture(), a = f.window('DRAG'); a.show(); a.control.setPlacement('maximized');
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const requested = { ...a.model.requestedBounds }, point = titlePoint(a.model);
	f.dispatch(pointer(point.x, point.y, 1, 1), 0);
	f.dispatch(pointer(point.x + 50, point.y + 50, 1), 1);
	assert.equal(f.capture.active, true);
	assert.equal(a.model.placement, 'maximized'); assert.equal(a.model.arrangedPlacement, 'normal');
	assert.deepEqual(a.model.requestedBounds, requested);
	f.capture.cancel();
	assert.equal(a.model.placement, 'maximized'); assert.equal(a.model.arrangedPlacement, 'maximized');
	assert.deepEqual(a.model.bounds, f.workArea); assert.deepEqual(a.model.requestedBounds, requested);
});

test('complete title click pairs maximize and restore at event time zero while retaining clients and normal placement', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 260, 80); a.show(); b.show();
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	const requested = { ...a.model.requestedBounds }, siblingRequested = { ...b.model.requestedBounds };
	const surface = a.control.clientSurface!, sibling = b.control.clientSurface!;
	const writes = t.mock.method(a.model, 'setRequestedBounds');
	let point = titlePoint(a.model);
	f.click(point.x, point.y, 0);
	assert.equal(a.model.placement, 'normal', 'one complete click cannot maximize');
	f.dispatch(pointer(point.x, point.y, 1, 1), 100);
	assert.equal(a.model.placement, 'normal', 'the second press alone is not a complete click');
	f.dispatch(pointer(point.x, point.y, 0, 0, 1), 101);
	assert.equal(a.model.placement, 'maximized'); assert.deepEqual(a.model.bounds, f.workArea);
	point = titlePoint(a.model);
	f.click(point.x, point.y, 200); assert.equal(a.model.placement, 'maximized');
	f.click(point.x, point.y, 300); assert.equal(a.model.placement, 'normal');
	assert.deepEqual(a.model.bounds, requested); assert.deepEqual(a.model.requestedBounds, requested);
	assert.deepEqual(b.model.requestedBounds, siblingRequested); assert.equal(b.model.placement, 'normal');
	assert.ok(a.control.clientSurface === surface); assert.ok(b.control.clientSurface === sibling);
	assert.equal(a.retires(), 0); assert.equal(b.retires(), 0); assert.equal(a.restores(), 1); assert.equal(b.restores(), 1);
	assert.equal(writes.mock.callCount(), 0, 'title clicks never write normal requested placement');
});

test('complete title clicks coalesced into single pointer occurrences still form a pair without placement writes', t => {
	const f = fixture(), a = f.window('SHORT CLICKS'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model), requested = { ...a.model.requestedBounds };
	const writes = t.mock.method(a.model, 'setRequestedBounds');
	f.dispatch(pointer(point.x, point.y, 0, PointerButton.Primary, PointerButton.Primary), 0);
	assert.equal(a.model.placement, 'normal'); assert.equal(f.capture.active, false);
	f.dispatch(pointer(point.x, point.y, 0, PointerButton.Primary, PointerButton.Primary), 100);
	assert.equal(a.model.placement, 'maximized'); assert.equal(f.capture.active, false);
	assert.deepEqual(a.model.requestedBounds, requested); assert.equal(writes.mock.callCount(), 0);
});

test('sub-threshold title jitter completes clicks without placement writes or client layout work', t => {
	const f = fixture(), a = f.window('JITTER'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model), delta = colors.POINTER_DRAG_ACTIVATION_THRESHOLD - 1;
	const requested = { ...a.model.requestedBounds }, layouts = a.layouts();
	const writes = t.mock.method(a.model, 'setRequestedBounds');
	f.dispatch(pointer(point.x, point.y, 1, 1), 0);
	f.dispatch(pointer(point.x + delta, point.y, 1), 1);
	f.dispatch(pointer(point.x + delta, point.y, 0, 0, 1), 2);
	assert.equal(a.model.placement, 'normal'); assert.deepEqual(a.model.requestedBounds, requested);
	assert.equal(writes.mock.callCount(), 0); assert.equal(a.layouts(), layouts);
	f.click(point.x + delta, point.y, 100);
	assert.equal(a.model.placement, 'maximized'); assert.equal(writes.mock.callCount(), 0);
});

test('title clicks require nearby press origins even within the double-click interval', t => {
	const f = fixture(), a = f.window('DISTANCE'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model), distance = colors.POINTER_DRAG_ACTIVATION_THRESHOLD;
	f.click(point.x, point.y, 0);
	f.click(point.x + distance, point.y, 100);
	assert.equal(a.model.placement, 'normal');
	f.click(point.x + distance, point.y, 200);
	assert.equal(a.model.placement, 'maximized', 'the distant click starts a new local pair');
});

test('a long first title hold cannot make a late second press into a double-click', t => {
	const f = fixture(), a = f.window('EVENT TIME'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model), afterInterval = colors.DOUBLE_CLICK_MAX_INTERVAL_MS + 1;
	f.dispatch(pointer(point.x, point.y, 1, 1), 0);
	f.dispatch(pointer(point.x, point.y, 0, 0, 1), afterInterval);
	f.click(point.x, point.y, afterInterval + 1);
	assert.equal(a.model.placement, 'normal', 'the interval is between physical press times, not release times');
	f.click(point.x, point.y, afterInterval + 100);
	assert.equal(a.model.placement, 'maximized');
});

for (const coalesced of [false, true]) test(`title drag invalidates click history with ${coalesced ? 'release-only movement' : 'movement away and back'}`, t => {
	const f = fixture(), a = f.window('DRAG'); a.show();
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	const point = titlePoint(a.model), requested = { ...a.model.requestedBounds };
	const delta = colors.POINTER_DRAG_ACTIVATION_THRESHOLD;
	f.click(point.x, point.y, 0);
	f.dispatch(pointer(point.x, point.y, 1, 1), 100);
	if (coalesced) f.dispatch(pointer(point.x + delta, point.y, 0, 0, 1), 101);
	else {
		f.dispatch(pointer(point.x + delta, point.y, 1), 101);
		assert.equal(a.model.bounds.left, requested.left + delta);
		assert.deepEqual(a.model.requestedBounds, requested, 'held motion is presentation, not a committed placement');
		f.dispatch(pointer(point.x, point.y, 1), 102);
		f.dispatch(pointer(point.x, point.y, 0, 0, 1), 103);
	}
	assert.equal(a.model.placement, 'normal');
	assert.equal(a.model.requestedBounds.left, requested.left + (coalesced ? delta : 0));
	const next = titlePoint(a.model);
	f.click(next.x, next.y, 200); assert.equal(a.model.placement, 'normal', 'a drag release cannot become a first click');
	f.click(next.x, next.y, 300); assert.equal(a.model.placement, 'maximized', 'fresh complete clicks still maximize');
});

for (const interruption of ['action', 'resize', 'content', 'nonprimary', 'cancel', 'hide'] as const)
	test(`${interruption} interaction cannot complete an earlier title click`, t => {
		const f = fixture(), a = f.window('INTERRUPTED'); a.show();
		t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
		const point = titlePoint(a.model);
		f.click(point.x, point.y, 0);
		switch (interruption) {
			case 'action': {
				const action = a.actions.items.find(item => item.command === 'window.maximize')!.bounds;
				f.dispatch(pointer((action.left + action.right) / 2, (action.top + action.bottom) / 2, 1, 1), 30);
				f.dispatch(pointer(point.x, point.y, 0, 0, 1), 31);
				break;
			}
			case 'resize': f.click(a.model.bounds.right - 1, a.model.bounds.bottom - 1, 30); break;
			case 'content': f.click(a.model.client.left + 16, a.model.client.top + 16, 30); break;
			case 'nonprimary': f.click(point.x, point.y, 30, PointerButton.Secondary); break;
			case 'cancel':
				f.dispatch(pointer(point.x, point.y, 1, 1), 30); f.capture.cancel();
				f.dispatch(pointer(point.x, point.y, 0, 0, 1), 31); break;
			case 'hide': a.control.hide(); a.show(); break;
		}
		assert.equal(a.model.placement, 'normal');
		const next = titlePoint(a.model);
		f.click(next.x, next.y, 100); assert.equal(a.model.placement, 'normal');
		f.click(next.x, next.y, 200); assert.equal(a.model.placement, 'maximized');
	});

test('complete title clicks belong to their own retained window', t => {
	const f = fixture(), a = f.window('FIRST', 0, 40), b = f.window('SECOND', 260, 80); a.show(); b.show();
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	const first = titlePoint(a.model), second = titlePoint(b.model);
	f.click(first.x, first.y, 0); f.click(second.x, second.y, 100);
	assert.equal(a.model.placement, 'normal'); assert.equal(b.model.placement, 'normal');
	f.click(second.x, second.y, 200);
	assert.equal(b.model.placement, 'maximized'); assert.equal(a.model.placement, 'normal');
});

test('maximize and restore retain client and sibling captures without retiring the input surface', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 200, 70); a.show(true); b.show();
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	const surface = a.control.clientSurface!;
	for (const current of [a, b]) {
		let cancelled = 0, released = 0;
		const target = { handleCapturedPointer() {}, releaseCapturedPointer() { released++; }, cancelPointer() { cancelled++; } };
		current.client.focus();
		f.capture.beginRoute(current.control.clientScope.surfaceScope, pointer(250, 150, 1, 1)); f.capture.capture(target);
		for (const maximized of [true, false]) {
			a.control.setPlacement(maximized ? 'maximized' : 'normal');
			assert.equal(f.capture.active, true); assert.equal(f.capture.draining, false); assert.equal(cancelled, 0);
			assert.equal(f.focus.target, current.client);
			assert.equal(a.control.clientSurface, surface); assert.equal(surface.retired, false); assert.equal(a.retires(), 0); assert.equal(a.restores(), 1);
		}
		f.capture.dispatch(pointer(250, 150, 0, 0, 1), false, 1, current.control.clientScope.surfaceScope);
		assert.equal(released, 1);
	}
});

test('custom window action contributions may omit maximize while the actual window command remains available', t => {
	const f = fixture(), standard = createWorkbenchActionBar('window.title');
	const custom = { ...standard, items: standard.items.filter(item => item.command !== 'window.maximize') };
	const a = f.window('CUSTOM', 40, 40, undefined, undefined, { focusScope: f.parent.scope }, custom);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.show(); f.focus.executeCommand('window.maximize', a.control.clientFocusTarget);
	assert.equal(a.model.placement, 'maximized'); assert.deepEqual(a.model.bounds, f.workArea);
	f.focus.executeCommand('window.maximize', a.control.focusTarget);
	assert.equal(a.model.placement, 'normal'); assert.deepEqual(a.model.bounds, a.model.requestedBounds);
});

test('requested placement survives narrow work areas', () => {
	const model = new WorkbenchWindowModel({ left: 170, top: 90, right: 470, bottom: 330 }, 150, 100);
	const area = { left: 0, top: 20, right: 500, bottom: 380 };
	model.arrange(area, 16);
	const requested = { ...model.requestedBounds };
	model.arrange({ left: 0, top: 20, right: 100, bottom: 90 }, 16);
	assert.deepEqual(model.bounds, { left: 0, top: 20, right: 100, bottom: 90 });
	assert.deepEqual(model.requestedBounds, requested);
	model.arrange(area, 16); assert.deepEqual(model.bounds, requested);
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

test('raising a frontend preserves its modeless inspector family outside the pane clip without reattaching input', t => {
	const f = fixture(), document = f.window('DOCUMENT'); document.show();
	const inspector = f.window('INSPECTOR', 120, 110, undefined, undefined, {
		focusScope: document.control.clientScope, lifetimeOwner: document.control.clientSurface!,
		presentationParent: f.surfaces.windowContext(document.control.clientSurface!),
	});
	inspector.show();
	const sibling = f.window('SIBLING', 140, 100); sibling.show();
	t.after(() => { inspector.control.dispose(); document.control.dispose(); sibling.control.dispose(); f.surfaces.dispose(); });
	const surface = inspector.control.surface!, client = inspector.control.clientSurface!, requested = { ...inspector.model.requestedBounds };
	const layouts = inspector.layouts(), restores = inspector.restores();
	const order: string[] = [];
	for (const [name, window] of [['document', document], ['inspector', inspector], ['sibling', sibling]] as const) {
		const draw = window.control.clientSurface!.draw.bind(window.control.clientSurface!);
		t.mock.method(window.control.clientSurface!, 'draw', () => { order.push(name); draw(); });
	}
	const { presenter, renderer } = createHostOverlayFixture(500, 400);
	const paint = () => { order.length = 0; renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame(); };
	// The shared point is outside the document but inside both inspectors' and sibling's clients.
	const bounds = inspector.model.client, siblingBounds = sibling.model.client;
	const x = (Math.max(bounds.left, siblingBounds.left, document.model.bounds.right) + Math.min(bounds.right, siblingBounds.right)) / 2;
	const y = (Math.max(bounds.top, siblingBounds.top) + Math.min(bounds.bottom, siblingBounds.bottom)) / 2;
	assert.equal(f.surfaces.hitTest(x, y), sibling.control.clientSurface);
	paint(); assert.deepEqual(order, ['document', 'inspector', 'sibling']);
	inspector.client.focus();
	let cancelled = 0;
	const gesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	f.capture.beginRoute(inspector.control.clientScope.surfaceScope, pointer(x, y, 1, 1)); f.capture.capture(gesture);
	document.control.show(false);
	assert.equal(f.surfaces.hitTest(x, y), client);
	paint(); assert.deepEqual(order, ['sibling', 'document', 'inspector']);
	assert.equal(f.focus.target, inspector.client); assert.equal(f.capture.active, true); assert.equal(cancelled, 0);
	assert.equal(inspector.control.surface, surface); assert.equal(inspector.control.clientSurface, client);
	assert.equal(surface.retired, false); assert.equal(client.retired, false); assert.equal(inspector.input(), true);
	assert.equal(inspector.layouts(), layouts); assert.equal(inspector.restores(), restores); assert.equal(inspector.retires(), 0);
	assert.deepEqual(inspector.model.requestedBounds, requested);
	sibling.control.show(false);
	assert.equal(f.surfaces.hitTest(x, y), sibling.control.clientSurface);
	assert.equal(f.capture.active, true); assert.equal(cancelled, 0);
	f.capture.dispatch(pointer(x, y, 0, 0, 1), false, 1, inspector.control.clientScope.surfaceScope);
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

test('minimize hides presentation and cancels its gesture without retiring the retained client or context', t => {
	const f = fixture(), a = f.window('MINIMIZE'); a.show(true);
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
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('minimize is not a physical release'); }, cancelPointer() { cancelled += 1; } });
	a.control.minimize();
	assert.ok(a.control.clientSurface === clientSurface); assert.equal(clientSurface.retired, false); assert.equal(clientSurface.visible, false);
	assert.equal(descendant.retired, false); assert.equal(descendant.visible, false); assert.equal(descendantRetired, 0);
	assert.equal(contextRetired, 0); assert.equal(popup.retired, true);
	assert.equal(popupRetired, 1); assert.equal(cancelled, 1); assert.equal(f.capture.draining, true);
	assert.equal(a.input(), true); assert.equal(a.retires(), 0); assert.equal(a.restores(), 1);
	assert.equal(a.model.minimized, true); assert.equal(a.control.visible, false);
	assert.equal(a.model.requestedBounds.bottom - a.model.requestedBounds.top, height);
	assert.ok(f.surfaces.hitTest(100, 100) === f.owner, 'the minimized family no longer excludes the content below');
	f.capture.dispatch(pointer(100, 100, 0, 0, 1), false, 1, descendant.captureScope);
	f.capture.endRoute(pointer(100, 100));
	f.parent.focus(); a.show();
	assert.equal(a.input(), true); assert.ok(f.focus.target === f.parent, 'show without activation does not seize unrelated focus');
	assert.equal(a.model.minimized, false); assert.equal(a.restores(), 1); assert.equal(contextRetired, 0);
	assert.equal(a.model.bounds.bottom - a.model.bounds.top, height);
	assert.ok(a.control.clientSurface === clientSurface); assert.equal(clientSurface.visible, true);
	assert.equal(descendant.visible, true); assert.equal(descendantRetired, 0);
	assert.ok(f.surfaces.hitTest(100, 100) === descendant, 'restoring admits the same retained descendant');
});

test('minimizing another window preserves an unrelated gesture', t => {
	const f = fixture(), a = f.window('FIRST'), b = f.window('SECOND', 200, 70);
	a.show(); b.show();
	t.after(() => { a.control.dispose(); b.control.dispose(); f.surfaces.dispose(); });
	let cancelled = 0;
	f.capture.beginRoute(b.control.clientScope.surfaceScope, pointer(250, 150, 1, 1));
	const unrelated = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled += 1; } };
	f.capture.capture(unrelated);
	a.control.minimize();
	assert.equal(f.capture.active, true); assert.equal(cancelled, 0);
	f.capture.release(unrelated); f.capture.endRoute(pointer(250, 150));
});

test('a later explicit reveal during minimize focus departure remains visible and focused', t => {
	const f = fixture(), a = f.window('REENTRANT'); a.show(true);
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.control.focusTarget.focus();
	const release = a.control.focusTarget.onDidBlur(() => a.control.show(true));
	a.control.minimize();
	release();
	assert.equal(a.model.minimized, false, 'minimize cannot overwrite the later reveal emitted by its focus departure');
	assert.equal(a.control.visible, true); assert.ok(f.focus.target === a.client);
	assert.equal(a.retires(), 0); assert.equal(a.restores(), 1);
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
	const close = a.actions.items.find(item => item.command === 'window.hide')!;
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
		const visible = a.actions.items.filter(item => item.visible), first = visible[0].bounds;
		assert.ok(font.measure(a.model.displayTitle) <= first.left - a.model.header.left - 8);
		assert.equal(a.model.header.bottom - a.model.header.top, font.lineHeight + 8);
		assert.equal(visible.at(-1)!.bounds.right, a.model.header.right - 3);
		assert.ok(visible.every(item => item.bounds.left >= a.model.header.left));
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


test('a minimized attachment retains logical input and descendant membership until explicit show', t => {
	const f = fixture(), a = f.window('RESTORED');
	t.after(() => { a.control.dispose(); f.surfaces.dispose(); });
	a.model.open = true; a.model.setMinimized(true); a.control.attach(); a.layout();
	const client = a.control.clientSurface!;
	assert.ok(client !== undefined); assert.equal(client.visible, false); assert.equal(client.retired, false);
	assert.equal(a.input(), true); assert.equal(a.restores(), 1); assert.equal(a.retires(), 0);
	const descendant = f.surfaces.attach({ role: 'content', lifetimeOwner: client, presentationParent: client,
		captureScope: Symbol('restored group'), isVisible: () => true, getBounds: () => a.model.client,
		getClip: () => a.model.client, draw() {} });
	assert.equal(descendant.visible, false);
	a.show();
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

test('placement notifications publish requested placement and modes, not passive arrangement or chrome updates', () => {
	const bounds = { left: 40, top: 40, right: 280, bottom: 220 };
	const model = new WorkbenchWindowModel(bounds, 120, 80), changes: [boolean, WindowPlacement][] = [];
	const unbind = model.onDidChangePlacement(() => changes.push([model.minimized, model.placement]));
	model.setRequestedBounds(bounds); model.setMinimized(false); model.setPlacement('normal');
	model.arrange({ left: 0, top: 20, right: 500, bottom: 380 }, 16);
	model.title = 'CHROME'; model.invalidate(); model.setMinimumSize(140, 90);
	assert.deepEqual(changes, []);
	model.setRequestedBounds({ left: 60, top: 50, right: 300, bottom: 230 });
	model.setMinimized(true); model.setMinimized(true);
	model.setPlacement('maximized'); model.setPlacement('maximized');
	model.arrange({ left: 0, top: 20, right: 100, bottom: 90 }, 16);
	assert.deepEqual(changes, [[false, 'normal'], [true, 'normal'], [true, 'maximized']]);
	unbind(); model.setMinimized(false); model.setPlacement('normal');
	assert.deepEqual(changes, [[false, 'normal'], [true, 'normal'], [true, 'maximized']]);
});
