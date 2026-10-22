import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import type { WorkbenchSurfaceOptions, WorkbenchSurfacePainter } from '../../ide/workbench/services/windows/model';
import type { RectBounds } from '../../machine/ts/common/rect';
import { KeyModifier } from '../../hosts/common/input/text';

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
		...controller('local modal', painted, firstWindow), role: 'modal', blockedScope: a, getClip: () => firstWindow,
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
	const root = surfaces.attach({ ...controller('root modal', painted, secondWindow), role: 'modal', blockedScope: null });
	assert.equal(surfaces.hitTest(10, 10), root, 'the root backdrop owns points outside the dialog');
	assert.equal(surfaces.topBlockingSurface, root);
	assert.equal(surfaces.isAdmitted(local), false);
	assert.equal(surfaces.isAdmitted(b), false);
	assert.equal(surfaces.isAdmitted(root), true);
	const nested = surfaces.attach({ ...controller('nested', painted, firstWindow), role: 'modal', blockedScope: root, lifetimeOwner: root });
	assert.equal(surfaces.isAdmitted(root), false);
	assert.equal(surfaces.isAdmitted(nested), true);
	root.dispose();
	assert.equal(surfaces.isAdmitted(local), true);
	assert.equal(nested.retired, true);
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
	const owner = surfaces.attach({ ...controller('owner', painted, firstWindow), role: 'window', onRetire: () => { events.push('owner'); } });
	const promoted = surfaces.attach({
		...controller('promoted', painted, secondWindow), role: 'transient', outsidePress: 'consume', lifetimeOwner: owner,
		onRetire: () => {
			events.push('promoted');
			assert.equal(surfaces.findByScope(promoted.captureScope), undefined);
			assert.equal(surfaces.hitTest(100, 80), retained);
		},
	});
	owner.dispose();
	assert.deepEqual(events, ['promoted', 'owner']);
	assert.equal(surfaces.findByScope(owner.captureScope), undefined);
	assert.equal(surfaces.findByScope(retained.captureScope), retained);
	assert.equal(surfaces.isAdmitted(promoted), false);
	owner.dispose();
	assert.deepEqual(events, ['promoted', 'owner'], 'disposal remains idempotent');
	surfaces.dispose();
	assert.equal(surfaces.hitTest(50, 50), null);
	assert.equal(retained.retired, true);
});
