import { FrameBitmap } from '../../../hosts/common/frame_bitmap';
import { OffscreenMachine } from '../../../hosts/common/offscreen_machine';
import { OffscreenVideoOutput } from '../../../hosts/common/offscreen_video_output';
import { TestInput } from '../../../ide/testing/input';
import { OverlayRenderer } from '../../../ide/runtime/overlay_renderer';
import type { GPUBackend } from '../../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../../machine/ts/render/backend/pass/library';
import { VideoPresenter } from '../../../machine/ts/render/video_presenter';
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
	return {
		async paint() {
			overlay.beginFrame(presenter); overlay.drawBitmap(frames.bitmap!, 0, 0, 16, 8); overlay.endFrame();
			presenter.configurePresentation('completed', false);
			presenter.present(target.runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
			await renderer.finish();
			return uploads;
		},
		mutateProducer() { pixels.set([0, 0, 255, 255, 255, 255, 0, 255]); },
		publish() { frames.publish(pixels, 2, 1, { presentationSequence: 2, cycles: 20, videoTick: 2 }); },
		resize() { frames.publish(new Uint8Array([0, 255, 255, 255, 255, 0, 255, 255]), 1, 2, { presentationSequence: 3, cycles: 30, videoTick: 3 }); },
		dispose() { frames.dispose(); target.dispose(); presenter.dispose(); },
	};
}
