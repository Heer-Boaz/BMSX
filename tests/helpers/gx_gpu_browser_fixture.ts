import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import type { GxGpuDeviceOutput } from '../../machine/ts/machine/devices/gx/device_output';
import { GX_GPU_PSMGX16 } from '../../machine/ts/machine/devices/gx/gpu_local_memory';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { GxGpuSoftwareState } from '../../machine/ts/render/backend/software/gx_gpu_state';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { cartridgeSlots } from './cartridge';

export type BrowserGxBackend = 'webgl2' | 'webgpu';

/** Own one guest GX and one real browser backend for the packet stream. */
export async function createBrowserGxFixture(canvas: HTMLCanvasElement, kind: BrowserGxBackend, vramBytes: number) {
	const width = 256, height = 256;
	const spec = { ...PSX_MACHINE_SPEC, gxGpuVramBytes: vramBytes };
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, vramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, vramBytes) : undefined;
	const backend: GPUBackend = gpu === undefined ? gl! : gpu;
	const gpuErrors: string[] = [];
	const pipelines: {
		label: string | undefined;
		vertex: GPUVertexState['constants'];
		fragment: GPUFragmentState['constants'];
	}[] = [];
	if (gpu !== undefined) {
		gpu.device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
		gpu.device.pushErrorScope('validation');
		const createRenderPipeline = gpu.device.createRenderPipeline;
		gpu.device.createRenderPipeline = function (descriptor) {
			pipelines.push({ label: descriptor.label, vertex: descriptor.vertex.constants, fragment: descriptor.fragment?.constants });
			return createRenderPipeline.call(this, descriptor);
		};
	}
	const video = new BrowserVideoOutput(canvas, null, 'fit');
	const presenter = new VideoPresenter(video, backend, width, height);
	const library = new RenderPassLibrary(backend, presenter);
	const target = backend.createColorTexture({ width, height });
	const framebuffer = gl === undefined ? null : gl.createRenderTarget(target, null);
	const state = { width, height, targetColorTex: target }; library.setState('gx_gpu', state);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, spec);
	machine.resetDevices(); machine.gxGpu.replaceVramSnapshotBytes(new Uint8Array(vramBytes));
	for (const [index, word] of [[0, 0x0000ff21], [2, (16 << 9) | (GX_GPU_PSMGX16 << 15)], [4, 3 << 23], [5, 1023 | (255 << 12)]])
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(index), word);
	const software = new GxGpuSoftwareState(vramBytes, width * height);
	const pixels = new Uint32Array(width * height);
	const softwareBytes = new Uint8Array(pixels.buffer);
	function render(output: GxGpuDeviceOutput) {
		renderGxGpuSoftwareFrame(software, state, output, pixels);
		library.execute('gx_gpu', framebuffer, output);
	}
	return {
		machine, backend, gpu, gl, software, pixels, softwareBytes, vramBytes, width, library, state, framebuffer,
		submit(words: readonly number[]) {
			for (const word of words) {
				machine.gxGpu.writeGp0(word);
				machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
				machine.gxGpu.onService(machine.scheduler.currentNowCycles());
			}
		},
		present() {
			machine.gxGpu.presentReadyFrameOnVblankEdge();
			return machine.gxGpu.readDeviceOutput();
		},
		render,
		captureColor(output: GxGpuDeviceOutput) {
			render(output);
			return backend.readColorTexture(target, width, height);
		},
		async finish() {
			const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
			const glError = gl === undefined ? 0 : gl.gl.getError();
			if (framebuffer !== null) gl!.destroyRenderTarget(framebuffer);
			backend.destroyTexture(target);
			library.dispose();
			video.dispose();
			gpu?.device.destroy();
			return { validationError, glError, gpuErrors, pipelines };
		},
	};
}

export type BrowserGxFixture = Awaited<ReturnType<typeof createBrowserGxFixture>>;
