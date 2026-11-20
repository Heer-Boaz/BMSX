import { GxGpuCommandBuffer, GX_GPU_COMMAND_CAPACITY, GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_SKIPPED_LINE_NONE } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { BrowserGxFixture } from './gx_gpu_browser_fixture';

export async function renderGxGpuDirtyCells(fixture: BrowserGxFixture) {
	const { machine, gpu, gl, width, vramBytes, softwareBytes: expected } = fixture;
	let stopObservingCopies: () => void;
	let sampleCopies = 0;
	const sampleCopyRects: number[][] = [];
	if (gl !== undefined) {
		const copy = gl.gl.copyTexSubImage2D;
		stopObservingCopies = () => { gl.gl.copyTexSubImage2D = copy; };
		gl.gl.copyTexSubImage2D = (...args: Parameters<typeof copy>) => { ++sampleCopies; sampleCopyRects.push([args[2], args[3], args[6], args[7]]); copy.apply(gl.gl, args); };
	} else {
		const prototype = Object.getPrototypeOf(gpu!.device.createCommandEncoder());
		const copy = prototype.copyTextureToTexture;
		stopObservingCopies = () => { prototype.copyTextureToTexture = copy; };
		prototype.copyTextureToTexture = function (...args: any[]) {
			++sampleCopies;
			const origin = args[0].origin as GPUOrigin3DDict, extent = args[2] as GPUExtent3DDict;
			sampleCopyRects.push([origin.x!, origin.y!, extent.width, extent.height!]);
			copy.apply(this, args);
		};
	}
	const adjacentCopies: number[] = [], adjacentDifferences: number[] = [], adjacentCopyRects: number[][][] = [], adjacentPixel: number[][] = [];
	for (let phase = 0; phase < 6; ++phase) {
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
		fixture.submit(words);
		const next = fixture.present();
		const rendered = await fixture.captureColor(next);
		adjacentDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		adjacentCopies.push(sampleCopies - before);
		adjacentCopyRects.push(sampleCopyRects.slice(before));
		adjacentPixel.push(Array.from(rendered.subarray(20 * 4, 21 * 4)));
	}
	let capacityResult: { difference: number; pixel: number[]; copies: number[][]; commands: number } | undefined;
	if (vramBytes === PSX_MACHINE_SPEC.gxGpuVramBytes) {
		const buffer = new GxGpuCommandBuffer(machine.dmaController);
		const draw = Uint32Array.from([0x65808080, (120 << 16) | 120, 16, 0x00010001]);
		const renderBuffer = async (): Promise<Uint8Array> => {
			buffer.completeCommandExecution(buffer.commandCount);
			buffer.sealCommandsForPresentation();
			const output = { ...machine.gxGpu.readDeviceOutput(), commandBuffer: buffer, readbackPort: buffer.readback };
			return fixture.captureColor(output);
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
	stopObservingCopies();
	return { adjacentCopies, adjacentCopyRects, adjacentPixel, adjacentDifferences, capacityResult };
}

export async function renderGxGpuOrderedBatches(fixture: BrowserGxFixture) {
	const { machine, backend, software, state, pixels, library, framebuffer } = fixture;
	const orderedSourceWords: number[] = [];
	const maskedRectangleWords: number[] = [];
	const orderedReadbackWords: number[] = [];
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
	// Masked rectangles require destination reads. Keep two in one batch,
	// bracketed by triangles so the producer also changes primitive kind.
	words.push(0xe1000101, 0xe6000000,
		0xa0000000, (64 << 16) | 64, 0x00010004, 0x7c007c00, 0x7c007c00,
		0xa0000000, (450 << 16) | 718, 0x00010004, 0x801f001f, 0x800003e0,
		0xa0000000, (450 << 16) | 730, 0x00010004, 0x801f001f, 0x800003e0,
		0xe6000002,
		0x25808080, (452 << 16) | 700, 0x00004000, (452 << 16) | 704, 0x01014000, (456 << 16) | 700, 0x00004000,
		0x65808080, (450 << 16) | 718, 0x00004000, 0x00010004,
		0x65808080, (450 << 16) | 730, 0x00004000, 0x00010004,
		0x25808080, (452 << 16) | 740, 0x00004000, (452 << 16) | 744, 0x01014000, (456 << 16) | 740, 0x00004000,
		0xe6000000);
	// Within a triangle, an earlier destination is also a later source.
	words.push(0xe1000111, 0xa0000000, (300 << 16) | 98, (4 << 16) | 6);
	for (let row = 0; row < 4; ++row) words.push(0x03e0001f, 0x7fff7c00, 0x7c1f03ff);
	words.push(0x2d808080, (300 << 16) | 100, 34 | (44 << 8),
		(300 << 16) | 104, 38 | (44 << 8) | (0x0111 << 16),
		(304 << 16) | 100, 34 | (48 << 8), (304 << 16) | 104, 38 | (48 << 8));
	// An indexed sprite overwrites its own CLUT entry before fetching it.
	words.push(0xe1000005, 0xa0000000, 320, 0x00010001, 0x00001112,
		0xa0000000, (350 << 16) | 320, 0x00010003, 0x7c000000, 0x0000001f,
		0x65808080, (350 << 16) | 321, (20 | (350 << 6)) << 16, 0x00010004);
	// An indexed sprite overwrites the packed texel word before fetching
	// its second nibble. The CLUT itself lies outside the destination.
	words.push(0xe1000016, 0xa0000000, (380 << 16) | 400, 0x00010001, 0x00001112,
		0xa0000000, (400 << 16) | 432, 0x00010003, 0x7c000000, 0x0000001f,
		0x65808080, (380 << 16) | 400, 64 | (124 << 8) | ((27 | (400 << 6)) << 16), 0x00010004);
	// 8-bit indexed source overwrites its packed source byte.
	words.push(0xe1000098, 0xa0000000, (420 << 16) | 520, 0x00010001, 0x00000102,
		0xa0000000, (430 << 16) | 560, 0x00010003, 0x7c000000, 0x0000001f,
		0x65808080, (420 << 16) | 520, 16 | (164 << 8) | ((35 | (430 << 6)) << 16), 0x00010002);
	// Texture-window replacement must be included in the latched source.
	words.push(0xe100011a, 0xe2000001, 0xa0000000, (464 << 16) | 640, 0x00010002, 0x7c00001f,
		0x65808080, (464 << 16) | 641, 8 | (208 << 8), 0x00010002, 0xe2000000);
	// The source latch is independent of destination blending.
	words.push(0xe100011b, 0xe6000000, 0xa0000000, (450 << 16) | 706, 0x00010006,
		0x83e0801f, 0x7c0003e0, 0x03e07c00,
		0x67808080, (450 << 16) | 708, 2 | (194 << 8), 0x00010004);
	// A single rectangle spans the physical row wrap. Its two bands share
	// a dirty-cell row even though their actual pixels are disjoint.
	words.push(0xe1000112, 0xa0000000, (500 << 16) | 130, 0x00010006,
		0x03e0001f, 0x7fff7c00, 0x7c1f03ff,
		0x65808080, (500 << 16) | 132, 2 | (244 << 8), (511 << 16) | 4);
	machine.gxGpu.writeGp1(0x09000001);
	fixture.submit(words);
	machine.scheduler.advanceTo(machine.scheduler.currentNowCycles() + 10_000_000);
	machine.gxGpu.onService(machine.scheduler.currentNowCycles());
	const next = fixture.present();
	renderGxGpuSoftwareFrame(software, state, next, pixels);
	// The software reference has consumed the draws, but the hardware backend
	// has not. A real guest C0 therefore fences the pending textured batch.
	fixture.submit([0xc0000000, (120 << 16) | 100, 0x00010002]);
	const orderedReadbackPending = machine.gxGpu.backendServicePending();
	backend.executeGxGpuReadback(machine.gxGpu);
	await backend.finishGxGpuReadbacks();
	orderedReadbackWords.push(machine.gxGpu.readGp0());
	library.execute('gx_gpu', framebuffer, next);
	await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	const snapshot = machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
	for (const x of [718, 730]) for (let pixel = 0; pixel < 4; ++pixel) {
		const offset = (450 * 1024 + x + pixel) * 2;
		maskedRectangleWords.push(snapshot[offset] | (snapshot[offset + 1] << 8));
	}
	const orderedSourceDifference = snapshot.findIndex((value, index) => value !== ((software.vram[index >>> 1] >>> ((index & 1) * 8)) & 255));
	for (const x of [520, 600, 700]) orderedSourceWords.push(software.vram[260 * 1024 + x]);
	for (let group = 0; group < 4; ++group) orderedSourceWords.push(software.vram[202 * 1024 + 800 + group * 8]);
	orderedSourceWords.push(software.vram[107 * 1024 + 107], software.vram[120 * 1024 + 100], software.vram[120 * 1024 + 101], software.vram[120 * 1024 + 110], software.vram[300 * 1024 + 102], software.vram[350 * 1024 + 322], software.vram[380 * 1024 + 401], software.vram[420 * 1024 + 521], software.vram[464 * 1024 + 642], software.vram[450 * 1024 + 708], software.vram[450 * 1024 + 710]);
	fixture.submit([0xc0000000, (300 << 16) | 102, 0x00010001]);
	backend.executeGxGpuReadback(machine.gxGpu);
	await backend.finishGxGpuReadbacks();
	const selfTextureReadback = machine.gxGpu.readGp0();
	const saved = machine.gxGpu.captureSaveState();
	machine.gxGpu.restoreSaveState(saved);
	await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	const restored = machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
	const restoredOffset = (300 * 1024 + 102) * 2;
	const selfTextureRestored = restored[restoredOffset] | (restored[restoredOffset + 1] << 8);
	return { orderedSourceDifference, orderedSourceWords, maskedRectangleWords, orderedReadbackWords,
		orderedReadbackPending, selfTextureReadback, selfTextureRestored };
}
