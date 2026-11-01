import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneViewportCamera } from '../../ide/workbench/contrib/scene_editor/viewport/camera';
import { SceneTranslationGizmo, TranslateHandle } from '../../ide/workbench/contrib/scene_editor/viewport/translate_gizmo';
import type { SceneSourceAffine } from '../../ide/workbench/contrib/scene_editor/model';

const BOUNDS = { left: 10, top: 20, right: 410, bottom: 260 };
const POSE2: SceneSourceAffine = { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
const POSE3: SceneSourceAffine = { family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };

test('2D move geometry hits painted axes and the center handle constrains the world delta', () => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240);
	gizmo.project(POSE2, 0, camera, BOUNDS, 0, 8);
	for (const handle of [TranslateHandle.X, TranslateHandle.Y]) {
		const points = gizmo.axes[handle === TranslateHandle.X ? 0 : 1], x = (points[0] + points[2]) / 2, y = (points[1] + points[3]) / 2;
		assert.equal(gizmo.hit(x, y), handle); assert.equal(gizmo.begin(handle, x, y, camera, BOUNDS), true);
		assert.equal(gizmo.move(x + 13, y - 17, camera), true);
		assert.deepEqual([...gizmo.delta], handle === TranslateHandle.X ? [13, 0, 0] : [0, -17, 0]); gizmo.cancel();
	}
	assert.equal(gizmo.hit(gizmo.x, gizmo.y), TranslateHandle.View);
	gizmo.begin(TranslateHandle.View, gizmo.x, gizmo.y, camera, BOUNDS); gizmo.move(gizmo.x + 13, gizmo.y - 17, camera);
	assert.deepEqual([...gizmo.delta], [13, -17, 0]); assert.equal(gizmo.move(gizmo.x + 13, gizmo.y - 17, camera), false);
});

test('perspective axis dragging intersects a frozen camera-facing plane without a TRS or inverse-child approximation', () => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240); camera.setMode('3d');
	gizmo.project(POSE3, 0, camera, BOUNDS, 0, 8);
	for (let axis = 0; axis < 3; axis++) {
		const x = axis === 0 ? 0.75 : 0, y = axis === 1 ? 0.75 : 0, z = axis === 2 ? 0.75 : 0;
		const sx = 210 + camera.projectX(x, y, z), sy = 140 + camera.projectY(x, y, z);
		assert.equal(gizmo.begin(1 << axis, sx, sy, camera, BOUNDS), true);
		gizmo.move(210 + camera.projectX(x * 2, y * 2, z * 2), 140 + camera.projectY(x * 2, y * 2, z * 2), camera);
		for (let component = 0; component < 3; component++) assert.ok(Math.abs(gizmo.delta[component] - (component === axis ? 0.75 : 0)) < 1e-12);
		gizmo.cancel();
	}
});

test('perspective plane handles constrain only the selected world plane', () => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240); camera.setMode('3d');
	gizmo.project(POSE3, 0, camera, BOUNDS, 0, 10);
	for (const handle of [TranslateHandle.XY, TranslateHandle.XZ, TranslateHandle.YZ]) {
		assert.equal(gizmo.begin(handle, 210, 140, camera, BOUNDS), true);
		const x = (handle & 1) !== 0 ? 0.25 : 0, y = (handle & 2) !== 0 ? 0.25 : 0, z = (handle & 4) !== 0 ? 0.25 : 0;
		gizmo.move(210 + camera.projectX(x, y, z), 140 + camera.projectY(x, y, z), camera);
		assert.ok(Math.abs(gizmo.delta[0] - x) < 1e-12 && Math.abs(gizmo.delta[1] - y) < 1e-12 && Math.abs(gizmo.delta[2] - z) < 1e-12);
		gizmo.cancel();
	}
});

test('handle geometry borrows font/allocation metrics and retains idle projection lanes', t => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240);
	gizmo.project(POSE2, 0, camera, BOUNDS, 0, 8);
	const points = gizmo.axes[0], span = points[2] - gizmo.x, projected = t.mock.method(camera, 'projectX');
	for (let frame = 0; frame < 100; frame++) gizmo.project(POSE2, 0, camera, BOUNDS, 0, 8);
	assert.equal(projected.mock.callCount(), 0); assert.ok(gizmo.axes[0] === points);
	gizmo.project(POSE2, 0, camera, BOUNDS, 1, 12); assert.ok(points[2] - gizmo.x > span);
	gizmo.project(POSE2, 0, camera, { ...BOUNDS, right: 90, bottom: 100 }, 2, 12); assert.ok(points[2] - gizmo.x < span);
});

test('end-on and behind-camera handles remain unavailable, including repeated idle projection', () => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240); camera.setMode('3d');
	const state = camera.capture(); camera.restore({ ...state, space: { ...state.space, yaw: 0, pitch: 0 } });
	gizmo.project(POSE3, 0, camera, BOUNDS, 0, 8); assert.equal(gizmo.visibleAxes & TranslateHandle.Z, 0);
	assert.equal(gizmo.begin(TranslateHandle.Z, gizmo.x, gizmo.y, camera, BOUNDS), false);
	const behind: SceneSourceAffine = { ...POSE3, oz: 100 };
	for (let frame = 0; frame < 2; frame++) {
		gizmo.project(behind, 0, camera, BOUNDS, 0, 8); assert.equal(gizmo.world, undefined); assert.equal(gizmo.hit(210, 140), TranslateHandle.None);
	}
});

test('origin-relative handle projection preserves a unit lever beside a huge world origin', () => {
	const origin = 2 ** 60, camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240); camera.setMode('3d');
	camera.frame3D(-1, -1, -1, 1, 1, 1, origin, origin, origin);
	const state = camera.capture(); camera.restore({ ...state, space: { ...state.space, yaw: 0, pitch: 0 } });
	const pose: SceneSourceAffine = { ...POSE3, ox: origin, oy: origin, oz: origin };
	gizmo.project(pose, 0, camera, BOUNDS, 0, 8);
	assert.ok((gizmo.visibleAxes & TranslateHandle.X) !== 0);
	const x = 210 + camera.projectX(0.5, 0, 0, origin, origin, origin);
	assert.equal(gizmo.begin(TranslateHandle.X, x, 140, camera, BOUNDS), true);
	gizmo.move(210 + camera.projectX(0.75, 0, 0, origin, origin, origin), 140, camera);
	assert.ok(Math.abs(gizmo.delta[0] - 0.25) < 1e-12); assert.equal(gizmo.delta[1], 0); assert.equal(gizmo.delta[2], 0);
});


test('2D dragging snaps the moved world axis to pixels without rounding an untouched authored coordinate', () => {
	const camera = new SceneViewportCamera(), gizmo = new SceneTranslationGizmo(); camera.setViewport(400, 240); camera.zoom(1.4, 0, 0);
	const pose: SceneSourceAffine = { ...POSE2, ox: 0.25, oy: 8.6567164179104 };
	gizmo.project(pose, 0, camera, BOUNDS, 0, 8);
	const x = gizmo.x, y = gizmo.y;
	assert.equal(gizmo.begin(TranslateHandle.View, x, y, camera, BOUNDS), true);
	assert.equal(gizmo.move(x, y, camera), false); assert.deepEqual([...gizmo.delta], [0, 0, 0]);
	gizmo.move(x + 1.1 * camera.scale, y, camera);
	assert.equal(pose.ox + gizmo.delta[0], 1); assert.equal(gizmo.delta[1], 0);
	gizmo.move(x + 1.1 * camera.scale, y + 0.6 * camera.scale, camera);
	assert.equal(pose.ox + gizmo.delta[0], 1); assert.equal(pose.oy + gizmo.delta[1], 9);
	assert.equal(pose.ox, 0.25); assert.equal(pose.oy, 8.6567164179104);
});
