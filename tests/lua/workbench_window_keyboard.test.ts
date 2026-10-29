import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel, type WindowPlacement } from '../../ide/workbench/ui/window/model';

/** Geometry assertions here exercise the shared keyboard placement algorithm, not a UI layout snapshot. */
function fixture(t: TestContext, placement: WindowPlacement = 'normal') {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService(() => focus.notifyTargetChanged());
	const area = { left: 20, top: 30, right: 620, bottom: 430 };
	const contextMenu = new ContextMenuController(focus, capture, area), font = new Font({ variant: 'tiny' });
	const parent = focus.createTarget(); parent.bindKeyboard(() => {});
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope,
		isVisible: () => true, getBounds: () => area, getClip: () => area, draw() {} });
	const unbindAdmission = focus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope);
		return surface !== undefined && surfaces.isFocusAdmitted(surface);
	});
	parent.focus();
	const model = new WorkbenchWindowModel({ left: 100, top: 80, right: 340, bottom: 260 }, 120, 80);
	model.setPlacement(placement);
	let publications = 0, contentFocus = 0;
	const unbindPlacement = model.onDidChangePlacement(() => publications++);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => focus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => focus.executeCommand(command, target),
	};
	const control = new WorkbenchFloatingWindow(focus, capture, hover, surfaces, commands, contextMenu, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: owner, presentationParent: null,
		focusScope: parent.scope, focusReturn: parent, workArea: area, content: { draw() {} }, layoutContent() {},
		retireContentInput() {}, restoreContentInput() {},
		focusContent() { contentFocus++; control.clientFocusTarget.focus(); },
	});
	const measure = (text: string, from: number, to: number) => font.measure(text.slice(from, to));
	const measureText = (text: string) => font.measure(text);
	const layout = () => control.layout(font, measure, measureText);
	control.show(false); layout(); control.focusTarget.focus();
	const key = (code: string, modifiers = KeyModifier.none, repeat = false) => {
		const event = new KeyInputEvent(code, modifiers, repeat); focus.handleKeyboard(event);
		focus.handleKeyboard(new KeyInputEvent(code, modifiers, false, false));
		return event;
	};
	const start = (operation: 'move' | 'resize') => commands.execute(`window.${operation}`, control.focusTarget);
	t.after(() => { control.dispose(); contextMenu.dispose(); surfaces.dispose(); unbindAdmission(); unbindPlacement(); focus.setTarget(null); });
	return { focus, capture, surfaces, area, parent, model, control, layout, key, start,
		publications: () => publications, contentFocus: () => contentFocus };
}

for (const operation of ['move', 'resize'] as const) test(`keyboard ${operation} stages coarse, fine and repeated arrows then commits one placement`, t => {
	const f = fixture(t), requested = { ...f.model.requestedBounds }, client = f.control.clientSurface;
	f.start(operation);
	assert.equal(f.key('ArrowRight').consumed, true);
	assert.equal(f.key('ArrowDown', KeyModifier.ctrl).consumed, true);
	assert.equal(f.key('ArrowRight', KeyModifier.none, true).consumed, true);
	const expected = operation === 'move' ? { left: 116, top: 81, right: 356, bottom: 261 }
		: { left: 100, top: 80, right: 356, bottom: 261 };
	assert.deepEqual(f.model.bounds, expected);
	assert.deepEqual(f.model.requestedBounds, requested); assert.equal(f.publications(), 0);
	assert.ok(f.focus.admittedTarget === f.control.focusTarget && f.control.clientSurface === client);
	assert.equal(f.capture.active, false);
	assert.equal(f.key('Enter').consumed, true);
	assert.deepEqual(f.model.requestedBounds, expected); assert.equal(f.model.placement, 'normal');
	assert.equal(f.publications(), 1); assert.equal(f.contentFocus(), 0);
	assert.ok(f.focus.admittedTarget === f.control.focusTarget && f.control.clientSurface === client);
});

for (const operation of ['move', 'resize'] as const) test(`keyboard ${operation} Escape discards its draft without a canonical placement write or content focus`, t => {
	const f = fixture(t), requested = { ...f.model.requestedBounds }, arranged = { ...f.model.bounds };
	f.start(operation); f.key('ArrowLeft'); f.key('ArrowUp');
	assert.notDeepEqual(f.model.bounds, arranged); assert.equal(f.publications(), 0);
	assert.equal(f.key('Escape').consumed, true);
	assert.deepEqual(f.model.requestedBounds, requested); assert.deepEqual(f.model.bounds, arranged);
	assert.equal(f.model.placement, 'normal'); assert.equal(f.publications(), 0); assert.equal(f.contentFocus(), 0);
	assert.ok(f.focus.admittedTarget === f.control.focusTarget);
});

for (const placement of ['normal', 'left', 'right', 'maximized'] as const)
	for (const operation of ['move', 'resize'] as const) {
		if (operation === 'resize' && placement === 'maximized') continue;
		test(`${placement} keyboard ${operation} Enter without an arrow preserves canonical placement`, t => {
			const f = fixture(t, placement), requested = { ...f.model.requestedBounds }, arranged = { ...f.model.bounds };
			f.start(operation); f.key('Enter');
			assert.deepEqual(f.model.requestedBounds, requested); assert.deepEqual(f.model.bounds, arranged);
			assert.equal(f.model.placement, placement); assert.equal(f.publications(), 0); assert.equal(f.contentFocus(), 0);
		});
	}

test('maximized keyboard Resize is unavailable and cannot implicitly restore a normal placement', t => {
	const f = fixture(t, 'maximized'), requested = { ...f.model.requestedBounds }, arranged = { ...f.model.bounds };
	assert.equal(f.control.focusTarget.getCommand('window.resize')!.isEnabled(), false);
	f.start('resize'); assert.equal(f.key('ArrowRight').consumed, false);
	assert.deepEqual(f.model.requestedBounds, requested); assert.deepEqual(f.model.bounds, arranged);
	assert.equal(f.model.placement, 'maximized'); assert.equal(f.publications(), 0);
	assert.ok(f.focus.admittedTarget === f.control.focusTarget);
});

for (const placement of ['left', 'right', 'maximized'] as const)
	test(`first keyboard Move arrow from ${placement} uses retained normal intent without publishing the transition early`, t => {
		const f = fixture(t, placement), requested = { ...f.model.requestedBounds };
		f.start('move');
		assert.equal(f.model.arrangedPlacement, placement);
		f.key('ArrowRight');
		const expected = { left: 108, top: 80, right: 348, bottom: 260 };
		assert.deepEqual(f.model.bounds, expected); assert.equal(f.model.arrangedPlacement, 'normal');
		assert.equal(f.model.placement, placement); assert.deepEqual(f.model.requestedBounds, requested); assert.equal(f.publications(), 0);
		f.key('Enter');
		assert.equal(f.model.placement, 'normal'); assert.deepEqual(f.model.requestedBounds, expected); assert.equal(f.publications(), 1);
	});

for (const placement of ['left', 'right'] as const)
	test(`first keyboard Resize arrow from ${placement} keeps its arranged top-left anchor instead of restoring the normal size`, t => {
		const f = fixture(t, placement), arranged = { ...f.model.bounds }, requested = { ...f.model.requestedBounds };
		f.start('resize'); f.key('ArrowLeft'); f.key('ArrowUp');
		const expected = { ...arranged, right: arranged.right - 8, bottom: arranged.bottom - 8 };
		assert.deepEqual(f.model.bounds, expected); assert.equal(f.model.placement, placement);
		assert.deepEqual(f.model.requestedBounds, requested); assert.equal(f.publications(), 0);
		f.key('Enter');
		assert.deepEqual(f.model.requestedBounds, expected); assert.equal(f.model.placement, 'normal'); assert.equal(f.publications(), 1);
	});

test('keyboard Move and bottom-right Resize obey the live work area and chrome-inclusive minimum', t => {
	const f = fixture(t);
	f.start('move');
	for (let index = 0; index < 100; index++) { f.key('ArrowRight', KeyModifier.none, true); f.key('ArrowUp', KeyModifier.none, true); }
	assert.deepEqual(f.model.bounds, { left: 380, top: 30, right: 620, bottom: 210 });
	f.key('Enter');
	f.start('resize');
	for (let index = 0; index < 100; index++) { f.key('ArrowLeft', KeyModifier.none, true); f.key('ArrowUp', KeyModifier.none, true); }
	assert.equal(f.model.bounds.left, 380); assert.equal(f.model.bounds.top, 30);
	assert.equal(f.model.bounds.right - f.model.bounds.left, f.model.minimumWidth);
	assert.equal(f.model.bounds.bottom - f.model.bounds.top, f.model.minimumHeight);
	f.area.right = 490; f.area.bottom = 100; f.layout();
	assert.ok(f.model.bounds.right <= f.area.right && f.model.bounds.bottom <= f.area.bottom);
	f.key('Enter');
	assert.equal(f.publications(), 2);
});

for (const operation of ['move', 'resize'] as const)
	for (const retirement of ['focus', 'cancelInput', 'scope', 'modal', 'hide', 'minimize', 'detach', 'placement'] as const)
		test(`${retirement} revokes a pending keyboard ${operation} before a later Enter can publish it`, t => {
			const f = fixture(t), requested = { ...f.model.requestedBounds };
			f.start(operation); f.key('ArrowRight');
			assert.notDeepEqual(f.model.bounds, requested); assert.equal(f.publications(), 0);
			switch (retirement) {
				case 'focus': f.parent.focus(); break;
				case 'cancelInput': f.focus.cancelInput(); break;
				case 'scope': f.control.scope.retireContext(); break;
				case 'modal': {
					const modal = f.surfaces.attach({ role: 'modal', blockedScope: f.control.surface!, presentationParent: null,
						captureScope: Symbol('keyboard window decision'), lifetimeOwner: f.control.surface,
						getBounds: () => f.area, getClip: () => f.area, isVisible: () => true, draw() {} });
					assert.ok(f.focus.target === f.control.focusTarget); assert.equal(f.focus.admittedTarget, null);
					// Admission loss itself must revoke the gesture, even with no key while blocked.
					modal.dispose(); break;
				}
				case 'hide': f.control.hide(); f.control.show(false); break;
				case 'minimize': f.control.minimize(); f.control.show(false); break;
				case 'detach': f.control.detach(); f.control.attach(); break;
				case 'placement': f.model.setPlacement('left'); break;
			}
			f.layout(); f.control.focusTarget.focus();
			const placement = f.model.placement, publications = f.publications(), arranged = { ...f.model.bounds };
			assert.deepEqual(f.model.requestedBounds, requested);
			f.key('Enter');
			assert.equal(f.model.placement, placement); assert.deepEqual(f.model.requestedBounds, requested);
			assert.deepEqual(f.model.bounds, arranged); assert.equal(f.publications(), publications);
		});

for (const operation of ['move', 'resize'] as const)
	for (const phase of ['title focus', 'native raise'] as const)
		test(`reentrant ${phase} retirement prevents an incoming keyboard ${operation} from arming`, t => {
			const f = fixture(t), requested = { ...f.model.requestedBounds };
			f.control.clientFocusTarget.focus();
			let unbind: () => void, revoked = 0;
			if (phase === 'title focus') unbind = f.control.focusTarget.onDidFocus(() => {
				unbind(); revoked++; f.control.hide();
			});
			else {
				// A real newer native sibling makes raise publish an actual stacking transition.
				f.surfaces.attach({ role: 'window', presentationParent: null, captureScope: Symbol('newer native sibling'),
					isVisible: () => true, getBounds: () => f.area, getClip: () => f.area, draw() {} });
				unbind = f.focus.onDidChangeTarget(() => {
					const windows = f.surfaces.windowSurfaces;
					if (windows[windows.length - 1] !== f.control.surface) return;
					unbind(); revoked++; f.control.minimize();
				});
			}
			t.after(() => unbind());
			f.start(operation);
			assert.equal(revoked, 1); assert.equal(f.control.visible, false);
			assert.deepEqual(f.model.requestedBounds, requested); assert.equal(f.capture.active, false);
			f.control.show(false); f.layout(); f.control.focusTarget.focus();
			const publications = f.publications();
			assert.equal(f.key('ArrowRight').consumed, false, 'a revoked start does not resume when its window is shown again');
			f.key('Enter');
			assert.deepEqual(f.model.requestedBounds, requested); assert.equal(f.publications(), publications);
		});
