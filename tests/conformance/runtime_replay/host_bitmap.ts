import { FrameBitmap } from '../../../hosts/common/frame_bitmap';
import { OffscreenMachine } from '../../../hosts/common/offscreen_machine';
import { OffscreenVideoOutput } from '../../../hosts/common/offscreen_video_output';
import { TestInput } from '../../../ide/testing/input';
import { OverlayRenderer } from '../../../ide/runtime/overlay_renderer';
import type { GPUBackend } from '../../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../../machine/ts/render/backend/pass/library';
import { VideoPresenter } from '../../../machine/ts/render/video_presenter';
import { HostBitmap, type HostBitmapRenderSubmission } from '../../../machine/ts/render/host_overlay/bitmap';
import type { HostOverlayClipRect } from '../../../machine/ts/render/host_overlay/clip';
import type { HostOverlayTransform } from '../../../machine/ts/render/host_overlay/transform';
import { LAYER_2D_IDE } from '../../../machine/ts/render/shared/layers';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

/** Actual overlay pipelines. This is a renderer conformance fixture, not Studio-only authoring. */
export async function createHostBitmapTest(kind: StudioRendererKind, canvas: HTMLCanvasElement) {
	const renderer = await createStudioRenderer(kind, canvas);
	const target = new OffscreenMachine(new Uint8Array(await (await fetch('/bios.rom')).arrayBuffer()), [null, null], PSX_MACHINE_SPEC, new TestInput());
	const backend: GPUBackend = renderer.backend;
	const presenter = new VideoPresenter(new OffscreenVideoOutput(16, 8), backend, 16, 8);
	backend.resizePresentationTarget(16, 8);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const overlay = new OverlayRenderer(presenter.hostOverlayQueue), frames = new FrameBitmap();
	const uploads = { creates: 0, updates: 0 };
	const create = backend.createTexture.bind(backend), update = backend.updateTexture.bind(backend);
	backend.createTexture = (...args) => { uploads.creates++; return create(...args); };
	backend.updateTexture = (...args) => { uploads.updates++; update(...args); };
	const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
	frames.publish(pixels, 2, 1, { presentationSequence: 1, cycles: 10, videoTick: 1 });
	const affineBitmap = new HostBitmap({ width: 4, height: 2, pixels: new Uint8Array([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
		0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
	]) });
	const alphaBitmap = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array([255, 128, 64, 128]) });
	return {
		async paint() {
			overlay.beginFrame(presenter); overlay.drawBitmap(frames.bitmap!, 0, 0, 16, 8); overlay.endFrame();
			presenter.configurePresentation('completed', false);
			presenter.present(target.runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
			await renderer.finish();
			return uploads;
		},
		async paintAffine(command: Omit<HostBitmapRenderSubmission, 'bitmap'>, clip?: HostOverlayClipRect,
			scopes: readonly HostOverlayTransform[] = [], alpha = false, adjacent?: Omit<HostBitmapRenderSubmission, 'bitmap'>) {
			overlay.beginFrame(presenter);
			overlay.fillRect(0, 0, 16, 8, 0, 0xff204060, LAYER_2D_IDE);
			for (const scope of scopes) overlay.pushTransform(scope);
			if (clip !== undefined) overlay.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
			overlay.drawBitmapAffine(alpha ? alphaBitmap : affineBitmap, command.originX, command.originY,
				command.axisXX, command.axisXY, command.axisYX, command.axisYY,
				command.u0, command.v0, command.u1, command.v1, command.color);
			if (adjacent !== undefined) overlay.drawBitmapAffine(alpha ? alphaBitmap : affineBitmap, adjacent.originX, adjacent.originY,
				adjacent.axisXX, adjacent.axisXY, adjacent.axisYX, adjacent.axisYY,
				adjacent.u0, adjacent.v0, adjacent.u1, adjacent.v1, adjacent.color);
			if (clip !== undefined) overlay.popClipRect();
			for (let index = 0; index < scopes.length; index++) overlay.popTransform();
			overlay.endFrame();
			presenter.configurePresentation('completed', false);
			presenter.present(target.runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
			await renderer.finish();
			return uploads;
		},
		mutateProducer() { pixels.set([0, 0, 255, 255, 255, 255, 0, 255]); },
		publish() { frames.publish(pixels, 2, 1, { presentationSequence: 2, cycles: 20, videoTick: 2 }); },
		resize() { frames.publish(new Uint8Array([0, 255, 255, 255, 255, 0, 255, 255]), 1, 2, { presentationSequence: 3, cycles: 30, videoTick: 3 }); },
		dispose() { affineBitmap.dispose(); alphaBitmap.dispose(); frames.dispose(); target.dispose(); presenter.dispose(); },
	};
}
