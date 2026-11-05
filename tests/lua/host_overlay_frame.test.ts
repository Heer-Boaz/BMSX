import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';

test('overlay frames snapshot the layout viewport, independently of the selected presentation target', () => {
	const { renderer, queue } = createHostOverlayFixture(16, 12);
	renderer.setViewportSize({ width: 4, height: 3 });
	renderer.beginFrame();
	renderer.pushClipRect(-1, -1, 20, 20);
	renderer.setViewportSize({ width: 8, height: 6 });
	renderer.popClipRect();
	renderer.endFrame();
	const frame = queue.consumeOverlayFrame();
	assert.deepEqual([frame.logicalWidth, frame.logicalHeight], [4, 3]);
	assert.deepEqual(frame.commandRefs.slice(0, frame.commandCount), [
		{ left: 0, top: 0, right: 4, bottom: 3 }, { left: 0, top: 0, right: 4, bottom: 3 },
	], 'clip intersection and root restoration use the same frame-local coordinate system');
	renderer.beginFrame();
	renderer.pushClipRect(-1, -1, 20, 20);
	renderer.endFrame();
	const next = queue.consumeOverlayFrame();
	assert.deepEqual([next.logicalWidth, next.logicalHeight], [8, 6]);
	assert.deepEqual([frame.logicalWidth, frame.logicalHeight], [4, 3], 'the queued frame never borrows mutable layout dimensions');
});

for (const lane of ['overlay', 'menu'] as const) test(`${lane} commands retain their coordinate system across a later target resize`, t => {
	const { presenter, backend, queue } = createHostOverlayFixture(4, 3);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	t.after(() => presenter.dispose());
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const frame: HostOverlayFrame = { logicalWidth: 4, logicalHeight: 3,
		commandKinds: [Host2DKind.Rect], commandRefs: [{ kind: RectRenderKind.Fill,
			area: { left: 0, top: 0, right: 4, bottom: 3, z: 0 }, color: 0xffffffff, layer: 0 }], commandCount: 1 };
	if (lane === 'overlay') queue.publishOverlayFrame(frame); else queue.publishHostMenuFrame(frame);
	presenter.setFixedRenderTargetSize(8, 6);
	presenter.present(runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
	assert.ok(backend.borrowPresentedPixels().every(value => value === 255), 'a full logical rectangle still covers the complete resized target');
});
