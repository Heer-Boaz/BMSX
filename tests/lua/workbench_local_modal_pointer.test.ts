import assert from 'node:assert/strict';
import test from 'node:test';
import type { RectBounds } from '../../machine/ts/common/rect';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';

test('a promoted main-local modal redirects only its named editor owner, not Files, Problems or a sibling tool', t => {
	const surfaces = new WorkbenchSurfaceService(); t.after(() => surfaces.dispose());
	// Exact regions exercise the surface hit-testing contract, not a UI placement oracle.
	const extent: RectBounds = { left: 0, top: 0, right: 300, bottom: 200 };
	const editorBounds: RectBounds = { left: 100, top: 20, right: 300, bottom: 150 };
	const filesBounds: RectBounds = { left: 0, top: 20, right: 100, bottom: 200 };
	const problemsBounds: RectBounds = { left: 100, top: 150, right: 300, bottom: 200 };
	const toolBounds: RectBounds = { left: 200, top: 30, right: 280, bottom: 80 };
	const popupBounds: RectBounds = { left: 60, top: 50, right: 180, bottom: 100 };
	const root = surfaces.attach({ role: 'window', captureScope: Symbol(), getBounds: () => extent,
		getClip: () => extent, isVisible: () => true, draw() {} });
	const editor = surfaces.attach({ role: 'content', lifetimeOwner: root, presentationParent: root,
		captureScope: Symbol(), getBounds: () => editorBounds, getClip: () => extent, isVisible: () => true, draw() {} });
	const files = surfaces.attach({ role: 'content', lifetimeOwner: root, presentationParent: root,
		captureScope: Symbol(), getBounds: () => filesBounds, getClip: () => extent, isVisible: () => true, draw() {} });
	const problems = surfaces.attach({ role: 'content', lifetimeOwner: root, presentationParent: root,
		captureScope: Symbol(), getBounds: () => problemsBounds, getClip: () => extent, isVisible: () => true, draw() {} });
	const tool = surfaces.attach({ role: 'window', lifetimeOwner: editor, presentationParent: root,
		captureScope: Symbol(), getBounds: () => toolBounds, getClip: () => extent, isVisible: () => true, draw() {} });
	const modal = surfaces.attach({ role: 'modal', blockedScope: editor, lifetimeOwner: editor, presentationParent: root,
		captureScope: Symbol(), getBounds: () => popupBounds, getClip: () => extent, isVisible: () => true, draw() {} });
	assert.equal(surfaces.isAdmitted(editor), false);
	for (const surface of [files, problems, tool]) assert.equal(surfaces.isAdmitted(surface), true);
	assert.ok(surfaces.hitTest(20, 60) === files, 'paint promotion cannot extend the named editor modality into Files');
	assert.ok(surfaces.hitTest(150, 175) === problems, 'Problems retains the same pointer admission as keyboard/commands');
	assert.ok(surfaces.hitTest(250, 50) === tool, 'an independently admitted same-family tool remains pointer reachable');
	assert.ok(surfaces.hitTest(220, 120) === modal, 'a blocked editor press outside the popup redirects to its actual modal');
	assert.ok(surfaces.hitTest(70, 60) === modal, 'the promoted popup itself remains reachable outside its blocked editor bounds');
	modal.dispose();
	assert.ok(surfaces.hitTest(220, 120) === editor);
});

test('workspace modality still owns presses outside its own popup bounds', t => {
	const surfaces = new WorkbenchSurfaceService(); t.after(() => surfaces.dispose());
	const extent: RectBounds = { left: 0, top: 0, right: 300, bottom: 200 };
	const bounds: RectBounds = { left: 100, top: 50, right: 200, bottom: 100 };
	const owner = surfaces.attach({ role: 'window', captureScope: Symbol(), getBounds: () => extent,
		getClip: () => extent, isVisible: () => true, draw() {} });
	const modal = surfaces.attach({ role: 'modal', blockedScope: null, lifetimeOwner: owner, presentationParent: null,
		captureScope: Symbol(), getBounds: () => bounds, getClip: () => extent, isVisible: () => true, draw() {} });
	assert.equal(surfaces.isAdmitted(owner), false);
	assert.ok(surfaces.hitTest(20, 150) === modal);
});
