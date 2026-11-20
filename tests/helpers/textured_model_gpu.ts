import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createBrowserGxFixture, type BrowserGxBackend, type BrowserGxFixture } from './gx_gpu_browser_fixture';
import { renderGxGpuDrawLayouts } from './gx_gpu_draw_layouts';
import { renderGxGpuDirtyCells, renderGxGpuOrderedBatches } from './gx_gpu_ordered_batches';

function seedVram(fixture: BrowserGxFixture) {
	const replacement = new Uint8Array(fixture.vramBytes);
	for (let index = 0; index < replacement.length; ++index) replacement[index] = index * 37 + (index >>> 10);
	fixture.machine.gxGpu.replaceVramSnapshotBytes(replacement);
	return replacement;
}

/** Same projected model packets as gx_gpu_textured_gles2_test.cpp, not a gameplay cart. */
async function renderProjectedModel(fixture: BrowserGxFixture) {
	const { machine, backend, gpu, gl, software, width, softwareBytes: expected } = fixture;
	fixture.submit([
		0xe3000000, 0xe407ffff, 0xe5000000,
		0xa0000000, 0x01000200, 0x00010004, 0x03e0001f, 0x00007c00,
		0x24808080, 0x00480008, 0, 0x00480048, 0x01180003, 0x00080008, 0,
		0x25010203, 0x00480068, 0, 0x004800a8, 0x01180003, 0x00080068, 0,
	]);
	const output = fixture.present();
	const actual = await fixture.captureColor(output);
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
	let stopObservingSnapshots: () => void;
	if (gl !== undefined) {
		const readPixels = gl.gl.readPixels;
		stopObservingSnapshots = () => { gl.gl.readPixels = readPixels; };
		gl.gl.readPixels = (...args: any[]) => {
			transfers.push(args.slice(0, 4));
			Reflect.apply(readPixels, gl.gl, args);
		};
	} else {
		const prototype = Object.getPrototypeOf(gpu!.device.createCommandEncoder());
		const copy = prototype.copyTextureToBuffer;
		stopObservingSnapshots = () => { prototype.copyTextureToBuffer = copy; };
		prototype.copyTextureToBuffer = function (source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyBufferInfo, extent: GPUExtent3DDict) {
			const origin = source.origin as GPUOrigin3DDict;
			transfers.push([origin.x!, origin.y!, extent.width, extent.height!]);
			copy.call(this, source, destination, extent);
		};
	}
	const snapshotDifferences: number[] = [];
	const snapshotWords: number[] = [];
	for (let phase = 0; phase < 2; ++phase) {
		if (phase !== 0) {
			machine.gxGpu.writeGp1(0x09000001);
			fixture.submit([0xe40fffff, 0x6000ff00, (901 << 16) | 197, (2 << 16) | 3]);
			const next = fixture.present();
			fixture.render(next);
		}
		await backend.captureGxGpuVramSnapshot(machine.gxGpu);
		const bytes = machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
		const changedWordAt = (901 * 1024 + 197) * 2;
		snapshotWords.push(bytes[changedWordAt] | (bytes[changedWordAt + 1] << 8));
		snapshotDifferences.push(bytes.findIndex((value, index) =>
			value !== ((software.vram[index >>> 1] >>> ((index & 1) * 8)) & 255)));
		await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	}
	const replacement = seedVram(fixture);
	await backend.captureGxGpuVramSnapshot(machine.gxGpu);
	snapshotDifferences.push(machine.gxGpu.readDeviceOutput().vramSnapshotBytes.findIndex((value, index) => value !== replacement[index]));
	stopObservingSnapshots();
	return { difference, samples, commands, transfers, snapshotDifferences, snapshotWords };
}

async function renderTextureSampling(fixture: BrowserGxFixture) {
	const { softwareBytes: expected } = fixture;
	const wrappedDifferences: number[] = [];
	for (let flip = 0; flip < 2; ++flip) {
		const textureU = flip === 0 ? 254 : 1;
		const uploadX = flip === 0 ? 512 : 767;
		fixture.submit([
			0xe1000118, 0x65808080, 180 << 16, 0, 0x00010100,
			0xa0000000, (256 << 16) | uploadX, 0x00010001, 0x00007fff,
			0xe1000118 | (flip << 12),
			0x65808080, (180 << 16) | 100, textureU, 0x00010004,
		]);
		const next = fixture.present();
		const rendered = await fixture.captureColor(next);
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
		fixture.submit(words);
		const next = fixture.present();
		const rendered = await fixture.captureColor(next);
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
		fixture.submit(words);
		const next = fixture.present();
		const rendered = await fixture.captureColor(next);
		flatColorDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
	}
	return { wrappedDifferences, rectangleDifferences, flatColorDifferences };
}

export async function renderTexturedModelCase(canvas: HTMLCanvasElement, kind: BrowserGxBackend, vramBytes: number) {
	const fixture = await createBrowserGxFixture(canvas, kind, vramBytes);
	const full = vramBytes === PSX_MACHINE_SPEC.gxGpuVramBytes;
	let projection;
	if (full) {
		projection = await renderProjectedModel(fixture);
	} else {
		// Start from the same imported VRAM and draw bounds as the full run's
		// damage phases, without generating unrelated model/readback evidence.
		fixture.machine.gxGpu.writeGp1(0x09000001);
		fixture.submit([0xe40fffff]);
		seedVram(fixture);
	}
	const damage = await renderGxGpuDirtyCells(fixture);
	const sampling = full ? await renderTextureSampling(fixture) : undefined;
	const layouts = await renderGxGpuDrawLayouts(fixture);
	const orderedBatches = await renderGxGpuOrderedBatches(fixture);
	const diagnostics = await fixture.finish();
	return { kind, projection, sampling, ...damage, ...layouts, ...orderedBatches, ...diagnostics };
}
