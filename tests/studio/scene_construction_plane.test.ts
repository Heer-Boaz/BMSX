import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';

// Geometry is the subject here: the construction-plane inverse must map to
// the same displayed ray, not an incidental widget coordinate or label.
test('3D construction points lie on world XZ and project back onto their exact displayed ray', () => {
	const camera = new WorkbenchViewportCamera(); camera.setMode('3d'); camera.setViewport(640, 480);
	const point = { x: 0, y: 0, z: 0 };
	for (const move of [() => {}, () => camera.pan(43, 26), () => camera.orbit(18, -12), () => camera.zoom(1.5, -16, 28)]) {
		move();
		for (const [x, y] of [[0, 0], [-80, 40], [120, 80], [45, 150]]) {
			assert.equal(camera.unprojectGround3d(x, y, point), true);
			assert.equal(point.y, 0);
			assert.ok(Math.abs(camera.projectX(point.x, point.y, point.z) - x) < 1e-9);
			assert.ok(Math.abs(camera.projectY(point.x, point.y, point.z) - y) < 1e-9);
		}
	}
});

for (const direction of ['parallel', 'behind', 'at eye'] as const)
test(`${direction} ground intersection supplies no invented coordinates`, () => {
	const camera = new WorkbenchViewportCamera(); camera.setMode('3d'); camera.setViewport(640, 480);
	const state = camera.capture();
	camera.restore({ ...state, space: { ...state.space, originY: direction === 'at eye' ? 0 : 2, pitch: 0 } });
	const point = { x: 7, y: 8, z: 9 };
	assert.equal(camera.unprojectGround3d(0, direction === 'behind' ? -120 : direction === 'at eye' ? 120 : 0, point), false);
	assert.deepEqual(point, { x: 7, y: 8, z: 9 });
});

test('construction remains a world plane after rebasing the orbit pivot and does not snap 3D world units to pixels', () => {
	const camera = new WorkbenchViewportCamera(); camera.setMode('3d'); camera.setViewport(640, 480);
	const state = camera.capture();
	camera.restore({ ...state, space: { ...state.space, originX: 1000000, originY: -40, originZ: -2000000,
		centerX: 3.25, centerY: 40, centerZ: -7.75 } });
	const point = { x: 0, y: 0, z: 0 };
	assert.equal(camera.unprojectGround3d(35.25, 68.5, point), true);
	assert.equal(point.y, 0);
	assert.ok(point.x !== Math.round(point.x) && point.z !== Math.round(point.z));
	assert.ok(Math.abs(camera.projectX(point.x, point.y, point.z) - 35.25) < 1e-6);
	assert.ok(Math.abs(camera.projectY(point.x, point.y, point.z) - 68.5) < 1e-6);
});
