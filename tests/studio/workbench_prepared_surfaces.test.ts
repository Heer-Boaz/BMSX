import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
import type { WorkbenchSurfacePainter } from '../../ide/workbench/services/windows/model';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';

const extent = { left: 0, top: 0, right: 300, bottom: 200 };
const painter: WorkbenchSurfacePainter = { pushClipRect() {}, popClipRect() {} };

function client(painted: symbol[], onRetire?: () => void) {
	const captureScope = Symbol('native client');
	return { captureScope, getBounds: () => extent, getClip: () => extent, isVisible: () => true,
		draw: () => { painted.push(captureScope); }, onRetire };
}

test('prepared native roots retain their attachment identity without painting, input, window discovery or publication', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const background = surfaces.attach({ ...client(painted), role: 'content' });
	const published = changes, root = surfaces.prepare({ ...client(painted), role: 'window' });
	assert.equal(surfaces.findByScope(root.captureScope), root);
	assert.equal(root.retired, false); assert.equal(root.visible, false);
	assert.equal(changes, published);
	assert.equal(surfaces.isFocusAdmitted(root), false); assert.equal(surfaces.isAdmitted(root), false);
	assert.equal(surfaces.hitTest(20, 20), background);
	assert.deepEqual(surfaces.windowSurfaces, []); assert.equal(surfaces.topBlockingSurface, null);
	surfaces.draw(painter); assert.deepEqual(painted, [background.captureScope]);

	const focus = new InputFocusService(), scope = new InputFocusScope(root.captureScope, focus.workbenchScope);
	const target = focus.createTarget(null, scope); let keys = 0;
	target.bindKeyboard(() => { keys++; });
	focus.bindScopeAdmission(current => {
		const surface = surfaces.findByScope(current.surfaceScope);
		return surface !== undefined && surfaces.isFocusAdmitted(surface);
	});
	assert.equal(target.focus(), false);
	focus.handleKeyboard(new KeyInputEvent('KeyA', KeyModifier.none)); assert.equal(keys, 0);
	surfaces.publish(root);
	assert.equal(target.focus(), true);
	focus.handleKeyboard(new KeyInputEvent('KeyA', KeyModifier.none)); assert.equal(keys, 1);
	assert.equal(surfaces.hitTest(20, 20), root);
	assert.deepEqual(surfaces.windowSurfaces, [root]);
});

test('attached descendants and promoted lifetime-owned windows wait for their prepared native root', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const root = surfaces.prepare({ ...client(painted), role: 'content' });
	const child = surfaces.attach({ ...client(painted), role: 'content', lifetimeOwner: root, presentationParent: root });
	const grandchild = surfaces.attach({ ...client(painted), role: 'content', lifetimeOwner: child, presentationParent: child });
	const window = surfaces.attach({ ...client(painted), role: 'window', lifetimeOwner: grandchild });
	assert.equal(changes, 0); assert.equal(surfaces.hitTest(20, 20), null);
	assert.deepEqual(surfaces.windowSurfaces, []);
	for (const surface of [root, child, grandchild, window]) {
		assert.equal(surfaces.findByScope(surface.captureScope), surface);
		assert.equal(surfaces.isFocusAdmitted(surface), false);
	}
	surfaces.draw(painter); assert.deepEqual(painted, []);
	surfaces.publish(root);
	assert.equal(changes, 1);
	for (const surface of [root, child, grandchild, window]) assert.equal(surfaces.isAdmitted(surface), true);
	assert.deepEqual(surfaces.windowSurfaces, [window]);
	assert.equal(surfaces.hitTest(20, 20), window);
	surfaces.draw(painter); assert.deepEqual(new Set(painted), new Set([root.captureScope, child.captureScope, grandchild.captureScope, window.captureScope]));
});

test('unrelated native publication cannot retire a prepared promoted transient as an inadmissible live popup', t => {
	let changes = 0, retired = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const background = surfaces.attach({ ...client(painted), role: 'content' });
	const root = surfaces.prepare({ ...client(painted), role: 'content' });
	const published = changes;
	const transient = surfaces.attach({ ...client(painted, () => { retired++; }), role: 'transient', outsidePress: 'consume', lifetimeOwner: root });
	assert.equal(retired, 0); assert.equal(changes, published);
	surfaces.changed();
	assert.equal(transient.retired, false); assert.equal(retired, 0);
	assert.equal(surfaces.topBlockingSurface, null); assert.equal(surfaces.hitTest(20, 20), background);
	surfaces.publish(root);
	assert.equal(transient.retired, false); assert.equal(retired, 0);
	assert.equal(surfaces.topBlockingSurface, transient); assert.equal(surfaces.hitTest(20, 20), transient);
});

test('a prepared promoted modal cannot block a published owner before its own lifetime subtree is published', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const owner = surfaces.attach({ ...client(painted), role: 'window' });
	const root = surfaces.prepare({ ...client(painted), role: 'content' });
	const before = changes;
	const modal = surfaces.attach({ ...client(painted), role: 'modal', blockedScope: owner, presentationParent: null, lifetimeOwner: root });
	assert.equal(changes, before);
	assert.equal(surfaces.isAdmitted(owner), true); assert.equal(surfaces.isAdmitted(modal), false);
	assert.equal(surfaces.hitTest(20, 20), owner);
	surfaces.publish(root);
	assert.equal(surfaces.isAdmitted(owner), false); assert.equal(surfaces.isAdmitted(modal), true);
	assert.equal(surfaces.hitTest(20, 20), modal);
});

test('publication is per native attachment and repeating an admitted publication cannot expose a separately prepared child', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const root = surfaces.prepare({ ...client(painted), role: 'window' });
	const child = surfaces.prepare({ ...client(painted), role: 'content', lifetimeOwner: root, presentationParent: root });
	surfaces.publish(root);
	assert.equal(surfaces.isAdmitted(root), true); assert.equal(surfaces.isAdmitted(child), false);
	const published = changes;
	surfaces.publish(root); assert.equal(changes, published);
	surfaces.publish(child);
	assert.equal(surfaces.isAdmitted(child), true); assert.equal(surfaces.hitTest(20, 20), child);
	assert.equal(changes, published + 1);
	surfaces.publish(child); assert.equal(changes, published + 1);
	assert.deepEqual(surfaces.windowSurfaces, [root]);
});

test('aborting an unpublished native subtree retires its retained and promoted attachments without unrelated admission publication', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [], retired = new Set<symbol>();
	t.after(() => surfaces.dispose());
	const background = surfaces.attach({ ...client(painted), role: 'window' });
	const root = surfaces.prepare({ ...client(painted), role: 'content' });
	const child = surfaces.attach({ ...client(painted), role: 'content', lifetimeOwner: root, presentationParent: root });
	const promoted = surfaces.attach({ ...client(painted), role: 'window', lifetimeOwner: child });
	const modal = surfaces.attach({ ...client(painted), role: 'modal', blockedScope: null, presentationParent: null, lifetimeOwner: promoted });
	for (const surface of [root, child, promoted, modal]) surface.onDidRetire(() => {
		assert.equal(retired.has(surface.captureScope), false); retired.add(surface.captureScope);
	});
	const before = changes;
	root.dispose(); root.dispose();
	assert.equal(changes, before); assert.equal(retired.size, 4);
	for (const surface of [root, child, promoted, modal]) {
		assert.equal(surface.retired, true); assert.equal(surfaces.findByScope(surface.captureScope), undefined);
	}
	assert.equal(surfaces.isAdmitted(background), true); assert.equal(surfaces.hitTest(20, 20), background);
	assert.deepEqual(surfaces.windowSurfaces, [background]); assert.equal(surfaces.topBlockingSurface, null);
});

test('published hidden windows remain discoverable while unpublished hidden windows do not enter the native picker', t => {
	let changes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; }), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const root = surfaces.prepare({ ...client(painted), role: 'content' });
	const minimized = surfaces.attach({ ...client(painted), role: 'window', lifetimeOwner: root, isVisible: () => false });
	assert.equal(changes, 0); assert.deepEqual(surfaces.windowSurfaces, []);
	surfaces.publish(root);
	assert.deepEqual(surfaces.windowSurfaces, [minimized]);
	assert.equal(minimized.visible, false); assert.equal(surfaces.isFocusAdmitted(minimized), false);
	surfaces.changed(); assert.deepEqual(surfaces.windowSurfaces, [minimized]);
	assert.equal(surfaces.topBlockingSurface, null);
});

for (const role of ['content', 'window'] as const) test(`retiring a published ${role} subtree withdraws its promoted modal and windows before owner callbacks`, t => {
	const surfaces = new WorkbenchSurfaceService(), painted: symbol[] = [];
	t.after(() => surfaces.dispose());
	const outside = surfaces.attach({ ...client(painted), role: 'window' });
	const focus = new InputFocusService(), target = focus.createTarget(null, new InputFocusScope(outside.captureScope, focus.workbenchScope));
	focus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope);
		return surface !== undefined && surfaces.isFocusAdmitted(surface);
	});
	let entered = false;
	const owner = surfaces.attach({ ...client(painted), role, onRetire: () => {
		entered = true;
		assert.equal(modal.published, false);
		assert.equal(surfaces.topBlockingSurface, null);
		assert.deepEqual(surfaces.windowSurfaces, [outside]);
		assert.equal(target.focus(), true);
	} });
	const promoted = surfaces.attach({ ...client(painted), role: 'window', lifetimeOwner: owner });
	const modal = surfaces.attach({ ...client(painted), role: 'modal', blockedScope: null, presentationParent: null, lifetimeOwner: promoted });
	assert.equal(target.focus(), false);
	owner.dispose();
	assert.equal(entered, true);
	assert.equal(focus.admittedTarget, target);
	assert.equal(modal.retired, true); assert.equal(promoted.retired, true);
});
