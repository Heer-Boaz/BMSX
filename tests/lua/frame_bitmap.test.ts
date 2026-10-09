import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { HostBitmap, HostBitmapTextures } from '../../machine/ts/render/host_overlay/bitmap';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';
import type { RgbaImage } from '../../machine/ts/render/image';

test('completed pixels and their physical position are retained together, not borrowed from the producer', () => {
	const output = new FrameBitmap(), pixels = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
	const frame = { presentationSequence: 1, cycles: 400, videoTick: 3 };
	output.publish(pixels, 2, 1, frame);
	const bitmap = output.bitmap!, storage = bitmap.image.pixels;
	assert.notEqual(storage, pixels);
	pixels.fill(88); frame.cycles = 800;
	assert.deepEqual([...storage], [10, 20, 30, 255, 40, 50, 60, 255]);
	assert.equal(output.published.cycles, 400);
	output.publish(pixels, 2, 1, frame);
	assert.equal(output.bitmap, bitmap); assert.equal(bitmap.image.pixels, storage);
	assert.equal(bitmap.revision, 1); assert.ok(storage.every(byte => byte === 88));
	assert.equal(output.published.cycles, 800);
	output.publish(new Uint8Array(16), 2, 2, { presentationSequence: 2, cycles: 100, videoTick: 1 });
	assert.notEqual(bitmap.image.pixels, storage);
	assert.deepEqual([bitmap.image.width, bitmap.image.height], [2, 2]);
	assert.equal(output.published.cycles, 100, 'restored frames can move backwards in physical time');
	let retired = 0; bitmap.onDispose(() => retired++);
	output.dispose(); assert.equal(retired, 1); assert.equal(output.bitmap, undefined);
});

test('backend textures update once per observed revision, resize explicitly and release their current storage', () => {
	const uploads: number[] = [], destroyed: number[] = [];
	let next = 0;
	const texturePixels = new Map<number, Uint8Array>();
	const textures = new HostBitmapTextures((image: RgbaImage) => {
		const texture = ++next; texturePixels.set(texture, image.pixels.slice()); uploads.push(texture); return texture;
	}, (texture, image) => { texturePixels.get(texture)!.set(image.pixels); uploads.push(texture); }, texture => {
		destroyed.push(texture); texturePixels.delete(texture);
	});
	const bitmap = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) });
	assert.equal(textures.get(bitmap), 1);
	for (let repaint = 0; repaint < 100; repaint++) assert.equal(textures.get(bitmap), 1);
	assert.equal(uploads.length, 1);
	bitmap.update(new Uint8Array([4, 5, 6, 255]), 1, 1);
	bitmap.update(new Uint8Array([7, 8, 9, 255]), 1, 1);
	assert.equal(textures.get(bitmap), 1); assert.deepEqual([...texturePixels.get(1)!], [7, 8, 9, 255]);
	assert.deepEqual(uploads, [1, 1], 'unseen intermediate revisions do not need uploads');
	bitmap.update(new Uint8Array(8).fill(24), 2, 1);
	assert.equal(textures.get(bitmap), 2); assert.deepEqual(destroyed, [1]);
	bitmap.dispose(); assert.deepEqual(destroyed, [1, 2]);
	textures.dispose(); assert.deepEqual(destroyed, [1, 2]);
	const other = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array(4) });
	textures.get(other); textures.dispose(); other.dispose();
	assert.deepEqual(destroyed, [1, 2, 3], 'backend teardown detaches resource listeners');
});

test('the software overlay reads the accepted bitmap revision, not unaccepted producer pixels', () => {
	const { presenter, backend, renderer } = createHostOverlayFixture(4, 3);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const system = linkTestSystemBlua32(compileLuaSource('return nil', 'frame_bitmap', 0));
	const target = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
	const output = new FrameBitmap(), pixels = new Uint8Array([11, 22, 33, 255]);
	output.publish(pixels, 1, 1, { presentationSequence: 1, cycles: 0, videoTick: 0 });
	const paint = () => {
		renderer.beginFrame(presenter); renderer.drawBitmap(output.bitmap!, 0, 0, 4, 3); renderer.endFrame();
		presenter.configurePresentation('completed', false);
		presenter.present(target.runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
	};
	paint(); assert.ok(backend.framebufferWords.every(word => word === 0xff21160b));
	pixels.set([44, 55, 66, 255]);
	paint(); assert.ok(backend.framebufferWords.every(word => word === 0xff21160b));
	output.publish(pixels, 1, 1, { presentationSequence: 2, cycles: 1, videoTick: 1 });
	paint(); assert.ok(backend.framebufferWords.every(word => word === 0xff42372c));
	output.dispose(); target.dispose(); presenter.dispose();
});

test('offscreen output publishes only actual completed presentations, never held repaints or late subscriptions', t => {
	const system = linkTestSystemBlua32(compileLuaSource('return nil', 'frame_bitmap', 0));
	const target = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
	t.after(() => target.dispose());
	const scanout = target.runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout;
	scanout.backgroundColor = 0x00332211;
	target.presentation.requestRestoredPresentation(); target.present();
	const output = target.frameOutput;
	assert.equal(output.bitmap, undefined, 'subscription is not a screenshot of mutable existing output');
	target.presentation.requestHeldPresentation(); target.present();
	assert.equal(output.bitmap, undefined, 'a held frame cannot backfill metadata for an earlier image');
	target.presentation.requestRestoredPresentation(); assert.equal(target.present(), true);
	assert.deepEqual(output.published, target.presentation.gameFrame);
	const bitmap = output.bitmap!, storage = bitmap.image.pixels, position = { ...output.published };
	const revision = bitmap.revision;
	assert.deepEqual([...storage.subarray(0, 4)], [0x11, 0x22, 0x33, 255]);
	scanout.backgroundColor = 0x00665544;
	for (let repaint = 0; repaint < 5; repaint++) { target.presentation.requestHeldPresentation(); target.present(); }
	assert.deepEqual(output.published, position); assert.equal(bitmap.revision, revision);
	assert.equal(bitmap.image.pixels, storage);
	assert.deepEqual([...storage.subarray(0, 4)], [0x11, 0x22, 0x33, 255]);
	target.presentation.requestRestoredPresentation(); target.present();
	assert.equal(bitmap.revision, revision + 1); assert.equal(bitmap.image.pixels, storage);
	assert.deepEqual([...storage.subarray(0, 4)], [0x44, 0x55, 0x66, 255]);
	assert.deepEqual(output.published, target.presentation.gameFrame);
	target.dispose(); assert.equal(output.bitmap, undefined);
});
