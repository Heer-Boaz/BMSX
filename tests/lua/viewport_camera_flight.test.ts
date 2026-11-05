import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';

test('free look holds the eye, orbit holds the pivot, and both preserve the independent 2D reading', () => {
	const camera = new WorkbenchViewportCamera(); camera.setViewport(640, 480); camera.pan(12, -8);
	const canvas = camera.capture().canvas;
	camera.setMode('3d'); camera.frame3D(-20, -10, -10, 20, 10, 10, 2 ** 60, 2 ** 60, 2 ** 60);
	const before = new Float64Array(3), after = new Float64Array(3);
	camera.eyeRelativeTo(camera.originX, camera.originY, camera.originZ, before);
	camera.look(17, -5);
	camera.eyeRelativeTo(camera.originX, camera.originY, camera.originZ, after);
	for (let i = 0; i < 3; i++) assert.ok(Math.abs(after[i] - before[i]) < 1e-10, 'rotation retains the eye even at a large world origin');
	const focused = camera.capture().space;
	camera.orbit(-9, 3);
	const orbited = camera.capture().space;
	assert.deepEqual([orbited.centerX, orbited.centerY, orbited.centerZ], [focused.centerX, focused.centerY, focused.centerZ]);
	camera.eyeRelativeTo(camera.originX, camera.originY, camera.originZ, after);
	assert.notDeepEqual(after, before);
	assert.deepEqual(camera.capture().canvas, canvas);
});

test('flight translates the eye and focus in the requested camera/world axes without changing orientation or orbit distance', () => {
	const camera = new WorkbenchViewportCamera(); camera.setMode('3d'); camera.setViewport(640, 480);
	const direction = new Float64Array(3), before = new Float64Array(3), after = new Float64Array(3);
	camera.rayDirection3D(0, 0, direction); camera.eyeRelativeTo(0, 0, 0, before);
	const initial = camera.capture().space;
	camera.fly(0, 7, 11);
	camera.eyeRelativeTo(0, 0, 0, after);
	for (let i = 0; i < 3; i++) assert.ok(Math.abs(after[i] - before[i] - direction[i] * 11 - (i === 1 ? 7 : 0)) < 1e-10);
	const moved = camera.capture().space;
	assert.equal(moved.yaw, initial.yaw); assert.equal(moved.pitch, initial.pitch); assert.equal(moved.distance, initial.distance);
	assert.equal(moved.reading, 'manual');
	const revision = camera.revision;
	camera.fly(0, 0, 0); camera.look(0, 0);
	assert.equal(camera.revision, revision, 'idle input does not invalidate projected geometry');
});
