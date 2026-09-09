import assert from 'node:assert/strict';
import test from 'node:test';
import { HostOverlayClipState, type HostOverlayClipRect } from '../../machine/ts/render/host_overlay/clip';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { hostOverlayPrimitives } from '../helpers/host_overlay_primitives';

const full = { left: 0, top: 0, right: 64, bottom: 48 };
const clip = { left: 11, top: 9, right: 43, bottom: 34 };

test('host scissor maps logical coordinates once, bounds the target and preserves empty intersections', () => {
	const state = new HostOverlayClipState();
	state.reset(64, 48, 160, 120);
	state.set(clip);
	assert.deepEqual([state.left, state.top, state.right, state.bottom], [27, 22, 107, 85]);
	state.set({ left: -30, top: -20, right: 100, bottom: 100 });
	assert.deepEqual([state.left, state.top, state.right, state.bottom], [0, 0, 160, 120]);
	state.set({ left: 80, top: 30, right: 90, bottom: 20 });
	assert.deepEqual([state.left, state.top, state.right, state.bottom], [160, 75, 160, 75]);
	state.reset(64, 48, 64, 48);
	assert.deepEqual([state.left, state.top, state.right, state.bottom], [0, 0, 64, 48]);
});

test('nested clip publication does not alias a reused stack depth or the next frame', () => {
	const { presenter, queue, renderer } = createHostOverlayFixture(64, 48);
	const draw = () => {
		renderer.beginFrame(presenter);
		renderer.pushClipRect(-2, 5, 50, 40);
		renderer.pushClipRect(10, 0, 60, 30);
		renderer.popClipRect();
		renderer.pushClipRect(20, 8, 30, 12);
		renderer.popClipRect();
		renderer.popClipRect();
		renderer.endFrame();
		return queue.consumeOverlayFrame();
	};
	const frame = draw();
	assert.deepEqual(frame.commandRefs.slice(0, frame.commandCount), [
		{ left: 0, top: 5, right: 50, bottom: 40 },
		{ left: 10, top: 5, right: 50, bottom: 30 },
		{ left: 0, top: 5, right: 50, bottom: 40 },
		{ left: 20, top: 8, right: 30, bottom: 12 },
		{ left: 0, top: 5, right: 50, bottom: 40 }, full,
	]);
	const refs = frame.commandRefs.slice(0, frame.commandCount);
	const next = draw();
	assert.notEqual(frame.commandRefs, next.commandRefs);
	assert.deepEqual(frame.commandRefs.slice(0, frame.commandCount), refs);
	const reused = draw();
	for (let index = 0; index < refs.length; index += 1) assert.equal(reused.commandRefs[index], refs[index]);
});

test('quad batches split only at a changed clip with preceding geometry and retain their storage', () => {
	const stream = new HostOverlayQuadStream();
	const rect = { kind: RectRenderKind.Fill, area: { ...full, z: 0 }, color: 0xffffffff, layer: LAYER_2D_IDE };
	const draw = () => {
		stream.reset(64, 48);
		stream.appendEntry(Host2DKind.Rect, rect);
		stream.appendEntry(Host2DKind.Clip, clip);
		stream.appendEntry(Host2DKind.Clip, { ...clip });
		stream.appendEntry(Host2DKind.Rect, rect);
		stream.appendEntry(Host2DKind.Clip, full);
		stream.appendEntry(Host2DKind.Rect, rect);
	};
	draw();
	assert.equal(stream.batchCount, 3);
	assert.deepEqual(stream.batches.map(batch => batch.start), [0, 1, 2]);
	const batches = stream.batches.slice();
	const floats = stream.floatData;
	for (let frame = 0; frame < 100; frame += 1) draw();
	assert.equal(stream.floatData, floats);
	for (let index = 0; index < batches.length; index += 1) assert.equal(stream.batches[index], batches[index]);
});


for (const [name, kind, command] of hostOverlayPrimitives) {
	test(`software ${name}: clipping crops the original raster and never repositions geometry or UVs`, () => {
		const { backend } = createHostOverlayFixture(64, 48);
		const context = backend.hostOverlayContext;
		const target = backend.framebufferPixels;
		const draw = (bounds: HostOverlayClipRect) => {
			target.fill(0);
			beginHeadlessHost2D(context, target, 64, 48);
			renderHeadlessHost2DEntry(context, Host2DKind.Clip, bounds);
			renderHeadlessHost2DEntry(context, kind, command);
		};
		draw(full);
		const reference = target.slice();
		draw(clip);
		let lit = 0;
		for (let y = 0; y < 48; y += 1) {
			for (let x = 0; x < 64; x += 1) {
				const inside = x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom;
				for (let channel = 0; channel < 4; channel += 1) {
					const offset = (y * 64 + x) * 4 + channel;
					assert.equal(target[offset], inside ? reference[offset] : 0, `${name}: ${x},${y}:${channel}`);
					lit += target[offset] !== 0 ? 1 : 0;
				}
			}
		}
		assert.ok(lit > 0, 'fixture must contain partially visible pixels');
		beginHeadlessHost2D(context, target, 64, 48);
		assert.equal(context.clip.right, 64, 'a new lane resets its scissor');
	});
}
