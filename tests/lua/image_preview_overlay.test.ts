import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { ImagePreviewOverlay } from '../../ide/workbench/ui/image_preview_overlay';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const pixels = { width: 2, height: 1, pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) };
const bounds = { left: 0, top: 10, right: 140, bottom: 100 };
const otherBounds = { left: 140, top: 10, right: 220, bottom: 100 };

function fixture(t: TestContext) {
	let changes = 0, wheel = 0, selections = 0, decodes = 0;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; });
	const owner = surfaces.attach({
		role: 'content', captureScope: Symbol('image pane'), isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {},
		handlePointer() { selections++; }, handleWheel() { wheel++; return true; },
	});
	const other = surfaces.attach({
		role: 'content', captureScope: Symbol('unrelated pane'), isVisible: () => true,
		getBounds: () => otherBounds, getClip: () => otherBounds, draw() {},
	});
	const cache = new ImagePreviewCache(async () => { decodes++; return pixels; });
	const preview = new ImagePreviewOverlay(cache, surfaces, owner);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	preview.layout(bounds, 6);
	t.after(() => { preview.dispose(); cache.dispose(); surfaces.dispose(); inputFocus.setTarget(null); });
	return { preview, cache, surfaces, owner, other, origin,
		changes: () => changes, wheel: () => wheel, selections: () => selections, decodes: () => decodes };
}

test('the shared lightbox owns local pointer and wheel admission rather than asking each pane to block', t => {
	const f = fixture(t);
	assert.equal(f.surfaces.hitTest(40, 40), f.owner);
	f.preview.open('image');
	assert.equal(inputFocus.target!.scope.surfaceScope, f.preview.surface.captureScope,
		'keyboard, clipboard and command admission use the same local modal surface as pointer targeting');
	assert.equal(f.preview.surface.lifetimeOwner, f.owner);
	assert.equal(f.preview.surface.presentationParent, f.owner);
	assert.equal(f.surfaces.isAdmitted(f.owner), false);
	assert.equal(f.surfaces.isAdmitted(f.preview.surface), true);
	assert.equal(f.surfaces.isAdmitted(f.other), true);
	assert.equal(f.surfaces.hitTest(160, 40), f.other, 'the modal blocks only the owning pane');
	const hit = f.surfaces.hitTest(40, 40)!;
	assert.equal(hit, f.preview.surface);
	hit.handleWheel?.({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40, deltaX: 0, deltaY: 1, modifiers: KeyModifier.none });
	assert.equal(f.wheel(), 0, 'an unhandled wheel stays with the opaque lightbox rather than the underlying pane');
	hit.handlePointer!({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40,
		spaceDown: false, modifiers: KeyModifier.none, pressedButtons: PointerButton.Secondary,
		justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0 }, 1);
	assert.equal(f.preview.visible, true, 'secondary input is blocked, not forwarded or treated as primary dismissal');
	assert.equal(f.selections(), 0);
	hit.handlePointer!({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40,
		spaceDown: false, modifiers: KeyModifier.none, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 }, 2);
	assert.equal(f.preview.visible, false);
	assert.equal(f.selections(), 0, 'the dismissing occurrence is never replayed into the underlying pane');
	assert.equal(inputFocus.target, f.origin);
	assert.equal(f.surfaces.isAdmitted(f.owner), true);
});

test('Escape and Enter dismiss from lightbox focus while replacement and retirement preserve correct focus ownership', t => {
	const f = fixture(t);
	for (const code of ['Escape', 'Enter']) {
		f.preview.open('first');
		f.preview.open('second');
		const event = new KeyInputEvent(code, KeyModifier.none);
		inputFocus.handleKeyboard(event);
		assert.equal(event.consumed, true);
		assert.equal(f.preview.visible, false);
		assert.equal(inputFocus.target, f.origin, 'replacing the image does not replace the return target with the modal itself');
	}
	f.preview.open('image');
	const elsewhere = inputFocus.createTarget(); elsewhere.bindKeyboard(() => {}); elsewhere.focus();
	f.preview.close();
	assert.equal(inputFocus.target, elsewhere, 'closing a local lightbox cannot steal focus back from another active surface');
	f.origin.focus(); f.preview.open('image');
	f.owner.dispose();
	assert.equal(f.preview.visible, false);
	assert.equal(f.preview.surface.retired, true);
	assert.equal(inputFocus.target, f.origin);
	assert.equal(f.surfaces.findByScope(f.preview.surface.captureScope), undefined);
});

test('only changed lightbox geometry and visibility publish invalidation, and separate surface painting retains its decoded bitmap', async t => {
	const f = fixture(t), renderer = createHostOverlayFixture(220, 110);
	editorViewState.font = new EditorFont('tiny');
	const changes = f.changes();
	for (let frame = 0; frame < 100; frame++) f.preview.layout(bounds, 6);
	assert.equal(f.changes(), changes, 'unchanged layout does not rebuild or publish surface state');
	f.preview.open('image'); await Promise.resolve();
	for (let frame = 0; frame < 4; frame++) {
		f.cache.beginFrame();
		// The pane completes its thumbnail frame before root-owned lightbox paint.
		f.cache.endFrame();
		renderer.renderer.beginFrame(renderer.presenter); api.beginFrame(renderer.renderer);
		f.surfaces.draw(api); renderer.renderer.endFrame();
		assert.ok(renderer.queue.consumeOverlayFrame().commandCount > 0);
	}
	assert.equal(f.decodes(), 1, 'drawing a root-owned overlay after its pane frame reuses the attached image');
	const expanded = { ...bounds, right: 180 };
	f.preview.layout(expanded, 6);
	assert.equal(f.changes(), changes + 2, 'opening and one geometry change each publish once');
	assert.equal(f.preview.surface.getBounds().right, 180);
	f.preview.close();
	const closed = f.changes(); f.preview.close();
	assert.equal(f.changes(), closed, 'closing an already absent lightbox is not a structural change');
});
