import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { GxGpuSoftwareState } from '../../machine/ts/render/backend/software/gx_gpu_state';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { GX_GPU_PSMGX16 } from '../../machine/ts/machine/devices/gx/gpu_local_memory';
import { cartridgeSlots } from './cartridge';

/** Same projected model packets as gx_gpu_textured_gles2_test.cpp, not a gameplay cart. */
export async function renderTexturedModelCase(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu') {
	const vramBytes = PSX_MACHINE_SPEC.gxGpuVramBytes, width = 256, height = 256;
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, vramBytes) : undefined;
	const gl = kind === 'webgl2' ? createWebGLBackend(canvas, vramBytes) : undefined;
	const backend: GPUBackend = gpu === undefined ? gl! : gpu;
	const gpuErrors: string[] = [];
	gpu?.device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message)); gpu?.device.pushErrorScope('validation');
	const presenter = new VideoPresenter(new BrowserVideoOutput(canvas, null, 'fit'), backend, width, height);
	const library = new RenderPassLibrary(backend, presenter);
	const target = backend.createColorTexture({ width, height });
	const framebuffer = gl === undefined ? null : gl.createRenderTarget(target, null);
	const state = { width, height, targetColorTex: target }; library.setState('gx_gpu', state);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices(); machine.gxGpu.replaceVramSnapshotBytes(new Uint8Array(vramBytes));
	for (const [index, word] of [[0, 0x0000ff21], [2, (16 << 9) | (GX_GPU_PSMGX16 << 15)], [4, 3 << 23], [5, 1023 | (255 << 12)]])
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(index), word);
	for (const word of [
		0xe3000000, 0xe407ffff, 0xe5000000,
		0xa0000000, 0x01000200, 0x00010004, 0x03e0001f, 0x00007c00,
		0x24808080, 0x00480008, 0, 0x00480048, 0x01180003, 0x00080008, 0,
		0x25010203, 0x00480068, 0, 0x004800a8, 0x01180003, 0x00080068, 0,
	]) {
		machine.gxGpu.writeGp0(word);
		machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
		machine.gxGpu.onService(machine.scheduler.currentNowCycles());
	}
	machine.gxGpu.presentReadyFrameOnVblankEdge();
	const output = machine.gxGpu.readDeviceOutput(), software = new GxGpuSoftwareState(vramBytes, width * height);
	const pixels = new Uint32Array(width * height); renderGxGpuSoftwareFrame(software, state, output, pixels);
	library.execute('gx_gpu', framebuffer, output);
	const expected = new Uint8Array(pixels.buffer), actual = await backend.readColorTexture(target, width, height);
	const difference = actual.findIndex((value, index) => value !== expected[index]);
	const samples = [0, 96].flatMap(dx => [12, 32, 52, 69].map(x => {
		const at = (71 * width + x + dx) * 4;
		return { software: Array.from(expected.subarray(at, at + 4)), gpu: Array.from(actual.subarray(at, at + 4)) };
	}));
	const commands = output.commandBuffer.presentCommandCount;
	// Observe transfers at the real API boundary, not through production test
	// counters. Snapshot bytes remain a complete little-endian VRAM image even
	// when a checkpoint reads only a small, padded, nonzero-origin rectangle.
	const transfers: number[][] = [];
	let observingSnapshots = true;
	if (gl !== undefined) {
		const readPixels = gl.gl.readPixels.bind(gl.gl);
		gl.gl.readPixels = (...args: any[]) => {
			if (observingSnapshots) transfers.push(args.slice(0, 4));
			(readPixels as (...args: any[]) => void)(...args);
		};
	} else {
		const prototype = Object.getPrototypeOf(gpu!.device.createCommandEncoder());
		const copy = prototype.copyTextureToBuffer;
		prototype.copyTextureToBuffer = function (source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyBufferInfo, extent: GPUExtent3DDict) {
			if (observingSnapshots) {
				const origin = source.origin as GPUOrigin3DDict;
				transfers.push([origin.x!, origin.y!, extent.width, extent.height!]);
			}
			copy.call(this, source, destination, extent);
		};
	}
	const snapshotDifferences: number[] = [];
	const snapshotWords: number[] = [];
	for (let phase = 0; phase < 2; ++phase) {
		if (phase !== 0) {
			machine.gxGpu.writeGp1(0x09000001);
			for (const word of [0xe40fffff, 0x6000ff00, (901 << 16) | 197, (2 << 16) | 3]) {
				machine.gxGpu.writeGp0(word);
				machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
				machine.gxGpu.onService(machine.scheduler.currentNowCycles());
			}
			machine.gxGpu.presentReadyFrameOnVblankEdge();
			const next = machine.gxGpu.readDeviceOutput();
			renderGxGpuSoftwareFrame(software, state, next, pixels);
			library.execute('gx_gpu', framebuffer, next);
		}
		await backend.captureGxGpuVramSnapshot(machine.gxGpu);
		const bytes = machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
		const changedWordAt = (901 * 1024 + 197) * 2;
		snapshotWords.push(bytes[changedWordAt] | (bytes[changedWordAt + 1] << 8));
		snapshotDifferences.push(bytes.findIndex((value, index) =>
			value !== ((software.vram[index >>> 1] >>> ((index & 1) * 8)) & 255)));
		await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	}
	const replacement = new Uint8Array(vramBytes);
	for (let index = 0; index < replacement.length; ++index) replacement[index] = index * 37 + (index >>> 10);
	machine.gxGpu.replaceVramSnapshotBytes(replacement);
	await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	snapshotDifferences.push(machine.gxGpu.readDeviceOutput().vramSnapshotBytes.findIndex((value, index) => value !== replacement[index]));
	observingSnapshots = false;
	let sampleCopies = 0;
	if (gl !== undefined) {
		const copy = gl.gl.copyTexSubImage2D.bind(gl.gl);
		gl.gl.copyTexSubImage2D = (...args: Parameters<typeof copy>) => { ++sampleCopies; copy(...args); };
	} else {
		const prototype = Object.getPrototypeOf(gpu!.device.createCommandEncoder());
		const copy = prototype.copyTextureToTexture;
		prototype.copyTextureToTexture = function (...args: any[]) { ++sampleCopies; copy.apply(this, args); };
	}
	const adjacentCopies: number[] = [], adjacentDifferences: number[] = [];
	for (let phase = 0; phase < 3; ++phase) {
		const before = sampleCopies;
		// The framebuffer ends immediately before its font page. Touching the
		// geometric right edge does not write a texel in that page. A deliberate
		// write into the page in the final phase must still synchronize it.
		const words = [0xe1000005, 0x600000ff, 0, (240 << 16) | 320];
		if (phase === 2) words.push(0x6000ff00, 320, 0x00010001);
		words.push(0x65808080, (120 << 16) | 16, (20 | (24 << 6)) << 16, 0x00080008);
		for (const word of words) {
			machine.gxGpu.writeGp0(word);
			machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
			machine.gxGpu.onService(machine.scheduler.currentNowCycles());
		}
		machine.gxGpu.presentReadyFrameOnVblankEdge();
		const next = machine.gxGpu.readDeviceOutput();
		renderGxGpuSoftwareFrame(software, state, next, pixels);
		library.execute('gx_gpu', framebuffer, next);
		const rendered = await backend.readColorTexture(target, width, height);
		adjacentDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		adjacentCopies.push(sampleCopies - before);
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	if (framebuffer !== null) gl!.destroyRenderTarget(framebuffer);
	backend.destroyTexture(target); library.dispose(); gpu?.device.destroy();
	return { kind, difference, samples, validationError, glError, gpuErrors, commands, transfers, snapshotDifferences, snapshotWords, adjacentCopies, adjacentDifferences };
}
