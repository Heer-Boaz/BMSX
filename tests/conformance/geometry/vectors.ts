import { numberToF32Bits } from '../../../machine/ts/common/float32';
import { encodeSignedFix16 } from '../../../machine/ts/machine/common/numeric';
import { DYNAMIC_RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import * as io from '../../../machine/ts/spec/bmsx/io';
import * as geo from '../../../machine/ts/machine/devices/geometry/contracts';

// Mapped fixture RAM for the shared GEO operands and results.
export const GEO_BUFFERS = DYNAMIC_RAM_BASE + 0x10000;
export const GEO_VECTOR_RAM_END = GEO_BUFFERS + 0x2000;

export type GeometryVector = { name: string; writes: [number, number][]; reads: number[]; pairCounterSeed: number; firstRecordPairs: number; clipCapacityBoundary: number };
const instances = GEO_BUFFERS, shapes = GEO_BUFFERS + 0x100, vertices = GEO_BUFFERS + 0x200;
const result = GEO_BUFFERS + 0x400, summary = GEO_BUFFERS + 0x500;

/** One RAM/MMIO program is consumed unchanged by both cores. */
function vector(name: string, a: readonly number[], b: readonly number[], sat: boolean): GeometryVector {
	const writes: [number, number][] = [];
	const words = (address: number, values: readonly number[]) => values.forEach((value, i) => writes.push([address + i * 4, value >>> 0]));
	words(result, new Array(9).fill(0xdeadbeef));
	words(summary, [0, 0, 0, 0]);
	if (sat) {
		words(instances, [0, 0, 0, 1, 0]);
		words(shapes, [geo.GEO_SHAPE_CONVEX_POLY, a.length / 2, 0, 0, geo.GEO_SHAPE_CONVEX_POLY, b.length / 2, a.length * 4, 0]);
		words(vertices, [...a, ...b]);
	} else {
		words(instances, [shapes, 0, 0, 1, 1, shapes + 32, 0, 0, 1, 1]);
		words(shapes, [geo.GEO_PRIMITIVE_CONVEX_POLY, a.length / 2, vertices - shapes, 16, 0, 0, 0, 0]);
		words(shapes + 32, [geo.GEO_PRIMITIVE_CONVEX_POLY, b.length / 2, vertices + a.length * 4 - shapes - 32, 16, 0, 0, 0, 0]);
		words(vertices, [...a, ...b]);
	}
	writes.push(
		[io.IO_GEO_SRC0, instances], [io.IO_GEO_SRC1, sat ? shapes : 0], [io.IO_GEO_SRC2, sat ? vertices : 0],
		[io.IO_GEO_DST0, result], [io.IO_GEO_DST1, sat ? 0 : summary], [io.IO_GEO_COUNT, sat ? 1 : 2],
		[io.IO_GEO_PARAM0, sat ? 0 : geo.GEO_OVERLAP2D_MODE_FULL_PASS], [io.IO_GEO_PARAM1, sat ? 0 : 1],
		[io.IO_GEO_STRIDE0, 20], [io.IO_GEO_STRIDE1, sat ? 16 : 0], [io.IO_GEO_STRIDE2, sat ? 8 : 0],
		[io.IO_GEO_CMD, sat ? geo.IO_CMD_GEO_SAT2_BATCH : geo.IO_CMD_GEO_OVERLAP2D_PASS],
	);
	return { name, writes, pairCounterSeed: 0, firstRecordPairs: 0, clipCapacityBoundary: 0, reads: [io.IO_GEO_STATUS, io.IO_GEO_FAULT, io.IO_GEO_PROCESSED,
		...Array.from({ length: 9 }, (_, i) => result + i * 4), ...Array.from({ length: 4 }, (_, i) => summary + i * 4)] };
}

export function geometryVectors(): GeometryVector[] {
	const result: GeometryVector[] = [];
	const cases = [
		{ name: 'overlap', a: [0, 0, 4, 0, 4, 4, 0, 4], b: [1, 1, 5, 1, 5, 5, 1, 5] },
		{ name: 'touch', a: [0, 0, 4, 0, 4, 4, 0, 4], b: [4, 0, 8, 0, 8, 4, 4, 4] },
		{ name: 'separated', a: [0, 0, 4, 0, 4, 4, 0, 4], b: [5, 0, 8, 0, 8, 4, 5, 4] },
		{ name: 'axis-tie', a: [-2, -2, 2, -2, 2, 2, -2, 2], b: [-2, -2, 2, -2, 2, 2, -2, 2] },
		{ name: 'clip', a: [-13.75, 0.125, 17.25, -4.875, 3.5, 21.125], b: [-7.625, -3.25, 9.125, 2.5, 1.375, 14.875] },
	];
	for (const sat of [false, true]) for (const c of cases) {
		const encode = sat ? encodeSignedFix16 : numberToF32Bits;
		result.push(vector(`${sat ? 'sat' : 'overlap'}-${c.name}`, c.a.map(encode), c.b.map(encode), sat));
	}
	for (const mode of [0, 3]) {
		const v = vector(`full-pass-selector-${mode}`,
			cases[0].a.map(numberToF32Bits), cases[0].b.map(numberToF32Bits), false);
		v.writes.find(([address]) => address === io.IO_GEO_PARAM0)![1] = mode;
		if (mode === 3) v.writes.find(([address]) => address === io.IO_GEO_SRC1)![1] = GEO_BUFFERS + 0xa00;
		result.push(v);
	}
	for (const mode of [2, 3]) {
		const v = vector(`layer-boundary-${mode}`, cases[0].a.map(numberToF32Bits), cases[0].b.map(numberToF32Bits), false);
		const command = v.writes.pop()!;
		const base = GEO_BUFFERS + 0x1000;
		v.writes.push([io.IO_GEO_SRC0, base], [io.IO_GEO_SRC1, GEO_BUFFERS + 0xa00], [io.IO_GEO_COUNT, 34], [io.IO_GEO_PARAM0, mode]);
		for (let i = 0; i < 34; ++i) {
			const layer = i === 31 ? 0x80000000 : 1;
			const mask = i === 31 ? 1 : i === 33 ? 0x80000000 : 0;
			[shapes, 0, 0, layer, mask].forEach((word, j) => v.writes.push([base + i * 20 + j * 4, word]));
		}
		v.writes.push(command);
		result.push(v);
	}
	for (const name of ['indexed-workspace-fault', 'indexed-empty', 'indexed-filtered-descriptor']) {
		const v = vector(name, cases[0].a.map(numberToF32Bits), cases[0].b.map(numberToF32Bits), false);
		const command = v.writes.pop()!;
		v.writes.push([io.IO_GEO_PARAM0, geo.GEO_OVERLAP2D_MODE_INDEXED],
			[io.IO_GEO_SRC1, name === 'indexed-filtered-descriptor' ? GEO_BUFFERS + 0xa00 : 0xffffffff]);
		if (name === 'indexed-empty') v.writes.push([io.IO_GEO_COUNT, 0]);
		if (name === 'indexed-filtered-descriptor') v.writes.push([instances, 0xffffffff], [instances + 16, 0]);
		v.writes.push(command);
		result.push(v);
	}
	// Both dimensions contain equal-depth contacts. Preserve the A/B/feature
	// tie rule across separate, paid piece-pair phases, not just one polygon.
	const compoundTie = vector('overlap-compound-equal-depth',
		cases[0].a.map(numberToF32Bits), cases[0].b.map(numberToF32Bits), false);
	const compoundCommand = compoundTie.writes.pop()!;
	for (let side = 0; side < 2; ++side) {
		const compound = GEO_BUFFERS + 0x60 + side * geo.GEO_OVERLAP2D_SHAPE_DESC_BYTES;
		const pieces = GEO_BUFFERS + 0x80 + side * 2 * geo.GEO_OVERLAP2D_SHAPE_DESC_BYTES;
		const bounds = shapes + side * 32 + geo.GEO_OVERLAP2D_SHAPE_DESC_BYTES;
		compoundTie.writes.push([instances + side * geo.GEO_OVERLAP2D_INSTANCE_BYTES, compound]);
		[geo.GEO_OVERLAP2D_SHAPE_KIND_COMPOUND, 2, pieces - compound, bounds - compound]
			.forEach((word, index) => compoundTie.writes.push([compound + index * 4, word]));
		for (let piece = 0; piece < 2; ++piece) {
			const descriptor = pieces + piece * geo.GEO_OVERLAP2D_SHAPE_DESC_BYTES;
			[geo.GEO_PRIMITIVE_CONVEX_POLY, 4, vertices + side * 32 - descriptor, bounds - descriptor]
				.forEach((word, index) => compoundTie.writes.push([descriptor + index * 4, word]));
		}
	}
	compoundTie.writes.push(compoundCommand);
	result.push(compoundTie);
	// Adjacent binary32 values at the touching edge; both signs of zero;
	// normal/subnormal extremes; quiet/signaling NaNs with differing payloads.
	const square = [0, 0, 4, 0, 4, 4, 0, 4].map(numberToF32Bits);
	for (const word of [0x407fffff, 0x40800000, 0x40800001, 0, 0x80000000, 1, 0x80000001,
		0x007fffff, 0x00800000, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc12345, 0xffc00001, 0x7f800001]) {
		const other = [1, 1, 5, 1, 5, 5, 1, 5].map(numberToF32Bits);
		other[0] = word;
		result.push(vector(`overlap-word-${word.toString(16)}`, square, other, false));
	}
	// Non-axis-aligned, differently scaled contacts exercise projections and
	// clipping where contraction can change the selected axis/contact bits.
	for (let i = 1; i <= 64; i++) {
		const a = [-13.125 * i, -0.25, 5.75, -7.375 * i, 19.625, 21.875];
		const b = [-7.0625, -3.8125, 9.9375 * i, 2.15625, 1.03125, 14.46875 * i];
		for (const sat of [false, true]) {
			const encode = sat ? encodeSignedFix16 : numberToF32Bits;
			result.push(vector(`${sat ? 'sat' : 'overlap'}-oblique-${i}`, a.map(encode), b.map(encode), sat));
		}
	}
	// ARM FMA negative controls: two triangles sharing an oblique edge can
	// lose their tiny positive projected overlap when a dot product is fused.
	result.push(vector('overlap-unfused-contact',
		[-2146, 1913, 651, 7170, -7403, 4710].map(numberToF32Bits),
		[-2146, 1913, 3111, -884, 651, 7170].map(numberToF32Bits), false));
	// Raw Q16.16 words. The centre delta is parallel to the selected edge;
	// contraction changes the sign of its zero normal projection and flips
	// the published normal, even though the hit and rounded depth agree.
	result.push(vector('sat-unfused-normal',
		[-475, 112, 45437, 72136, 4475, 47602],
		[3351, 6114, 49263, 78138, 8301, 53604], true));
	for (const pairCounterSeed of [0x7fff_ffff, 0xffff_fffe, 0xffff_ffff]) {
		const seeded = vector(`overlap-counter-${pairCounterSeed.toString(16)}`,
			[0, 0, 4, 0, 4, 4, 0, 4].map(numberToF32Bits),
			[1, 1, 5, 1, 5, 5, 1, 5].map(numberToF32Bits), false);
		seeded.pairCounterSeed = pairCounterSeed;
		result.push(seeded);
	}
	// Outer progress waits for every later pair, even when those pairs span
	// multiple paid intervals.
	for (const count of [2, 8]) {
		const square = [0, 0, 4, 0, 4, 4, 0, 4].map(numberToF32Bits);
		const v = vector(`full-pass-first-record-${count}`, square, square, false);
		v.firstRecordPairs = count - 1;
		const separateSummary = GEO_BUFFERS + 0x900;
		v.reads = v.reads.map(address => address >= summary && address < summary + 16
			? address - summary + separateSummary : address);
		const command = v.writes.pop()!;
		for (const write of v.writes) {
			if (write[0] === io.IO_GEO_COUNT) write[1] = count;
			if (write[0] === io.IO_GEO_PARAM1) write[1] = count * (count - 1) / 2;
			if (write[0] === io.IO_GEO_DST1) write[1] = separateSummary;
		}
		for (let i = 2; i < count; i++) {
			[shapes, 0, 0, 1, 1].forEach((word, j) => v.writes.push([instances + i * geo.GEO_OVERLAP2D_INSTANCE_BYTES + j * 4, word]));
		}
		v.writes.push(command);
		result.push(v);
	}
	// The 64-vertex source is legal raw input; the two fixtures exercise the
	// 128th output and the first rejected 129th output through registers.
	const clip128 = [
			2,-2, -2,1, 2,-2, 0,1, 2,-2, -2,2, 1,-2, -2,0,
			0,0, -1,2, -1,0, -2,-2, 0,-1, -2,2, 2,-1, 1,1,
			1,2, -2,-2, 2,2, -1,-2, 1,2, -2,-1, 0,1, 0,2,
			-1,1, -2,-2, 2,2, 0,-2, -2,2, 2,-2, -1,2, -1,-1,
			-2,-2, 0,2, 0,-2, 1,2, 0,-2, 2,2, 1,-1, 2,2,
			0,1, -2,-2, 2,0, -2,2, 0,-2, 0,-2, 0,-1, 2,-2,
			-1,2, 0,-2, 1,1, -1,2, 1,-1, -2,-2, 0,2, -1,0,
			2,2, 1,0, 2,2, -1,0, 2,-1, 0,2, 0,-2, -1,2,
	].map(numberToF32Bits);
	const clip129 = [
			2,-2, -2,1, 2,-2, 0,1, 2,-2, -2,0, 1,-2, -1,2,
			0,0, -2,2, -1,0, -2,-2, 2,2, 0,-2, 0,2, -2,-2,
			2,2, -2,-2, 2,2, -2,1, 2,-1, -2,-1, 0,2, -1,-1,
			2,0, -2,-2, 0,0, 0,-2, -2,2, 2,-2, -1,2, -1,-1,
			-1,-2, 0,2, -1,-1, 1,2, -2,-1, -1,2, 1,1, -2,0,
			1,2, -2,-2, 2,2, -2,2, 0,-2, -2,2, 1,-1, 2,-2,
			-1,2, -1,-2, 1,1, -2,-2, 2,0, -2,-2, 0,2, -1,0,
			2,2, -2,-2, 1,2, -1,0, -1,2, -1,0, 2,-2, 0,2,
	].map(numberToF32Bits);
	const smallSquare = [-1,-1,1,-1,1,1,-1,1].map(numberToF32Bits);
	const atCapacity = vector('overlap-clip-128', clip128, smallSquare, false);
	atCapacity.clipCapacityBoundary = 128;
	result.push(atCapacity);
	const failing = vector('overlap-clip-129-after-contact', clip129, [-4,-4,4,-4,4,4,-4,4].map(numberToF32Bits), false);
	failing.clipCapacityBoundary = 129;
	const clipResult = GEO_BUFFERS + 0x900, clipSummary = GEO_BUFFERS + 0xa00;
	const lastCommand = failing.writes.pop()!;
	for (const write of failing.writes) {
		if (write[0] === io.IO_GEO_COUNT) write[1] = 3;
		if (write[0] === io.IO_GEO_PARAM1) write[1] = 2;
		if (write[0] === io.IO_GEO_DST0) write[1] = clipResult;
		if (write[0] === io.IO_GEO_DST1) write[1] = clipSummary;
	}
	[shapes + 64, 0, 0, 1, 1].forEach((word, index) => failing.writes.push([instances + 40 + index * 4, word]));
	[geo.GEO_PRIMITIVE_AABB, 4, 16, 16, ...[-1,-1,1,1].map(numberToF32Bits)]
		.forEach((word, index) => failing.writes.push([shapes + 64 + index * 4, word]));
	for (let i = 0; i < 18; i++) failing.writes.push([clipResult + i * 4, 0xdeadbeef]);
	failing.writes.push(lastCommand);
	failing.reads = [io.IO_GEO_STATUS, io.IO_GEO_FAULT, io.IO_GEO_PROCESSED, io.IO_IRQ_FLAGS,
		...Array.from({length: 18}, (_, i) => clipResult + i * 4),
		...Array.from({length: 4}, (_, i) => clipSummary + i * 4)];
	const completed = { ...failing, name: 'overlap-contact-before-clip-fault', clipCapacityBoundary: 0,
		writes: failing.writes.map(([address, word]): [number, number] => [address, address === io.IO_GEO_COUNT ? 2 : word]) };
	result.push(completed);
	result.push(failing);
	// Exercise the bounded XFORM input/output buffer with raw fixed-point
	// extremes, fractional products and saturation at both vertex limits.
	for (const count of [4, geo.GEO_XFORM2_MAX_VERTICES]) {
		const record = GEO_BUFFERS + 0x1000, source = record + 0x100, matrix = record + 0x400;
		const destination = record + 0x500, bounds = record + 0x800;
		const writes: [number, number][] = [];
		const words = (address: number, values: readonly number[]) => values.forEach((word, index) => writes.push([address + index * 4, word >>> 0]));
		words(record, [0, 0, 0, 0, count, 0]);
		const raw = [0x7fffffff, 0x80000000, 0x10001, 0xffff7fff, 0, 0xffffffff, 0x12345678, 0x87654321];
		words(source, Array.from({ length: count * 2 }, (_, index) => raw[index % raw.length]));
		words(matrix, [0x7fffffff, 0x80000000, 0x17fff, 0x10001, 0xffff0000, 0x80000000]);
		words(destination, new Array(count * 2).fill(0xdeadbeef));
		words(bounds, new Array(4).fill(0xdeadbeef));
		writes.push(
			[io.IO_GEO_SRC0, record], [io.IO_GEO_SRC1, source], [io.IO_GEO_SRC2, matrix],
			[io.IO_GEO_DST0, destination], [io.IO_GEO_DST1, bounds], [io.IO_GEO_COUNT, 1],
			[io.IO_GEO_STRIDE0, 24], [io.IO_GEO_STRIDE1, 8], [io.IO_GEO_STRIDE2, 24],
			[io.IO_GEO_CMD, geo.IO_CMD_GEO_XFORM2_BATCH],
		);
		result.push({ name: `xform-raw-${count}`, writes, pairCounterSeed: 0, firstRecordPairs: 0, clipCapacityBoundary: 0,
			reads: [io.IO_GEO_STATUS, io.IO_GEO_FAULT, io.IO_GEO_PROCESSED,
				...Array.from({ length: count * 2 }, (_, index) => destination + index * 4),
				...Array.from({ length: 4 }, (_, index) => bounds + index * 4)] });
	}
	return result;
}
