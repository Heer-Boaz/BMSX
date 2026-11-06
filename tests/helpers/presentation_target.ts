import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from './cartridge';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';

/** Real browser presentation and workspace sizing, without a cart or UI model. */
export async function renderPresentationTarget(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu') {
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const backend: GPUBackend = gpu === undefined ? gl! : gpu;
	if (gpu !== undefined) gpu.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const errors: string[] = [];
	gpu?.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	gpu?.device.pushErrorScope('validation');
	const video = new BrowserVideoOutput(canvas, null, 'fit');
	video.refreshLayout();
	const presenter = new VideoPresenter(video, backend, 16, 12);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes), {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const output = machine.gxGpu.readDeviceOutput();
	output.pcrtcScanout.backgroundColor = 0x00332211;
	output.pcrtcScanout.revision += 1;
	let scale = 3, allocations = 0, reads = 0;
	const resize = backend.resizePresentationTarget.bind(backend), measure = canvas.getBoundingClientRect.bind(canvas);
	backend.resizePresentationTarget = (width, height) => { allocations++; resize(width, height); };
	canvas.getBoundingClientRect = () => { reads++; return measure(); };
	video.workspace.open(({ width, height, pixelWidth, pixelHeight }) => {
		presenter.setFixedRenderTargetSize(pixelWidth, pixelHeight, Math.trunc(width / scale), Math.trunc(height / scale));
	});
	video.prepareFrame(); presenter.configurePresentation('completed', true); presenter.present(output, 0, 0); video.finishFrame();
	const before = { bounds: { ...video.measureDisplay() }, allocated: { ...presenter.canvasSize }, allocations, reads };
	// Preference callbacks happen outside the rendering frame. Their requests
	// must not clear the old canvas or publish a different transform before draw.
	for (const value of [2, 1, 2]) { scale = value; video.workspace.refresh(); }
	const pending = { bounds: { ...video.measureDisplay() }, allocated: { ...presenter.canvasSize },
		selected: { ...presenter.viewportSize }, backing: [canvas.width, canvas.height], allocations, reads };
	video.prepareFrame(); presenter.configurePresentation('completed', false); presenter.present(output, 0, 0); video.finishFrame();
	const drawn = { allocated: { ...presenter.canvasSize }, backing: [canvas.width, canvas.height], allocations,
		logical: [video.geometry.viewportWidth, video.geometry.viewportHeight], reads };
	const history = await presenter.captureGameFrame();
	// A monitor change increases only raster density, at the same logical layout.
	video.workspace.layout(48, 36, 2);
	const densityPending = { allocations, backing: [canvas.width, canvas.height] };
	presenter.present(output, 0, 0); video.finishFrame();
	const density = { allocations, backing: [canvas.width, canvas.height],
		logical: [video.geometry.viewportWidth, video.geometry.viewportHeight],
		bounds: { ...video.measureDisplay() } };
	let pixel: number[];
	if (gpu !== undefined) {
		pixel = Array.from((await gpu.readColorTexture(gpu.context.getCurrentTexture(), canvas.width, canvas.height)).subarray(0, 4));
	} else {
		const bytes = new Uint8Array(4);
		gl!.gl.readPixels(0, 0, 1, 1, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, bytes);
		pixel = Array.from(bytes);
	}
	const overlay = new OverlayRenderer(presenter.hostOverlayQueue, { width: 4, height: 3 });
	const frames: number[][] = [];
	for (const menu of [false, true]) {
		overlay.beginFrame(); overlay.pushClipRect(1, 1, 3, 2);
		overlay.pushTransform({ scale: 0.5, offsetX: 1, offsetY: 0.5 });
		overlay.fillRect(0, 0, 4, 3, 0, 0xffffffff, 0);
		overlay.popTransform(); overlay.popClipRect(); overlay.endFrame();
		if (menu) presenter.hostOverlayQueue.publishHostMenuFrame(presenter.hostOverlayQueue.consumeOverlayFrame());
		presenter.setFixedRenderTargetSize(12, 12, 12, 12);
		presenter.present(output, 0, 0);
		if (gpu !== undefined) frames.push(Array.from(await gpu.readColorTexture(gpu.context.getCurrentTexture(), 12, 12)));
		else {
			const bytes = new Uint8Array(12 * 12 * 4);
			gl!.gl.readPixels(0, 0, 12, 12, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, bytes);
			// Normalize GL's framebuffer origin, as native capture does.
			const topDown = new Uint8Array(bytes.length);
			for (let y = 0; y < 12; y++) topDown.set(bytes.subarray((11 - y) * 48, (12 - y) * 48), y * 48);
			frames.push(Array.from(topDown));
		}
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	presenter.dispose(); video.dispose(); gpu?.device.destroy();
	return { before, pending, drawn, densityPending, density, history: [history.width, history.height], pixel, frames, validationError, glError, errors };
}
