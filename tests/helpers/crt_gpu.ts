import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../machine/ts/render/backend/texture_params';
import { crtNoiseTextureBytes, CRT_NOISE_WIDTH, CRT_NOISE_HEIGHT } from '../../machine/ts/render/post/crt/noise';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from './cartridge';

/** Exercise the real final-pass bindings, including changing frame phases. */
export async function renderCrtNoiseCases(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu') {
	const width = canvas.width = 320, height = canvas.height = 240;
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes) : undefined;
	const backend = gpu === undefined ? gl! : gpu;
	const gpuErrors: string[] = [];
	if (gpu !== undefined) {
		gpu.device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
		gpu.device.pushErrorScope('validation');
		gpu.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	}
	const presenter = new VideoPresenter(new BrowserVideoOutput(canvas, null, 'fit'), backend, width, height);
	const library = new RenderPassLibrary(backend, presenter);
	const state = library.getState('crt');
	state.width = state.srcWidth = width;
	state.height = state.srcHeight = height;
	const source = new Uint8Array(width * height * 4);
	for (let at = 0; at < source.length; at += 4) {
		source[at] = source[at + 1] = source[at + 2] = 128;
		source[at + 3] = 255;
	}
	state.colorTex = backend.createTexture(source, width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes), {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const noise = crtNoiseTextureBytes(), differences: number[] = [];
	for (const flags of [1, 3, 17]) for (const phase of [0, 49152, 131071]) {
		state.options.applyNoise = true;
		state.options.applyColorBleed = (flags & 2) !== 0;
		state.options.applyGlow = (flags & 16) !== 0;
		state.options.applyBlur = state.options.applyScanlines = state.options.applyFringing = state.options.applyAperture = false;
		state.options.noiseIntensity = 0.4;
		state.options.colorBleed = [0.02, 0, 0];
		state.options.glowColor = [0.12, 0.10, 0.09];
		state.noisePhase = phase;
		backend.beginFrame();
		const target = gpu?.context.getCurrentTexture();
		library.execute('crt', null, machine.gxGpu.readDeviceOutput());
		backend.endFrame();
		let pixels: Uint8Array;
		if (gpu !== undefined) pixels = await gpu.readColorTexture(target!, width, height);
		else {
			pixels = new Uint8Array(source.length);
			gl!.gl.readPixels(0, 0, width, height, gl!.gl.RGBA, gl!.gl.UNSIGNED_BYTE, pixels);
		}
		const color = [128 / 255, 128 / 255, 128 / 255];
		if (state.options.applyColorBleed) for (let c = 0; c < 3; ++c) color[c] += state.options.colorBleed[c];
		if (state.options.applyGlow) {
			const lum = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
			for (let c = 0; c < 3; ++c) color[c] += state.options.glowColor[c] * lum;
		}
		const lum = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
		let maximum = 0;
		for (let y = 0; y < height; ++y) for (let x = 0; x < width; ++x) {
			const at = (((y + (phase >>> 9)) & (CRT_NOISE_HEIGHT - 1)) * CRT_NOISE_WIDTH
				+ ((x + (phase & (CRT_NOISE_WIDTH - 1))) & (CRT_NOISE_WIDTH - 1))) * 4;
			const grain = (noise[at] / 255 - 0.5) * 0.65 + (noise[at + 1] / 255 - 0.5) * 0.35;
			const amplitude = grain * state.options.noiseIntensity * (1 - 0.8 * lum);
			for (let c = 0; c < 3; ++c) maximum = Math.max(maximum,
				Math.abs(pixels[(y * width + x) * 4 + c] - Math.round(color[c] * (1 + amplitude) * 255)));
		}
		differences.push(maximum);
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	backend.destroyTexture(state.colorTex); library.dispose(); gpu?.device.destroy();
	return { differences, gpuErrors, validationError, glError };
}
