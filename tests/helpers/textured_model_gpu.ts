import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { Machine } from '../../machine/ts/machine/machine';
import { GxGpuCommandBuffer, GX_GPU_COMMAND_CAPACITY, GX_GPU_COMMAND_DRAW_LINE, GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_SKIPPED_LINE_NONE } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
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
export async function renderTexturedModelCase(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgpu', vramBytes = PSX_MACHINE_SPEC.gxGpuVramBytes, includeAliasCase = false) {
	const width = 256, height = 256;
	const spec = { ...PSX_MACHINE_SPEC, gxGpuVramBytes: vramBytes };
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
	}, spec);
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
	const sampleCopyRects: number[][] = [];
	if (gl !== undefined) {
		const copy = gl.gl.copyTexSubImage2D.bind(gl.gl);
		gl.gl.copyTexSubImage2D = (...args: Parameters<typeof copy>) => { ++sampleCopies; sampleCopyRects.push([args[2], args[3], args[6], args[7]]); copy(...args); };
	} else {
		const prototype = Object.getPrototypeOf(gpu!.device.createCommandEncoder());
		const copy = prototype.copyTextureToTexture;
		prototype.copyTextureToTexture = function (...args: any[]) {
			++sampleCopies;
			const origin = args[0].origin as GPUOrigin3DDict, extent = args[2] as GPUExtent3DDict;
			sampleCopyRects.push([origin.x!, origin.y!, extent.width, extent.height!]);
			copy.apply(this, args);
		};
	}
	const adjacentCopies: number[] = [], adjacentDifferences: number[] = [], adjacentCopyRects: number[][][] = [], adjacentPixel: number[][] = [];
	for (let phase = 0; phase < (includeAliasCase ? 6 : 3); ++phase) {
		const before = sampleCopies;
		if (phase >= 3) machine.gxGpu.writeGp1(0x09000001);
		// The framebuffer ends immediately before its font page. Touching the
		// geometric right edge does not write a texel in that page. A deliberate
		// write into the page in the final phase must still synchronize it.
		const words = [0xe1000005, 0x600000ff, 0, (240 << 16) | 320];
		if (phase === 2) words.push(0x6000ff00, 320, 0x00010001);
		if (phase === 3) words.push(0xe40fffff, 0x6000ff00, (512 << 16) | 320, 0x00010001);
		if (phase === 4) words.push(0xe40fffff, 0x6200ff00, 20, 0x00010001, 0x6200ff00, (512 << 16) | 20, 0x00010001);
		// A fully clipped primitive leaves an empty batch; changing the drawing
		// area flushes it immediately before the following visible primitive.
		if (phase === 5) words.push(0xe4000000, 0x60ff0000, 20, 0x00010001, 0xe40fffff, 0x6000ff00, 20, 0x00010001);
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
		adjacentCopyRects.push(sampleCopyRects.slice(before));
		adjacentPixel.push(Array.from(rendered.subarray(20 * 4, 21 * 4)));
	}
	let capacityResult: { difference: number; pixel: number[]; copies: number[][]; commands: number } | undefined;
	if (includeAliasCase && vramBytes === 2 * 1024 * 1024) {
		const buffer = new GxGpuCommandBuffer(machine.dmaController);
		const draw = Uint32Array.from([0x65808080, (120 << 16) | 120, 16, 0x00010001]);
		const renderBuffer = async (): Promise<Uint8Array> => {
			buffer.completeCommandExecution(buffer.commandCount);
			buffer.sealCommandsForPresentation();
			const output = { ...machine.gxGpu.readDeviceOutput(), commandBuffer: buffer, readbackPort: buffer.readback };
			renderGxGpuSoftwareFrame(software, state, output, pixels);
			library.execute('gx_gpu', framebuffer, output);
			return backend.readColorTexture(target, width, height);
		};
		const prepareRead = (): void => {
			buffer.reset();
			const start = buffer.appendWords(draw, draw.length);
			buffer.pushCommand(GX_GPU_COMMAND_DRAW_RECTANGLE, 0x65, start, draw.length, 0x100, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		};
		// Bring the cell into the sample copy before filling, so the very last
		// command must dirty it again for the later texture read.
		prepareRead();
		await renderBuffer();
		buffer.reset();
		const fill = Uint32Array.from([0x020000ff, (511 << 16) | 1008, (2 << 16) | 32]);
		for (let index = 0; index < GX_GPU_COMMAND_CAPACITY; ++index) {
			if (index === GX_GPU_COMMAND_CAPACITY - 1) {
				fill[0] = 0x0200ff00;
				fill[1] = (511 << 16) | 992;
				fill[2] = (2 << 16) | 64;
			}
			const start = buffer.appendWords(fill, fill.length);
			buffer.pushCommand(GX_GPU_COMMAND_FILL_RECTANGLE, 0x02, start, fill.length, 0, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		}
		const commands = buffer.commandCount;
		await renderBuffer();
		const before = sampleCopies;
		prepareRead();
		const rendered = await renderBuffer();
		capacityResult = {
			difference: rendered.findIndex((value, index) => value !== expected[index]),
			pixel: Array.from(rendered.subarray((120 * width + 120) * 4, (120 * width + 121) * 4)),
			copies: sampleCopyRects.slice(before),
			commands,
		};
	}
	const wrappedDifferences: number[] = [];
	for (let flip = 0; flip < 2; ++flip) {
		const textureU = flip === 0 ? 254 : 1;
		const uploadX = flip === 0 ? 512 : 767;
		for (const word of [
			0xe1000118, 0x65808080, 180 << 16, 0, 0x00010100,
			0xa0000000, (256 << 16) | uploadX, 0x00010001, 0x00007fff,
			0xe1000118 | (flip << 12),
			0x65808080, (180 << 16) | 100, textureU, 0x00010004,
		]) {
			machine.gxGpu.writeGp0(word);
			machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
			machine.gxGpu.onService(machine.scheduler.currentNowCycles());
		}
		machine.gxGpu.presentReadyFrameOnVblankEdge();
		const next = machine.gxGpu.readDeviceOutput();
		renderGxGpuSoftwareFrame(software, state, next, pixels);
		library.execute('gx_gpu', framebuffer, next);
		const rendered = await backend.readColorTexture(target, width, height);
		wrappedDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
	}
	const rectangleDifferences: number[] = [];
	const rectangleWords = [0xa0000000, 0x01000200, (33 << 16) | 80];
	for (let pixel = 0; pixel < 80 * 33; pixel += 2)
		rectangleWords.push(((pixel * 337) & 0xffff) | (((pixel + 1) * 337) << 16));
	for (let flip = 0; flip < 4; ++flip) {
		// An 80x33 sprite has exclusive -1 edges when mirrored. Power-of-two
		// dimensions hide an unsigned-vertex overflow during triangle division.
		const words = flip === 0 ? rectangleWords.slice() : [];
		words.push(0xe1000118 | (flip << 12), 0x65808080, (160 << 16) | 100,
			((flip & 1) !== 0 ? 79 : 0) | ((flip & 2) !== 0 ? 32 << 8 : 0), (33 << 16) | 80);
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
		rectangleDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
	}
	// Byte-valued flat colors and gains must arrive at the raster datapath
	// without a normalized-float round trip (including 72, an fp16 boundary).
	const flatColorDifferences: number[] = [];
	for (const textured of [false, true]) {
		const words: number[] = [0xe6000000, 0xe1000118, 0xa0000000, 0x01000200, 0x00010001, 0x7fff];
		for (let color = 0; color < 256; ++color) {
			words.push((textured ? 0x64000000 : 0x60000000) | color * 0x010101, color << 16);
			if (textured) words.push(0);
			words.push(0x00010100);
		}
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
		flatColorDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
	}
	// Exercise every polygon packet layout, line encoding and rectangle size against the
	// software renderer, including the second triangle of each quad.
	const drawLayoutDifferences: number[] = [], drawLayoutPixels: number[] = [];
	const point = (x: number, y: number) => x | (y << 16);
	const vertices = [point(10, 10), point(80, 10), point(10, 80), point(80, 80)];
	const colors = [0x00804020, 0x00208040, 0x00402080, 0x00808040];
	const texture = [0, 1 | (0x0118 << 16), 0x100, 0x101];
	const packets: number[][] = [];
	for (const shaded of [false, true]) for (const textured of [false, true]) for (const quad of [false, true]) {
		const opcode = 0x20 | (shaded ? 0x10 : 0) | (textured ? 0x04 : 0) | (quad ? 0x08 : 0);
		const packet = [(opcode << 24) | colors[0], vertices[0]];
		if (textured) packet.push(texture[0]);
		for (let vertex = 1; vertex < (quad ? 4 : 3); ++vertex) {
			if (shaded) packet.push(colors[vertex]);
			packet.push(vertices[vertex]);
			if (textured) packet.push(texture[vertex]);
		}
		packets.push(packet);
	}
	for (const shaded of [false, true]) for (const polyline of [false, true]) {
		const opcode = 0x40 | (shaded ? 0x10 : 0) | (polyline ? 0x08 : 0);
		const packet = [(opcode << 24) | colors[0], point(10, 10)];
		if (shaded) packet.push(colors[1]);
		packet.push(point(80, 10));
		if (polyline) {
			if (shaded) packet.push(colors[2]);
			packet.push(point(80, 80), 0x50005000);
		}
		packets.push(packet);
	}
	for (const textured of [false, true]) for (const sizeBits of [0, 0x08, 0x10, 0x18]) {
		const opcode = 0x60 | (textured ? 0x04 : 0) | sizeBits;
		const packet = [(opcode << 24) | 0x00808080, point(10, 10)];
		if (textured) packet.push(0);
		if (sizeBits === 0) packet.push(point(16, 8));
		packets.push(packet);
	}
	machine.gxGpu.writeGp1(0x09000000);
	for (const packet of packets) {
		const words = [0xe3000000, 0xe407ffff, 0xe5000000, 0xe6000000,
			0x02000000, 0, 0x01000100,
			0xe1000118, 0xa0000000, 0x01000200, 0x00020002, 0x03e0001f, 0x7fff7c00,
			...packet];
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
		drawLayoutDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		drawLayoutPixels.push(pixels.filter(pixel => (pixel & 0xffffff) !== 0).length);
	}
	// A DRAW_LINE consumes exactly two vertices even if its retained raw span
	// contains extra words. The old third word would draw a spurious segment.
	const lineExtraWordDifferences: number[] = [], lineExtraWordPixels: number[][] = [], lineExtraWordCounts: number[] = [];
	for (const shaded of [false, true]) {
		const buffer = new GxGpuCommandBuffer(machine.dmaController);
		buffer.reset();
		const fill = Uint32Array.from([0x02000000, 0, 0x01000100]);
		const fillStart = buffer.appendWords(fill, fill.length);
		buffer.pushCommand(GX_GPU_COMMAND_FILL_RECTANGLE, 0x02, fillStart, fill.length, 0, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		const line = Uint32Array.from(shaded
			? [0x50ffffff, point(10, 10), 0x00ffffff, point(80, 10), 0x00ffffff, point(80, 80)]
			: [0x40ffffff, point(10, 10), point(80, 10), point(80, 80)]);
		const lineStart = buffer.appendWords(line, line.length);
		buffer.pushCommand(GX_GPU_COMMAND_DRAW_LINE, shaded ? 0x50 : 0x40, lineStart, line.length, 0, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		lineExtraWordCounts.push(buffer.drawVertexCount[buffer.commandDrawIndex[1]]);
		buffer.completeCommandExecution(buffer.commandCount);
		buffer.sealCommandsForPresentation();
		const next = { ...machine.gxGpu.readDeviceOutput(), commandBuffer: buffer, readbackPort: buffer.readback };
		renderGxGpuSoftwareFrame(software, state, next, pixels);
		library.execute('gx_gpu', framebuffer, next);
		const rendered = await backend.readColorTexture(target, width, height);
		lineExtraWordDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		lineExtraWordPixels.push([pixels[10 * width + 20] & 0xffffff, pixels[40 * width + 80] & 0xffffff]);
	}
	let orderedSourceDifference = -1;
	const orderedSourceWords: number[] = [];
	const orderedReadbackWords: number[] = [];
	let orderedReadbackPending = false;
	if (includeAliasCase) {
		// A later command reads the pending batch's destination, followed by a
		// self-reading quad. The last draw also changes the textured vertex stride.
		const words = [0xe3000000, 0xe40fffff, 0xe5000000, 0xe1000118, 0xe6000000,
			0x600000ff, 0x01040208, 0x00040004,
			0x65808080, 0x01040258, 0x00000408, 0x00040004,
			0x65808080, 0x010402bc, 0x00000458, 0x00040000,
			0x65808080, 0x010402bc, 0x00000458, 0x00040004,
			0x2d808080, 0x01040208, 0x00000408, 0x0104020c, 0x0118040c,
			0x01080208, 0x00000808, 0x0108020c, 0x0000080c,
			0x3c808080, 0x01200300, 0x00000408, 0x00804040, 0x01200304, 0x0118040b,
			0x00408040, 0x01240300, 0x00000708, 0x00404080, 0x01240304, 0x0000070b];
		// Change the indexed palette between draws and copy each result to a
		// distinct destination, so a deferred stale palette is observable.
		for (let group = 0; group < 4; ++group) {
			const color = (group + 1) * 0x0421;
			words.push(0xe6000000, 0xe1000005, 0xa0000000, 320, 0x00010003, 0x11111111, 0xdead1111,
				0xa0000000, (24 << 16) | 320, 0x00010010);
			for (let pair = 0; pair < 8; ++pair) words.push(color | (color << 16));
			words.push(0x65808080, (200 << 16) | (800 + group * 8), (20 | (24 << 6)) << 16, 0x00010004,
				0x80000000, (200 << 16) | (800 + group * 8), (202 << 16) | (800 + group * 8), 0x00010004);
		}
		// Triangle one reads a fixed texel outside the quad; triangle two reads
		// part of triangle one's destination. No triangle reads its own writes.
		words.push(0xe1000101, 0xa0000000, (100 << 16) | 100, (8 << 16) | 8);
		for (let pair = 0; pair < 32; ++pair) words.push(0);
		words.push(0xa0000000, (98 << 16) | 98, 0x00010001, 0x000003e0,
			0x2d808080, (100 << 16) | 100, 34 | (98 << 8),
			(100 << 16) | 108, 34 | (98 << 8) | (0x0101 << 16),
			(108 << 16) | 100, 34 | (98 << 8), (108 << 16) | 108, 38 | (102 << 8));
		// An independent textured batch writes a CLUT which the following draw
		// samples. Repeat through row 536: it aliases palette row 24 only in 1 MiB.
		words.push(0xe1000005, 0xa0000000, 320, 0x00010002, 0x11112222,
			0xa0000000, (24 << 16) | 320, 0x00010010, 0x001f0000);
		for (let pair = 1; pair < 8; ++pair) words.push(0);
		words.push(0xa0000000, (25 << 16) | 320, 0x00010010, 0, 0x000003e0);
		for (let pair = 2; pair < 8; ++pair) words.push(0);
		words.push(0x65808080, (24 << 16) | 321, (20 | (25 << 6)) << 16, 0x00010001,
			0x65808080, (120 << 16) | 100, 4 | ((20 | (24 << 6)) << 16), 0x00010001,
			0xa0000000, (24 << 16) | 321, 0x00010001, 0x0000001f,
			0x65808080, (536 << 16) | 321, (20 | (25 << 6)) << 16, 0x00010001,
			0x65808080, (120 << 16) | 101, 4 | ((20 | (24 << 6)) << 16), 0x00010001);
		// A source on logical row 512 aliases row zero only with 1 MiB.
		words.push(0x60000000, (120 << 16) | 110, 0x00010001,
			0xa0000000, (512 << 16) | 64, 0x00010001, 0,
			0x600000ff, 64, 0x00010001, 0xe1000901,
			0x65808080, (120 << 16) | 110, 0, 0x00010001);
		machine.gxGpu.writeGp1(0x09000001);
		for (const word of words) {
			machine.gxGpu.writeGp0(word);
			machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
			machine.gxGpu.onService(machine.scheduler.currentNowCycles());
		}
		machine.gxGpu.presentReadyFrameOnVblankEdge();
		const next = machine.gxGpu.readDeviceOutput();
		renderGxGpuSoftwareFrame(software, state, next, pixels);
		// The software reference has consumed the draws, but the hardware backend
		// has not. A real guest C0 therefore fences the pending textured batch.
		for (const word of [0xc0000000, (120 << 16) | 100, 0x00010002]) {
			machine.gxGpu.writeGp0(word);
			machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000);
			machine.gxGpu.onService(machine.scheduler.currentNowCycles());
		}
		orderedReadbackPending = machine.gxGpu.backendServicePending();
		backend.executeGxGpuReadback(machine.gxGpu);
		await backend.finishGxGpuReadbacks();
		orderedReadbackWords.push(machine.gxGpu.readGp0());
		library.execute('gx_gpu', framebuffer, next);
		await backend.captureGxGpuVramSnapshot(machine.gxGpu);
		const snapshot = machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
		orderedSourceDifference = snapshot.findIndex((value, index) => value !== ((software.vram[index >>> 1] >>> ((index & 1) * 8)) & 255));
		for (const x of [520, 600, 700]) orderedSourceWords.push(software.vram[260 * 1024 + x]);
		for (let group = 0; group < 4; ++group) orderedSourceWords.push(software.vram[202 * 1024 + 800 + group * 8]);
		orderedSourceWords.push(software.vram[107 * 1024 + 107], software.vram[120 * 1024 + 100], software.vram[120 * 1024 + 101], software.vram[120 * 1024 + 110]);
	}
	const validationError = gpu === undefined ? undefined : (await gpu.device.popErrorScope())?.message;
	const glError = gl === undefined ? 0 : gl.gl.getError();
	if (framebuffer !== null) gl!.destroyRenderTarget(framebuffer);
	backend.destroyTexture(target); library.dispose(); gpu?.device.destroy();
	return { kind, difference, samples, validationError, glError, gpuErrors, commands, transfers, snapshotDifferences, snapshotWords, adjacentCopies, adjacentCopyRects, adjacentPixel, adjacentDifferences, capacityResult, wrappedDifferences, rectangleDifferences, flatColorDifferences, drawLayoutDifferences, drawLayoutPixels, lineExtraWordDifferences, lineExtraWordPixels, lineExtraWordCounts, orderedSourceDifference, orderedSourceWords, orderedReadbackPending, orderedReadbackWords };
}
