import { createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { writeLE32 } from '../../machine/ts/common/endian';
import { gxGpuLocalMemoryAddress32 } from '../../machine/ts/machine/devices/gx/gpu_local_memory';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { GxGpuSoftwareState } from '../../machine/ts/render/backend/software/gx_gpu_state';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import {
	GX_GPU_PCRTC_DISPFB1_HIGH,
	GX_GPU_PCRTC_DISPFB1_LOW,
	GX_GPU_PCRTC_DISPFB2_HIGH,
	GX_GPU_PCRTC_DISPFB2_LOW,
	GX_GPU_PCRTC_DISPLAY1_HIGH,
	GX_GPU_PCRTC_DISPLAY1_LOW,
	GX_GPU_PCRTC_DISPLAY2_HIGH,
	GX_GPU_PCRTC_DISPLAY2_LOW,
	GX_GPU_PCRTC_PMODE_AMOD,
	GX_GPU_PCRTC_PMODE_EN1,
	GX_GPU_PCRTC_PMODE_EN2,
	GX_GPU_PCRTC_PMODE_LOW,
	GX_GPU_PCRTC_PMODE_MMOD,
	GX_GPU_PCRTC_SMODE2_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import { cartridgeSlots } from './cartridge';

export async function renderPcrtcBlendCases(canvas: HTMLCanvasElement) {
	const width = 2;
	const height = 2;
	const vramBytes = PSX_MACHINE_SPEC.gxGpuVramBytes;
	const adapter = (await navigator.gpu.requestAdapter())!;
	const backend = await createWebGPUBackend(canvas, adapter, vramBytes);
	const device = backend.device;
	const gpuErrors: string[] = [];
	device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
	device.pushErrorScope('validation');
	const presenter = new VideoPresenter(new BrowserVideoOutput(canvas, null, 'fit'), backend, width, height);
	const library = new RenderPassLibrary(backend, presenter);
	const target = device.createTexture({
		size: { width, height }, format: 'bgra8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
	});
	const state = { width, height, targetColorTex: target };
	library.setState('gx_gpu', state);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, {
		sampleInputControllerSnapshot() {},
		supervisorRequestLineHigh() { return false; },
		applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices();
	for (const [index, word] of [
		[GX_GPU_PCRTC_DISPFB1_LOW, 1 | (1 << 9)],
		[GX_GPU_PCRTC_DISPFB2_LOW, 2 | (1 << 9)],
		[GX_GPU_PCRTC_DISPFB1_HIGH, 0], [GX_GPU_PCRTC_DISPFB2_HIGH, 0],
		[GX_GPU_PCRTC_DISPLAY1_LOW, 3 << 23], [GX_GPU_PCRTC_DISPLAY2_LOW, 3 << 23],
		[GX_GPU_PCRTC_DISPLAY1_HIGH, 7 | (1 << 12)], [GX_GPU_PCRTC_DISPLAY2_HIGH, 7 | (1 << 12)],
	]) {
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(index), word);
	}
	const snapshot = new Uint8Array(vramBytes);
	for (let y = 0; y < height; y += 1) {
		writeLE32(snapshot, gxGpuLocalMemoryAddress32(4096, 1, 0, y) * 2, 0x400000ff);
		writeLE32(snapshot, gxGpuLocalMemoryAddress32(8192, 1, 0, y) * 2, 0xc8000000);
		writeLE32(snapshot, gxGpuLocalMemoryAddress32(4096, 1, 1, y) * 2, 0x403c78c8);
		writeLE32(snapshot, gxGpuLocalMemoryAddress32(8192, 1, 1, y) * 2, 0xc8b4280a);
	}
	machine.gxGpu.replaceVramSnapshotBytes(snapshot);
	const software = new GxGpuSoftwareState(vramBytes, width * height);
	const softwarePixels = new Uint32Array(width * height);
	const softwareBytes = new Uint8Array(softwarePixels.buffer);
	const cases: {
		smode2: number; amod: number; alpha: number; software: number[]; webgpu: number[];
	}[] = [];
	for (const smode2 of [0, 1, 3]) {
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE2_LOW), smode2);
		for (const amod of [0, GX_GPU_PCRTC_PMODE_AMOD]) {
			for (const alpha of [128, 0, 1, 64, 192, 254, 255, 128]) {
				memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW),
					GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD | amod | (alpha << 8));
				machine.gxGpu.presentReadyFrameOnVblankEdge();
				const output = machine.gxGpu.readDeviceOutput();
				for (let field = 0; field < (output.pcrtcScanout.interlaced ? 2 : 1); field += 1) {
					output.pcrtcScanout.setField(field);
					renderGxGpuSoftwareFrame(software, state, output, softwarePixels);
					library.execute('gx_gpu', null, output);
				}
				cases.push({ smode2, amod, alpha, software: Array.from(softwareBytes),
					webgpu: Array.from(await backend.readColorTexture(target, width, height)) });
			}
		}
	}
	await device.queue.onSubmittedWorkDone();
	const validationError = await device.popErrorScope();
	target.destroy();
	library.dispose();
	device.destroy();
	return { cases, gpuErrors, validationError: validationError?.message,
		adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } };
}
