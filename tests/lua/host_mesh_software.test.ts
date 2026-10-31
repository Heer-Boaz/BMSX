import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Affine3 } from '../../machine/ts/common/affine3';
import { HostMesh, HostMeshScene, type HostMeshInstance } from '../../machine/ts/render/host_overlay/mesh';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const IDENTITY: Affine3 = { xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };
const CLIP_IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function scene(...instances: HostMeshInstance[]): HostMeshScene {
	const scene = new HostMeshScene(8, 8);
	scene.clipFromOrigin.set(CLIP_IDENTITY); scene.instances.push(...instances);
	return scene;
}

function mesh(positions: number[], color: number, doubleSided = false): HostMesh {
	return new HostMesh({ positions: new Float32Array(positions), color, doubleSided });
}

function fixture(t: TestContext, width = 8, height = 8) {
	const f = createHostOverlayFixture(width, height);
	f.presenter.initialize(new RenderPassLibrary(f.backend, f.presenter));
	t.after(() => f.presenter.dispose());
	const context = f.backend.hostOverlayContext, pixels = f.backend.framebufferPixels;
	const draw = (scene: HostMeshScene) => {
		pixels.fill(0); beginHeadlessHost2D(context, pixels, width, height);
		renderHeadlessHost2DEntry(context, Host2DKind.MeshScene, { scene, left: 0, top: 0, right: width, bottom: height });
		return pixels;
	};
	return { ...f, context, pixels, draw };
}

function pixel(pixels: Uint8Array, x: number, y: number, width = 8): number[] {
	const offset = (y * width + x) * 4;
	return [...pixels.subarray(offset, offset + 4)];
}

// Exact pixels here are renderer algorithms under test: depth interpolation,
// canonical clipping, half-open sample coverage and ordered UI compositing.
test('software mesh depth resolves intersecting faces per pixel independent of submission order', t => {
	const f = fixture(t);
	const red = mesh([-1, -1, 0.2, 1, -1, 0.8, -1, 1, 0.2], 0x20ff0000);
	const blue = mesh([-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5], 0xff0000ff);
	const viewport = scene({ ...IDENTITY, mesh: red }, { ...IDENTITY, mesh: blue });
	const before = f.draw(viewport).slice();
	assert.deepEqual(pixel(before, 1, 5), [0, 0, 255, 255]);
	assert.deepEqual(pixel(before, 5, 6), [255, 0, 0, 255], 'opaque geometry does not consume the authored alpha byte');
	viewport.instances.reverse(); viewport.changed();
	assert.deepEqual(f.draw(viewport), before);
});

test('software mesh depth32float strict greater retains the first coplanar fragment', t => {
	const f = fixture(t), positions = [-1, -1, 0.7, 1, -1, 0.7, -1, 1, 0.7];
	const viewport = scene({ ...IDENTITY, mesh: mesh(positions, 0xffff0000) }, { ...IDENTITY, mesh: mesh(positions, 0xff0000ff) });
	assert.deepEqual(pixel(f.draw(viewport), 1, 5), [255, 0, 0, 255]);
	viewport.instances.reverse(); viewport.changed();
	assert.deepEqual(pixel(f.draw(viewport), 1, 5), [0, 0, 255, 255]);
});

test('software mesh clips all four sides and canonical near/far planes before division', t => {
	const f = fixture(t);
	const large = new HostMesh({ positions: new Float32Array([-2, -2, 0.5, 2, -2, 0.5, -2, 2, 0.5, 2, 2, 0.5]),
		indices: new Uint16Array([0, 1, 2, 2, 1, 3]), indexComponentType: 5123, color: 0xff00ff00, doubleSided: false });
	const viewport = scene({ ...IDENTITY, mesh: large });
	const pixels = f.draw(viewport);
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) assert.deepEqual(pixel(pixels, x, y), [0, 255, 0, 255]);
	for (const depth of [-1, 2]) {
		viewport.instances[0] = { ...viewport.instances[0], mesh: mesh([-1, -1, 0.5, 1, -1, 0.5, -1, 1, depth], 0xff00ff00) };
		viewport.changed();
		assert.deepEqual(pixel(f.draw(viewport), 1, 6), [0, 255, 0, 255]);
		assert.deepEqual(pixel(f.pixels, 1, 3), [0, 0, 0, 0]);
	}
});

test('software homogeneous near clipping matches its explicitly clipped polygon at the eye-plane crossing', t => {
	const f = fixture(t);
	const original = mesh([-0.5, -0.5, -1, 0.5, -0.5, -1, 0, 0.5, 0], 0xff112233);
	const clipped = new HostMesh({ positions: new Float32Array([-0.5, -0.5, -1, 0.5, -0.5, -1, 0.25, 0, -0.5, -0.25, 0, -0.5]),
		indices: new Uint8Array([0, 1, 2, 0, 2, 3]), indexComponentType: 5121, color: 0xff112233, doubleSided: false });
	const viewport = scene({ ...IDENTITY, mesh: original });
	viewport.clipFromOrigin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.5, 0]);
	const before = f.draw(viewport).slice();
	assert.deepEqual(pixel(before, 3, 4), [17, 34, 51, 255]);
	assert.deepEqual(pixel(before, 3, 3), [0, 0, 0, 0]);
	viewport.instances[0] = { ...viewport.instances[0], mesh: clipped }; viewport.changed();
	assert.deepEqual(f.draw(viewport), before);
	const depth = f.context.meshScenes.get(viewport).depth;
	assert.equal(depth[4 * 8 + 3], 0.875);
	assert.equal(depth[5 * 8 + 3], 0.625);
});

test('software mesh top-left shared edges have neither cracks nor order-dependent double coverage', t => {
	const f = fixture(t);
	const red = mesh([-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5], 0xffff0000);
	const blue = mesh([-1, 1, 0.5, 1, -1, 0.5, 1, 1, 0.5], 0xff0000ff);
	const viewport = scene({ ...IDENTITY, mesh: red }, { ...IDENTITY, mesh: blue });
	const before = f.draw(viewport).slice();
	for (let offset = 3; offset < before.length; offset += 4) assert.equal(before[offset], 255);
	viewport.instances.reverse(); viewport.changed();
	assert.deepEqual(f.draw(viewport), before);
});

test('software mesh winding follows reflections, double-sided faces and drawable singular flattening', t => {
	const f = fixture(t), positions = [-0.75, -0.75, 0.5, 0.75, -0.75, 0.5, 0, 0.75, 0.5];
	const front = mesh(positions, 0xff123456), viewport = scene({ ...IDENTITY, mesh: front });
	const before = f.draw(viewport).slice();
	viewport.instances[0].xx = -1; viewport.changed();
	const reflected = f.draw(viewport);
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) assert.deepEqual(pixel(reflected, x, y), pixel(before, 7 - x, y));
	viewport.instances[0].xx = 1;
	const back = [positions[6], positions[7], positions[8], ...positions.slice(3, 6), ...positions.slice(0, 3)];
	viewport.instances[0] = { ...viewport.instances[0], mesh: mesh(back, 0xff123456) }; viewport.changed();
	assert.ok(f.draw(viewport).every(value => value === 0));
	viewport.instances[0] = { ...viewport.instances[0], mesh: mesh(back, 0xff123456, true) }; viewport.changed();
	assert.deepEqual(f.draw(viewport), before);
	viewport.instances[0] = { ...viewport.instances[0], mesh: front, zz: 0, oz: 0.5 }; viewport.changed();
	assert.deepEqual(f.draw(viewport), before, 'a singular 3D basis can still produce a drawable projected face');
	viewport.instances[0].xx = 0; viewport.changed();
	assert.ok(f.draw(viewport).every(value => value === 0), 'a zero projected area emits no fragments');
});

test('software mesh combines full Number model/view matrices before any depth or pixel publication', t => {
	const f = fixture(t), geometry = mesh([-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5], 0xff778899);
	const viewport = scene({ ...IDENTITY, ox: 0.25, mesh: geometry });
	const before = f.draw(viewport).slice();
	viewport.instances[0].ox += 2 ** 30; viewport.clipFromOrigin[12] = -(2 ** 30); viewport.changed();
	assert.deepEqual(f.draw(viewport), before, 'f32 world staging would lose the fractional translated pose');
});

test('software mesh scene origins retain local geometry when absolute world additions would erase it', t => {
	const f = fixture(t), geometry = mesh([-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5], 0xff778899);
	const viewport = scene({ ...IDENTITY, mesh: geometry });
	const before = f.draw(viewport).slice(), origin = 2 ** 60;
	viewport.instances[0].ox = viewport.instances[0].oy = viewport.instances[0].oz = origin;
	viewport.originX = viewport.originY = viewport.originZ = origin; viewport.changed();
	assert.deepEqual(f.draw(viewport), before, 'origin-relative camera composition must precede local position application');
});

test('software triangle lists consume only complete triples, matching GPU draw count', t => {
	const f = fixture(t), positions = [-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5];
	const viewport = scene({ ...IDENTITY, mesh: mesh(positions, 0xff778899) });
	const before = f.draw(viewport).slice();
	const trailing = new HostMesh({ positions: new Float32Array([...positions, 20, 30, 40]),
		indices: new Uint32Array([0, 1, 2, 0xffffffff, 0xffffffff]), indexComponentType: 5125, color: 0xff778899, doubleSided: false });
	viewport.instances[0] = { ...IDENTITY, mesh: trailing }; viewport.changed();
	assert.equal(trailing.drawCount, 3); assert.deepEqual(f.draw(viewport), before);
	viewport.instances[0] = { ...IDENTITY, mesh: mesh([...positions, 20, 30, 40], 0xff778899) }; viewport.changed();
	assert.equal(viewport.instances[0].mesh.drawCount, 3); assert.deepEqual(f.draw(viewport), before);
	viewport.instances[0] = { ...IDENTITY, mesh: mesh([0, 0, 0.5], 0xff778899) }; viewport.changed();
	assert.equal(viewport.instances[0].mesh.drawCount, 0); assert.ok(f.draw(viewport).every(value => value === 0));
});

test('software mesh targets retain idle storage and retire on resize, scene disposal and presenter teardown', t => {
	const f = fixture(t), viewport = scene({ ...IDENTITY, mesh: mesh([-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5], 0xffffffff) });
	f.draw(viewport);
	const original = f.context.meshScenes.get(viewport), vertices = original.vertices;
	const clears = t.mock.method(original.pixels, 'fill');
	for (let frame = 0; frame < 100; frame++) { f.draw(viewport); assert.equal(f.context.meshScenes.get(viewport), original); }
	assert.equal(clears.mock.callCount(), 0, 'idle commands composite the retained 3D target without rerasterizing');
	viewport.changed(); f.draw(viewport);
	assert.equal(clears.mock.callCount(), 1); assert.equal(original.vertices, vertices);
	viewport.resize(4, 4); f.draw(viewport);
	const resized = f.context.meshScenes.get(viewport);
	assert.notEqual(resized, original); assert.equal(original.pixels.length, 0); assert.equal(original.depth.length, 0);
	assert.equal(resized.pixels.length, 4 * 4 * 4);
	viewport.dispose(); assert.equal(resized.pixels.length, 0); assert.equal(resized.depth.length, 0);
	const remaining = scene(); const target = f.context.meshScenes.get(remaining);
	t.after(() => {
		assert.equal(target.pixels.length, 0); assert.equal(target.depth.length, 0);
		remaining.dispose();
	});
});

test('software scene commands preserve transformed clip mapping and ordered overlays without sharing depth', t => {
	const f = fixture(t, 16, 16), viewport = scene({ ...IDENTITY, mesh: mesh([-1, -1, 0.9, 1, -1, 0.9, -1, 1, 0.9], 0xffff0000) });
	const { context, pixels } = f;
	beginHeadlessHost2D(context, pixels, 16, 16);
	const fill = (color: number) => renderHeadlessHost2DEntry(context, Host2DKind.Rect,
		{ area: { left: 0, top: 0, right: 16, bottom: 16, z: 0 }, kind: RectRenderKind.Fill, color, layer: LAYER_2D_IDE });
	fill(0xff00ff00);
	renderHeadlessHost2DEntry(context, Host2DKind.Transform, { scale: 2, offsetX: 2, offsetY: 2 });
	renderHeadlessHost2DEntry(context, Host2DKind.Clip, { left: 4, top: 4, right: 12, bottom: 12 });
	renderHeadlessHost2DEntry(context, Host2DKind.MeshScene, { scene: viewport, left: 0, top: 0, right: 4, bottom: 4 });
	assert.deepEqual(pixel(pixels, 4, 8, 16), [255, 0, 0, 255]);
	assert.deepEqual(pixel(pixels, 3, 8, 16), [0, 255, 0, 255]);
	assert.deepEqual(pixel(pixels, 8, 4, 16), [0, 255, 0, 255], 'transparent scene pixels retain preceding UI color');
	fill(0xff0000ff);
	assert.deepEqual(pixel(pixels, 4, 8, 16), [0, 0, 255, 255], 'later UI is not tested against scene depth');
	assert.deepEqual(pixel(pixels, 3, 8, 16), [0, 255, 0, 255], 'the existing scissor still bounds later UI');
});
