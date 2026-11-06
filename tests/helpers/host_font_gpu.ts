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
import { createFontAtlasPair } from './host_font_atlas';
import { HOST_SYSTEM_ATLAS } from '../../machine/ts/render/host_overlay/atlas';
import { SCALABLE_FONT_ATLAS } from '../../machine/ts/render/host_overlay/scalable_font';

/** Pixel integrity, not a UI snapshot: fractional layout cannot drop bitmap-font rows. */
export async function renderHostFontCases(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu') {
	const width = 384, height = 160;
	canvas.width = width; canvas.height = height;
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const backend = gpu === undefined ? gl! : gpu;
	const atlasPairs = [createFontAtlasPair({ raster: 'bitmap', sampling: 'nearest' }),
		createFontAtlasPair({ raster: 'bitmap', sampling: 'linear' }), createFontAtlasPair({ raster: 'msdf', lineHeight: 3, distanceRange: 2 })];
	const atlasUploads = new Map([HOST_SYSTEM_ATLAS.pixels, SCALABLE_FONT_ATLAS.pixels,
		...atlasPairs.flatMap(pair => pair.map(font => font.atlas.pixels))].map(pixels => [pixels, 0]));
	const createTexture = backend.createTexture.bind(backend);
	backend.createTexture = (pixels, width, height, params) => {
		if (atlasUploads.has(pixels)) atlasUploads.set(pixels, atlasUploads.get(pixels)! + 1);
		return createTexture(pixels, width, height, params);
	};
	backend.resizePresentationTarget(width, height);
	if (gpu !== undefined) gpu.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const errors: string[] = [];
	gpu?.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	gpu?.device.pushErrorScope('validation');
	const presenter = new VideoPresenter(new OffscreenVideoOutput(width, height), backend, width, height);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	const bootAtlasUploads = [...atlasUploads.values()].reduce((sum, count) => sum + count, 0);
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
	const unusedScalableUploads = atlasUploads.get(SCALABLE_FONT_ATLAS.pixels);
	const sampling: { fontScale: number; density: number; scale: number; maxError: number; msdfError: number; msdfWorst: number[]; imageDifferences: number; fractional: number }[] = [];
	for (const fontScale of [0.5, 0.75, 1]) {
		const smoothFonts = [new Font({ variant: 'tiny', sampling: 'linear', scale: fontScale }), new Font({ variant: 'msx', sampling: 'linear', scale: fontScale }),
			new Font({ variant: 'tiny', style: 'italic', sampling: 'linear', scale: fontScale }), new Font({ variant: 'msx', style: 'italic', sampling: 'linear', scale: fontScale }),
			new Font({ variant: 'mono', scale: fontScale }), new Font({ variant: 'mono', style: 'italic', scale: fontScale })];
		for (const density of [1, 2]) for (const scale of [1, 1.5, 2, 3, 3.75]) {
			const drawCoverage = (renderer: OverlayRenderer) => {
				renderer.setViewportSize({ width: width / density, height: height / density });
				renderer.beginFrame();
				renderer.pushTransform({ scale: 1 / density, offsetX: 0, offsetY: 0 });
				renderer.fillRect(0, 0, width, height, 0, 0xff000000, 0);
				for (let i = 0; i < smoothFonts.length; i++) {
					const left = i * 64, font = smoothFonts[i];
					renderer.pushClipRect(left + 3, 4, left + 60, height - 4);
					// Keep fractional coverage samples away from half-open quad-edge ties:
					// SwiftShader Vulkan rounds geometry to 1/16 pixel, unlike the CPU path.
					renderer.pushTransform({ scale, offsetX: left + 2.25, offsetY: 4.25 });
					renderer.itemRun(font.raster === 'msdf' ? 'Ág\n€' : 'Ag\nm', 0, 4, 1.25, 1.5, 0, font, 0x80ff0000, 0);
					renderer.popTransform();
					// The same atlas entry drawn as an ordinary image must remain nearest.
					renderer.pushTransform({ scale: 3, offsetX: left + 8, offsetY: 120 });
					renderer.spriteColorized(fonts[i % fonts.length].getGlyph('A').imgid, 0, 0, 0, 0xffffffff, 0);
					renderer.popTransform();
					renderer.popClipRect();
				}
				renderer.popTransform();
				renderer.endFrame();
			};
			drawCoverage(software.renderer);
			const frame = software.queue.consumeOverlayFrame();
			beginHeadlessHost2D(software.backend.hostOverlayContext, reference, width, height, frame.logicalWidth, frame.logicalHeight);
			for (let i = 0; i < frame.commandCount; i++) renderHeadlessHost2DEntry(software.backend.hostOverlayContext, frame.commandKinds[i], frame.commandRefs[i]);
			drawCoverage(renderer); presenter.present(output, 0, 0);
			let pixels: Uint8Array;
			if (gpu !== undefined) pixels = await gpu.readColorTexture(gpu.context.getCurrentTexture(), width, height);
			else {
				const raw = new Uint8Array(width * height * 4); pixels = new Uint8Array(raw.length);
				gl!.gl.readPixels(0, 0, width, height, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, raw);
				for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
			}
			let msdfWorst: number[] = [];
			let maxError = 0, msdfError = 0, imageDifferences = 0, fractional = 0;
			for (let i = 0; i < pixels.length; i++) {
				const error = Math.abs(pixels[i] - reference[i]);
				if ((i >>> 2) % width >= 256) {
					if (error > msdfError) { msdfError = error; msdfWorst = [(i >>> 2) % width, Math.trunc((i >>> 2) / width), i % 4, reference[i], pixels[i]]; }
				}
				else maxError = Math.max(maxError, error);
				if (i >= 120 * width * 4 && pixels[i] !== reference[i]) imageDifferences++;
				if (i < 120 * width * 4 && i % 4 === 0 && pixels[i] > 0 && pixels[i] < 128) fractional++;
			}
			sampling.push({ fontScale, density, scale, maxError, msdfError, msdfWorst, imageDifferences, fractional });
		}
	}
	// Same ids, raster modes and glyph metrics are not texture identity. Alternate
	// two independently authored atlases, then repeat without another upload.
	renderer.setViewportSize({ width, height });
	for (let repeat = 0; repeat < 2; repeat++) {
		renderer.beginFrame(); renderer.fillRect(0, 0, width, height, 0, 0xff000000, 0);
		for (let row = 0; row < atlasPairs.length; row++) for (let column = 0; column < 3; column++) {
			const font = atlasPairs[row][column % 2];
			renderer.itemRun('A', 0, 1, 1 + column * 6, 1 + row * 6, 0, font, 0xffffffff, 0);
		}
		renderer.endFrame(); presenter.present(output, 0, 0);
	}
	const atlasPixels = gpu !== undefined ? await gpu.readColorTexture(gpu.context.getCurrentTexture(), width, height) : new Uint8Array(width * height * 4);
	if (gl !== undefined) gl.gl.readPixels(0, 0, width, height, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, atlasPixels);
	const atlasSamples: number[][] = [];
	for (let row = 0; row < atlasPairs.length; row++) for (let column = 0; column < 3; column++) {
		const ink: number[] = [];
		for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
			const py = 1 + row * 6 + y;
			ink.push(atlasPixels[((gl === undefined ? py : height - 1 - py) * width + 1 + column * 6 + x) * 4]);
		}
		atlasSamples.push(ink);
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	let ink = 0;
	for (let index = 0; index < reference.length; index += 4) if (reference[index] !== 0) ink++;
	presenter.dispose(); gpu?.device.destroy();
	return { cases, sampling, ink, validationError, glError, errors, atlasSamples, bootAtlasUploads, unusedScalableUploads,
		atlasUploads: [...atlasUploads.values()] };
}
