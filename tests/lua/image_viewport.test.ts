import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { WorkbenchImageViewport } from '../../ide/workbench/ui/image_viewport';

test('image Fit contains original pixels, caps magnification and reserves both scrollbar gutters', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(800, 400);
	viewport.layout(10, 20, 410 + SCROLLBAR_WIDTH, 220 + SCROLLBAR_WIDTH);
	assert.deepEqual(viewport.bounds, { left: 10, top: 20, right: 410, bottom: 220 });
	assert.deepEqual(viewport.transform, { scale: 0.5, offsetX: 10, offsetY: 20 });
	assert.equal(viewport.horizontal.isVisible(), false);
	assert.equal(viewport.vertical.isVisible(), false);
	viewport.setImage(32, 16);
	assert.deepEqual(viewport.transform, { scale: 1, offsetX: 194, offsetY: 112 });
	assert.equal(viewport.mode, 'fit');
});

test('oversized image zoom preserves the source pixel under the pointer without quantizing scroll', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(800, 600);
	viewport.layout(10, 20, 210 + SCROLLBAR_WIDTH, 120 + SCROLLBAR_WIDTH);
	viewport.setScale(1);
	viewport.pan(13.25, 21.75);
	const anchorX = 75.5, anchorY = 62.25;
	const before = viewport.transform;
	const sourceX = (anchorX - before.offsetX) / before.scale;
	const sourceY = (anchorY - before.offsetY) / before.scale;
	viewport.setScale(2, anchorX, anchorY);
	assert.equal((anchorX - viewport.transform.offsetX) / viewport.scale, sourceX);
	assert.equal((anchorY - viewport.transform.offsetY) / viewport.scale, sourceY);
	viewport.setScale(1, anchorX, anchorY);
	assert.equal((anchorX - viewport.transform.offsetX) / viewport.scale, sourceX);
	assert.equal((anchorY - viewport.transform.offsetY) / viewport.scale, sourceY);
});

test('Fit tracks resized bounds while an explicit scale remains fixed and geometry stays retained', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(800, 400);
	viewport.layout(0, 0, 400 + SCROLLBAR_WIDTH, 200 + SCROLLBAR_WIDTH);
	const retained = viewport.transform;
	viewport.layout(0, 0, 200 + SCROLLBAR_WIDTH, 100 + SCROLLBAR_WIDTH);
	assert.equal(viewport.scale, 0.25);
	assert.strictEqual(viewport.transform, retained);
	viewport.setScale(1);
	viewport.layout(0, 0, 300 + SCROLLBAR_WIDTH, 150 + SCROLLBAR_WIDTH);
	assert.equal(viewport.scale, 1);
	const horizontalRevision = viewport.horizontal.revision;
	const verticalRevision = viewport.vertical.revision;
	viewport.layout(0, 0, 300 + SCROLLBAR_WIDTH, 150 + SCROLLBAR_WIDTH);
	assert.equal(viewport.horizontal.revision, horizontalRevision);
	assert.equal(viewport.vertical.revision, verticalRevision);
	assert.strictEqual(viewport.transform, retained);
	viewport.setImage(800, 400);
	assert.equal(viewport.mode, 'fit');
	assert.equal(viewport.scale, 0.375);
	assert.equal(viewport.horizontal.getScroll(), 0);
	assert.equal(viewport.vertical.getScroll(), 0);
});

test('pixel zoom gestures follow reciprocal and integer levels and saturate without wraparound', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(1000, 1000);
	viewport.layout(0, 0, 300 + SCROLLBAR_WIDTH, 300 + SCROLLBAR_WIDTH);
	assert.equal(viewport.scale, 0.3);
	viewport.zoomBySteps(1);
	assert.equal(viewport.scale, 0.5);
	viewport.zoomBySteps(-1);
	assert.equal(viewport.scale, 0.25);
	viewport.zoomBySteps(-20);
	assert.equal(viewport.scale, 0.125);
	for (const scale of [0.25, 0.5, 1, 2, 4, 8, 16]) {
		viewport.zoomBySteps(1);
		assert.equal(viewport.scale, scale);
	}
	viewport.zoomBySteps(20);
	assert.equal(viewport.scale, 16);
	viewport.zoomBySteps(-1);
	assert.equal(viewport.scale, 8);
});

test('image panning saturates at content edges and independently centers a fitting axis', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(800, 40);
	viewport.layout(10, 20, 210 + SCROLLBAR_WIDTH, 120 + SCROLLBAR_WIDTH);
	viewport.setScale(1);
	viewport.pan(10000, 10000);
	assert.equal(viewport.horizontal.getScroll(), 600);
	assert.equal(viewport.vertical.getScroll(), 0);
	assert.deepEqual(viewport.transform, { scale: 1, offsetX: -590, offsetY: 50 });
	viewport.pan(-10000, -10000);
	assert.equal(viewport.horizontal.getScroll(), 0);
	assert.equal(viewport.vertical.getScroll(), 0);
	viewport.setScale('fit');
	assert.deepEqual(viewport.transform, { scale: 0.25, offsetX: 10, offsetY: 65 });
});


test('zoom-out never enlarges a large image whose Fit scale is below the explicit zoom sequence', () => {
	const viewport = new WorkbenchImageViewport();
	viewport.setImage(10000, 10000);
	viewport.layout(0, 0, 300 + SCROLLBAR_WIDTH, 300 + SCROLLBAR_WIDTH);
	assert.equal(viewport.scale, 0.03);
	viewport.zoomBySteps(-1);
	assert.equal(viewport.scale, 0.03);
	assert.equal(viewport.mode, 'fit');
	viewport.zoomBySteps(-20);
	assert.equal(viewport.scale, 0.03);
	viewport.zoomBySteps(1);
	assert.equal(viewport.scale, 0.125);
	viewport.zoomBySteps(-1);
	assert.equal(viewport.scale, 0.125);
});
