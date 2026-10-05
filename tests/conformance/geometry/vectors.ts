import { numberToF32Bits, encodeSignedFix16 } from '../../../machine/ts/machine/common/numeric';
import { GEO_SCRATCH_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import * as io from '../../../machine/ts/spec/bmsx/io';
import * as geo from '../../../machine/ts/machine/devices/geometry/contracts';

export type GeometryVector = { name: string; writes: [number, number][]; reads: number[] };
const instances = GEO_SCRATCH_BASE, shapes = GEO_SCRATCH_BASE + 0x100, vertices = GEO_SCRATCH_BASE + 0x200;
const result = GEO_SCRATCH_BASE + 0x400, summary = GEO_SCRATCH_BASE + 0x500;

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
	return { name, writes, reads: [io.IO_GEO_STATUS, io.IO_GEO_FAULT, io.IO_GEO_PROCESSED,
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
	return result;
}
