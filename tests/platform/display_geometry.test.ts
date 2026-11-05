import assert from 'node:assert/strict';
import test from 'node:test';
import { DisplayGeometry } from '../../hosts/common/display_geometry';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { DisplayPointMappingResult, mapDisplayPointToViewport } from '../../machine/ts/render/video_output';

test('display publication retains one complete transform and notifies only actual changes', () => {
	const geometry = new DisplayGeometry(), retained = geometry.bounds;
	const publications: number[][] = [];
	const unsubscribe = geometry.onDidChange(() => {
		const bounds = geometry.bounds;
		publications.push([bounds.left, bounds.top, bounds.width, bounds.height, geometry.targetWidth, geometry.targetHeight]);
	});
	geometry.update(20, 30, 800, 600, 400, 300);
	geometry.update(20, 30, 800, 600, 400, 300);
	geometry.update(28, 38, 800, 600, 400, 300);
	geometry.update(28, 38, 800, 600, 800, 600);
	assert.ok(geometry.bounds === retained);
	assert.deepEqual(publications, [[20, 30, 800, 600, 400, 300], [28, 38, 800, 600, 400, 300], [28, 38, 800, 600, 800, 600]]);
	const point = { x: 0, y: 0 };
	assert.equal(mapDisplayPointToViewport(geometry.bounds, geometry.targetWidth, geometry.targetHeight, 228, 138, point), DisplayPointMappingResult.Inside);
	assert.deepEqual(point, { x: 200, y: 100 });
	unsubscribe(); geometry.update(0, 0, 800, 600, 800, 600);
	assert.equal(publications.length, 3);
	geometry.onDidChange(() => assert.fail('disposed geometry cannot retain a consumer'));
	geometry.dispose(); geometry.update(0, 0, 0, 0, 800, 600);
});

test('offscreen output publishes the same identity transform used by pointer projection', () => {
	const output = new OffscreenVideoOutput(320, 240), retained = output.measureDisplay();
	let changes = 0;
	const unsubscribe = output.geometry.onDidChange(() => { changes++; });
	output.setDisplaySize(640, 480); output.setDisplaySize(640, 480);
	assert.equal(changes, 1);
	assert.ok(output.measureDisplay() === retained && retained === output.geometry.bounds);
	assert.deepEqual(retained, { left: 0, top: 0, width: 640, height: 480 });
	assert.equal(output.geometry.targetWidth, 640); assert.equal(output.geometry.targetHeight, 480);
	assert.deepEqual(output.visibleViewportBounds, { left: 0, top: 0, right: 640, bottom: 480 });
	unsubscribe();
});
