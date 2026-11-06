import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from './cartridge';
import { createHostOverlayFixture } from './host_overlay';

/** Pixel integrity, not a UI snapshot: fractional layout cannot drop bitmap-font rows. */
export async function renderHostFontCases(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu') {
	const width = 256, height = 160;
	canvas.width = width; canvas.height = height;
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const backend = gpu === undefined ? gl! : gpu;
	backend.resizePresentationTarget(width, height);
	if (gpu !== undefined) gpu.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const errors: string[] = [];
	gpu?.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	gpu?.device.pushErrorScope('validation');
	const presenter = new VideoPresenter(new OffscreenVideoOutput(width, height), backend, width, height);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes), {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const output = machine.gxGpu.readDeviceOutput();
	const renderer = new OverlayRenderer(presenter.hostOverlayQueue, { width, height });
	const fonts = [new Font({ variant: 'tiny' }), new Font({ variant: 'msx' }),
		new Font({ variant: 'tiny', style: 'italic' }), new Font({ variant: 'msx', style: 'italic' })];
	const draw = (renderer: OverlayRenderer, phaseX: number, phaseY: number) => {
		renderer.beginFrame(); renderer.fillRect(0, 0, width, height, 0, 0xff000000, 0);
		for (let column = 0; column < fonts.length; column++) {
			const left = column * 64;
			renderer.pushClipRect(left + 2, 0, left + 57, height - 3);
			const text = 'True\tgy\nfalse';
			for (let row = 0; row < 7; row++) renderer.itemRun(text, 0, text.length,
				left + 1 + phaseX, 1 + row * 24 + phaseY, 0, fonts[column], 0xffffffff, 0);
			renderer.popClipRect();
		}
		renderer.endFrame();
	};
	const software = createHostOverlayFixture(width, height);
	draw(software.renderer, 0, 0);
	const frame = software.queue.consumeOverlayFrame();
	beginHeadlessHost2D(software.backend.hostOverlayContext, software.backend.framebufferPixels, width, height, width, height);
	for (let index = 0; index < frame.commandCount; index++)
		renderHeadlessHost2DEntry(software.backend.hostOverlayContext, frame.commandKinds[index], frame.commandRefs[index]);
	const reference = software.backend.framebufferPixels;
	const cases: { phaseX: number; phaseY: number; differences: number; firstDifference: number }[] = [];
	for (const [phaseX, phaseY] of [[0, 0], [0.25, 0.25], [0.5, 0], [0, 0.5], [0.5, 0.5], [0.75, 0.75]]) {
		draw(renderer, phaseX, phaseY); presenter.present(output, 0, 0);
		let pixels: Uint8Array;
		if (gpu !== undefined) pixels = await gpu.readColorTexture(gpu.context.getCurrentTexture(), width, height);
		else {
			const raw = new Uint8Array(width * height * 4);
			gl!.gl.readPixels(0, 0, width, height, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, raw);
			pixels = new Uint8Array(raw.length);
			for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
		}
		let differences = 0, firstDifference = -1;
		for (let index = 0; index < pixels.length; index++) if (pixels[index] !== reference[index]) {
			if (firstDifference === -1) firstDifference = index;
			differences++;
		}
		cases.push({ phaseX, phaseY, differences, firstDifference });
	}
	const smoothFonts = [new Font({ variant: 'tiny', sampling: 'linear' }), new Font({ variant: 'msx', sampling: 'linear' }),
		new Font({ variant: 'tiny', style: 'italic', sampling: 'linear' }), new Font({ variant: 'msx', style: 'italic', sampling: 'linear' })];
	const sampling: { scale: number; maxError: number; imageDifferences: number; fractional: number }[] = [];
	for (const scale of [1, 1.5, 2, 3, 3.75]) {
		const drawCoverage = (renderer: OverlayRenderer) => {
			renderer.beginFrame(); renderer.fillRect(0, 0, width, height, 0, 0xff000000, 0);
			for (let i = 0; i < smoothFonts.length; i++) {
				const left = i * 64, font = smoothFonts[i];
				renderer.pushClipRect(left + 3, 4, left + 60, height - 4);
				renderer.pushTransform({ scale, offsetX: left + 2.25, offsetY: 4.5 });
				renderer.itemRun('Ag\nm', 0, 4, 1, 1, 0, font, 0x80ff0000, 0);
				renderer.popTransform();
				// The same atlas entry drawn as an ordinary image must remain nearest.
				renderer.pushTransform({ scale: 3, offsetX: left + 8, offsetY: 120 });
				renderer.spriteColorized(font.getGlyph('A').imgid, 0, 0, 0, 0xffffffff, 0);
				renderer.popTransform();
				renderer.popClipRect();
			}
			renderer.endFrame();
		};
		drawCoverage(software.renderer);
		const frame = software.queue.consumeOverlayFrame();
		beginHeadlessHost2D(software.backend.hostOverlayContext, reference, width, height, width, height);
		for (let i = 0; i < frame.commandCount; i++) renderHeadlessHost2DEntry(software.backend.hostOverlayContext, frame.commandKinds[i], frame.commandRefs[i]);
		drawCoverage(renderer); presenter.present(output, 0, 0);
		let pixels: Uint8Array;
		if (gpu !== undefined) pixels = await gpu.readColorTexture(gpu.context.getCurrentTexture(), width, height);
		else {
			const raw = new Uint8Array(width * height * 4); pixels = new Uint8Array(raw.length);
			gl!.gl.readPixels(0, 0, width, height, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, raw);
			for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
		}
		let maxError = 0, imageDifferences = 0, fractional = 0;
		for (let i = 0; i < pixels.length; i++) {
			maxError = Math.max(maxError, Math.abs(pixels[i] - reference[i]));
			if (i >= 120 * width * 4 && pixels[i] !== reference[i]) imageDifferences++;
			if (i < 120 * width * 4 && i % 4 === 0 && pixels[i] > 0 && pixels[i] < 128) fractional++;
		}
		sampling.push({ scale, maxError, imageDifferences, fractional });
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	let ink = 0;
	for (let index = 0; index < reference.length; index += 4) if (reference[index] !== 0) ink++;
	presenter.dispose(); gpu?.device.destroy();
	return { cases, sampling, ink, validationError, glError, errors };
}
