import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import type { WorkbenchSurfaceOptions, WorkbenchSurfacePainter } from '../../ide/workbench/services/windows/model';
import type { RectBounds } from '../../machine/ts/common/rect';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../ide/common/models';

const extent: RectBounds = { left: 0, top: 0, right: 300, bottom: 200 };
const firstWindow: RectBounds = { left: 20, top: 20, right: 150, bottom: 150 };
const secondWindow: RectBounds = { left: 80, top: 30, right: 200, bottom: 160 };

function controller(name: string, painted: string[], bounds = extent) {
	return {
		captureScope: Symbol(name),
		getBounds: () => bounds,
		getClip: () => extent,
		isVisible: () => true,
		draw: () => { painted.push(name); },
	};
}

const painter: WorkbenchSurfacePainter = { pushClipRect() {}, popClipRect() {} };

test('one retained surface order drives painting and targeting; raising keeps child groups together', () => {
	const painted: string[] = [];
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes += 1; });
	const back = surfaces.attach({ ...controller('back', painted), role: 'content' });
	const a = surfaces.attach({ ...controller('a', painted, firstWindow), role: 'window' });
	const child = surfaces.attach({ ...controller('a child', painted, firstWindow), role: 'content', presentationParent: a, lifetimeOwner: a });
	const b = surfaces.attach({ ...controller('b', painted, secondWindow), role: 'window' });
	const feedback = surfaces.attach({ ...controller('feedback', painted), role: 'feedback' });
	const newLayout = surfaces.attach({ ...controller('new layout', painted), role: 'content' });

	surfaces.draw(painter);
	assert.deepEqual(painted, ['back', 'new layout', 'a', 'a child', 'b', 'feedback']);
	assert.equal(surfaces.hitTest(100, 80), b);
	assert.equal(surfaces.hitTest(250, 180), newLayout);
	assert.equal(surfaces.hitTest(300, 100), null, 'rectangles remain half open');
	assert.equal(surfaces.findByScope(a.captureScope), a);

	surfaces.raise(a);
	painted.length = 0;
	surfaces.draw(painter);
	assert.deepEqual(painted, ['back', 'new layout', 'b', 'a', 'a child', 'feedback']);
	assert.equal(surfaces.hitTest(100, 80), child);
	assert.equal(surfaces.findByScope(feedback.captureScope), feedback);
	assert.equal(back.retired, false);
	assert.equal(changes, 7, 'attachments and reordering publish immediate invalidation');
});

test('raising an already top surface in its role band publishes no false ordering change', () => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; });
	const painted: string[] = [];
	const a = surfaces.attach({ ...controller('a', painted), role: 'window' });
	const b = surfaces.attach({ ...controller('b', painted), role: 'window' });
	surfaces.attach({ ...controller('feedback', painted), role: 'feedback' });
	const attached = changes;
	surfaces.raise(b); assert.equal(changes, attached);
	surfaces.raise(a); assert.equal(changes, attached + 1);
	for (let publication = 0; publication < 20; publication++) surfaces.raise(a);
	assert.equal(changes, attached + 1, 'focus synchronization cannot turn unchanged z-order into another publication');
});

test('geometry and visibility are read from their retained producer without copying or re-registration', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	const bounds = { ...firstWindow };
	let visible = true;
	const surface = surfaces.attach({ ...controller('window', painted, bounds), role: 'window', isVisible: () => visible });
	assert.equal(surface.getBounds(), bounds);
	assert.equal(surfaces.hitTest(50, 50), surface);
	bounds.left = 100;
	assert.equal(surfaces.hitTest(50, 50), null);
	bounds.left = 20;
	visible = false;
	assert.equal(surfaces.hitTest(50, 50), null);
	surfaces.draw(painter);
	assert.deepEqual(painted, []);
	visible = true;
	assert.equal(surfaces.hitTest(50, 50), surface);
});

test('contained paint and pointer use the same effective ancestor clip, while promoted transients escape it', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	const clip = { left: 40, top: 40, right: 100, bottom: 100 };
	const owner = surfaces.attach({ ...controller('owner', painted, firstWindow), role: 'window', getClip: () => clip });
	const child = surfaces.attach({ ...controller('contained', painted), role: 'subwindow', presentationParent: owner, lifetimeOwner: owner });
	assert.equal(surfaces.hitTest(50, 50), child);
	assert.equal(surfaces.hitTest(30, 50), null);
	const clips: number[][] = [];
	let depth = 0;
	surfaces.draw({
		pushClipRect(left, top, right, bottom) { clips.push([left, top, right, bottom, ++depth]); },
		popClipRect() { depth -= 1; },
	});
	assert.deepEqual(clips, [[40, 40, 100, 100, 1], [0, 0, 300, 200, 2]]);
	assert.equal(depth, 0, 'the existing renderer intersects nested clip pushes');

	const popup = surfaces.attach({
		...controller('popup', painted, secondWindow), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner,
	});
	assert.equal(surfaces.hitTest(180, 70), popup, 'promoted attachment does not inherit the content clip');
	assert.equal(surfaces.hitTest(250, 180), popup, 'exclusive outside input belongs to the dismissing popup');
	assert.equal(surfaces.topBlockingSurface, popup);
	owner.dispose();
	assert.equal(child.retired, true);
	assert.equal(popup.retired, true, 'promotion does not detach lifetime ownership');
});

test('root and local modality are admission boundaries, not arbitrary globally raised rectangles', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	const a = surfaces.attach({ ...controller('a', painted, firstWindow), role: 'window' });
	const b = surfaces.attach({ ...controller('b', painted, secondWindow), role: 'window' });
	const local = surfaces.attach({
		...controller('local modal', painted, firstWindow), role: 'modal', blockedScope: a, presentationParent: a, getClip: () => firstWindow,
		lifetimeOwner: b, // Lifetime and blocked scope deliberately differ.
	});
	assert.equal(local.presentationParent, a);
	assert.equal(surfaces.isAdmitted(a), false);
	assert.equal(surfaces.isAdmitted(local), true);
	assert.equal(surfaces.isAdmitted(b), true);
	assert.equal(surfaces.hitTest(100, 80), b, 'an unrelated window can cover a local modal group');
	assert.equal(surfaces.hitTest(30, 30), local);
	assert.equal(surfaces.topBlockingSurface, null, 'a local modal does not globally cancel unrelated captures');
	surfaces.raise(a);
	assert.equal(surfaces.hitTest(100, 80), local);
	const root = surfaces.attach({ ...controller('root modal', painted, secondWindow), role: 'modal', blockedScope: null, presentationParent: null });
	assert.equal(surfaces.hitTest(10, 10), root, 'the root backdrop owns points outside the dialog');
	assert.equal(surfaces.topBlockingSurface, root);
	assert.equal(surfaces.isAdmitted(local), false);
	assert.equal(surfaces.isAdmitted(b), false);
	assert.equal(surfaces.isAdmitted(root), true);
	const nested = surfaces.attach({ ...controller('nested', painted, firstWindow), role: 'modal', blockedScope: root, presentationParent: root, lifetimeOwner: root });
	assert.equal(surfaces.isAdmitted(root), false);
	assert.equal(surfaces.isAdmitted(nested), true);
	root.dispose();
	assert.equal(surfaces.isAdmitted(local), true);
	assert.equal(nested.retired, true);
});

test('a promoted main modal is visible and reachable while unrelated document windows remain interactive and raisable', () => {
	const surfaces = new WorkbenchSurfaceService(), painted: string[] = [];
	const chrome = surfaces.attach({ ...controller('chrome', painted), role: 'content' });
	const main = surfaces.attach({ ...controller('main', painted), role: 'content', lifetimeOwner: chrome, presentationParent: chrome });
	const document = surfaces.attach({ ...controller('document', painted, secondWindow), role: 'window', lifetimeOwner: chrome });
	const modal = surfaces.attach({ ...controller('main chooser', painted, firstWindow), role: 'modal', blockedScope: main,
		presentationParent: null, lifetimeOwner: main,
	});
	assert.equal(surfaces.isAdmitted(main), false);
	assert.equal(surfaces.isAdmitted(modal), true);
	assert.equal(surfaces.isAdmitted(document), true);
	assert.equal(surfaces.topBlockingSurface, null, 'promotion does not turn a part-local chooser into a workspace blocker');
	surfaces.draw(painter);
	assert.deepEqual(painted, ['chrome', 'main', 'document', 'main chooser']);
	assert.equal(surfaces.hitTest(100, 80), modal, 'the promoted chooser owns the visible overlap');
	assert.equal(surfaces.hitTest(180, 80), document, 'outside the chooser rectangle an unrelated sibling receives its own input');
	assert.equal(surfaces.hitTest(250, 180), modal, 'the named main owner cannot receive input around its local chooser');
	surfaces.raise(document);
	painted.length = 0; surfaces.draw(painter);
	assert.deepEqual(painted, ['chrome', 'main', 'main chooser', 'document']);
	assert.equal(surfaces.hitTest(100, 80), document, 'a later sibling raise uses that same retained paint order');
	assert.equal(surfaces.isAdmitted(modal), true, 'covering a retained local session does not cancel it');
	surfaces.raise(modal);
	assert.equal(surfaces.hitTest(100, 80), modal);
	main.dispose();
	assert.equal(modal.retired, true, 'presentation promotion preserves its main-owner lifetime');
	assert.equal(surfaces.isAdmitted(document), true);
	assert.equal(surfaces.hitTest(100, 80), document);
});

test('later local and workspace modals revoke promoted descendants through their declared admission owner', () => {
	const surfaces = new WorkbenchSurfaceService(), painted: string[] = [];
	const owner = surfaces.attach({ ...controller('owner', painted), role: 'content' });
	const sibling = surfaces.attach({ ...controller('sibling', painted, secondWindow), role: 'window' });
	const first = surfaces.attach({ ...controller('first chooser', painted, firstWindow), role: 'modal', blockedScope: owner,
		presentationParent: null, lifetimeOwner: owner,
	});
	const popup = surfaces.attach({ ...controller('promoted popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: first });
	assert.equal(surfaces.isAdmitted(popup), true, 'a promoted popup retains the modal attachment as its admitted owner');
	const second = surfaces.attach({ ...controller('second chooser', painted, firstWindow), role: 'modal', blockedScope: owner,
		presentationParent: null, lifetimeOwner: owner,
	});
	assert.equal(surfaces.isAdmitted(first), false);
	assert.equal(surfaces.isAdmitted(second), true);
	assert.equal(popup.retired, true, 'a later local decision revokes the earlier promoted popup family');
	assert.equal(surfaces.isAdmitted(sibling), true);
	const workspace = surfaces.attach({ ...controller('workspace decision', painted), role: 'modal', blockedScope: null,
		presentationParent: null,
	});
	assert.equal(surfaces.isAdmitted(second), false);
	assert.equal(surfaces.isAdmitted(sibling), false);
	assert.equal(surfaces.hitTest(180, 80), workspace);
	workspace.dispose();
	assert.equal(surfaces.isAdmitted(second), true);
	assert.equal(surfaces.isAdmitted(sibling), true);
	second.dispose();
	assert.equal(surfaces.isAdmitted(first), true, 'retiring the top decision restores the surviving modal owner');
});

test('a later owner-local modal retires promoted popup families and drains their captured gesture', () => {
	const capture = new PointerCaptureService();
	const surfaces = new WorkbenchSurfaceService(() => {
		const scope = capture.routeScope;
		if (scope === undefined) return;
		const surface = surfaces.findByScope(scope);
		if (surface === undefined || !surfaces.isAdmitted(surface)) capture.cancelScope(scope);
	});
	const painted: string[] = [], retired: string[] = [];
	const owner = surfaces.attach({ ...controller('owner', painted, firstWindow), role: 'window' });
	const sibling = surfaces.attach({ ...controller('sibling', painted, secondWindow), role: 'window' });
	const popup = surfaces.attach({ ...controller('popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner,
		onRetire: () => { retired.push('popup'); },
	});
	const submenu = surfaces.attach({ ...controller('submenu', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: popup,
		onRetire: () => { retired.push('submenu'); },
	});
	const siblingPopup = surfaces.attach({ ...controller('sibling popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: sibling });
	let cancelled = 0, released = 0;
	const drag = { handleCapturedPointer() {}, releaseCapturedPointer() { released++; }, cancelPointer() { cancelled++; } };
	const held: PointerSnapshot = { valid: true, insideViewport: true, viewportX: 50, viewportY: 50,
		pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	capture.beginRoute(submenu.captureScope, held);
	capture.capture(drag);

	const modal = surfaces.attach({ ...controller('modal', painted, firstWindow), role: 'modal', blockedScope: owner, presentationParent: owner,
		lifetimeOwner: sibling, getClip: () => firstWindow,
	});
	assert.deepEqual(retired, ['popup', 'submenu']);
	assert.equal(popup.retired, true);
	assert.equal(submenu.retired, true);
	assert.equal(surfaces.isAdmitted(modal), true, 'modal admission follows its blocked scope, not its unrelated lifetime owner');
	assert.equal(surfaces.isAdmitted(siblingPopup), true);
	assert.equal(siblingPopup.retired, false);
	assert.equal(cancelled, 1);
	assert.equal(capture.active, false);
	assert.equal(capture.draining, true);
	assert.equal(capture.dispatch({ ...held, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary },
		false, 10, sibling.captureScope), true);
	assert.equal(released, 0, 'a revoked popup cannot commit its gesture on another surface');
	assert.equal(capture.draining, false);
	modal.dispose();
	assert.equal(popup.retired, true, 'removing the modal does not revive the retired popup');
	const replacementPopup = surfaces.attach({ ...controller('replacement popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner });
	capture.beginRoute(siblingPopup.captureScope, held);
	capture.capture(drag);
	surfaces.attach({ ...controller('another local modal', painted, firstWindow), role: 'modal', blockedScope: owner, presentationParent: owner, lifetimeOwner: owner });
	assert.equal(replacementPopup.retired, true);
	assert.equal(capture.active, true, 'retiring another admission family preserves the sibling capture');
	assert.equal(capture.routeScope, siblingPopup.captureScope);
	assert.equal(cancelled, 1);
	capture.dispatch({ ...held, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary },
		false, 20, siblingPopup.captureScope);
	assert.equal(released, 1);
});

test('modal visibility and raising revoke promoted sessions only in the affected admission family', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	const owner = surfaces.attach({ ...controller('owner', painted, firstWindow), role: 'window' });
	const sibling = surfaces.attach({ ...controller('sibling', painted, secondWindow), role: 'window' });
	const siblingPopup = surfaces.attach({ ...controller('sibling popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: sibling });
	let visible = false;
	const firstModal = surfaces.attach({ ...controller('first modal', painted, firstWindow), role: 'modal', blockedScope: owner, presentationParent: owner,
		lifetimeOwner: owner, isVisible: () => visible,
	});
	const popup = surfaces.attach({ ...controller('popup', painted), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner });
	assert.equal(popup.retired, false);
	visible = true;
	surfaces.changed();
	assert.equal(surfaces.isAdmitted(owner), false, 'the visibility producer publishes its new modal admission');
	assert.equal(popup.retired, true);
	const secondModal = surfaces.attach({ ...controller('second modal', painted, firstWindow), role: 'modal', blockedScope: owner, presentationParent: owner, lifetimeOwner: owner });
	const modalPopup = surfaces.attach({ ...controller('modal popup', painted), role: 'transient', outsidePress: 'consume',
		lifetimeOwner: secondModal, presentationParent: secondModal,
	});
	assert.equal(surfaces.isAdmitted(modalPopup), true);
	surfaces.raise(firstModal);
	assert.equal(surfaces.isAdmitted(firstModal), true);
	assert.equal(surfaces.isAdmitted(secondModal), false);
	assert.equal(modalPopup.retired, true);
	assert.equal(siblingPopup.retired, false);
	assert.equal(surfaces.isAdmitted(siblingPopup), true);
});

test('nested local modality settles reentrant popup retirement before publishing admission', () => {
	const painted: string[] = [], retired: string[] = [];
	let published = 0;
	let checking = false;
	const surfaces = new WorkbenchSurfaceService(() => {
		published++;
		if (!checking) return;
		assert.equal(surfaces.findByScope(popupScope)?.retired, undefined);
		assert.equal(surfaces.findByScope(submenuScope)?.retired, undefined);
	});
	const popupScope = Symbol('popup'), submenuScope = Symbol('submenu');
	const owner = surfaces.attach({ ...controller('owner', painted), role: 'content' });
	const modal = surfaces.attach({ ...controller('modal', painted, firstWindow), role: 'modal', blockedScope: owner, presentationParent: owner, lifetimeOwner: owner });
	const client = surfaces.attach({ ...controller('client', painted, firstWindow), role: 'content', presentationParent: modal, lifetimeOwner: modal });
	const popup = surfaces.attach({ ...controller('popup', painted), captureScope: popupScope, role: 'transient', outsidePress: 'consume',
		lifetimeOwner: client, presentationParent: modal,
		onRetire: () => { retired.push('popup'); surfaces.changed(); },
	});
	const submenu = surfaces.attach({ ...controller('submenu', painted), captureScope: submenuScope, role: 'transient', outsidePress: 'consume',
		lifetimeOwner: popup, presentationParent: modal,
		onRetire: () => { retired.push('submenu'); surfaces.changed(); },
	});
	assert.equal(surfaces.isAdmitted(popup), true);
	assert.equal(surfaces.isAdmitted(submenu), true);
	const before = published;
	checking = true;
	const nested = surfaces.attach({ ...controller('nested modal', painted, firstWindow), role: 'modal', blockedScope: modal, presentationParent: modal, lifetimeOwner: modal });
	assert.deepEqual(retired, ['popup', 'submenu']);
	assert.equal(published, before + 1, 'structural reconciliation publishes only the settled admission state');
	assert.equal(surfaces.isAdmitted(nested), true);
	assert.equal(surfaces.isAdmitted(modal), false);
});

test('opaque unhandled surfaces retain the occurrence; wheel and pointer callbacks are actual controller callbacks', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	let lowerCalls = 0;
	let topCalls = 0;
	const handlePointer: NonNullable<WorkbenchSurfaceOptions['handlePointer']> = () => { topCalls += 1; };
	const lower = surfaces.attach({ ...controller('lower', painted), role: 'content', handleWheel: () => { lowerCalls += 1; return true; } });
	const upper = surfaces.attach({ ...controller('upper', painted, firstWindow), role: 'window', handlePointer, handleWheel: () => false });
	const selected = surfaces.hitTest(50, 50);
	assert.equal(selected, upper);
	assert.equal(selected.handlePointer, handlePointer, 'the surface does not add a forwarding controller');
	assert.equal(selected.handleWheel?.({ valid: true, insideViewport: true, viewportX: 50, viewportY: 50, modifiers: KeyModifier.none, deltaX: 0, deltaY: 1 }), false);
	assert.equal(lowerCalls, 0, 'not handling an occurrence never chooses a lower surface');
	selected.handlePointer?.({ valid: true, insideViewport: true, viewportX: 50, viewportY: 50, modifiers: KeyModifier.none, spaceDown: false, pressedButtons: 1, justPressedButtons: 1, justReleasedButtons: 0 }, 10);
	assert.equal(topCalls, 1);
	assert.equal(surfaces.hitTest(250, 150), lower);
});

test('retirement detaches lookup, presentation and lifetime memberships before notifying the actual owner', () => {
	const surfaces = new WorkbenchSurfaceService();
	const painted: string[] = [];
	const events: string[] = [];
	const retained = surfaces.attach({ ...controller('retained', painted), role: 'content' });
	const owner = surfaces.attach({ ...controller('owner', painted, firstWindow), role: 'window', onRetire: () => {
		events.push('owner');
		assert.equal(surfaces.findByScope(owner.captureScope), undefined);
		assert.equal(surfaces.hitTest(100, 80), retained);
		assert.equal(surfaces.findByScope(promoted.captureScope), promoted, 'descendant membership remains available to the retiring owner');
		assert.equal(surfaces.isAdmitted(promoted), false, 'retired ancestry revokes descendant admission before notification');
	} });
	const promoted = surfaces.attach({
		...controller('promoted', painted, secondWindow), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner,
		onRetire: () => {
			events.push('promoted');
			assert.equal(surfaces.findByScope(promoted.captureScope), undefined);
			assert.equal(surfaces.hitTest(100, 80), retained);
		},
	});
	owner.dispose();
	assert.deepEqual(events, ['owner', 'promoted']);
	assert.equal(surfaces.findByScope(owner.captureScope), undefined);
	assert.equal(surfaces.findByScope(retained.captureScope), retained);
	assert.equal(surfaces.isAdmitted(promoted), false);
	owner.dispose();
	assert.deepEqual(events, ['owner', 'promoted'], 'disposal remains idempotent');
	surfaces.dispose();
	assert.equal(surfaces.hitTest(50, 50), null);
	assert.equal(retained.retired, true);
});
