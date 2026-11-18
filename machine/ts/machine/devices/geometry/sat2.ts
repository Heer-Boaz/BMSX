import {
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_SRC_RANGE,
	GEO_SAT_META_AXIS_MASK,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SAT2_DESC_FLAGS_OFFSET,
	GEO_SAT2_DESC_BYTES,
	GEO_SAT2_DESC_RESERVED_OFFSET,
	GEO_SAT2_DESC_VERTEX_COUNT_OFFSET,
	GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET,
	GEO_SAT2_PAIR_BYTES,
	GEO_SAT2_PAIR_FLAGS2_OFFSET,
	GEO_SAT2_PAIR_FLAGS_OFFSET,
	GEO_SAT2_PAIR_RESULT_INDEX_OFFSET,
	GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET,
	GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET,
	GEO_SAT2_RESULT_BYTES,
	GEO_SAT2_RESULT_DEPTH_OFFSET,
	GEO_SAT2_RESULT_HIT_OFFSET,
	GEO_SAT2_RESULT_META_OFFSET,
	GEO_SAT2_RESULT_NX_OFFSET,
	GEO_SAT2_RESULT_NY_OFFSET,
	GEO_SAT2_MAX_POLY_VERTICES,
	GEO_SHAPE_CONVEX_POLY,
	GEO_VERTEX2_BYTES,
} from './contracts';
import { GEOMETRY_WORD_ALIGN_MASK, geometryIndexedAddr, geometryIndexedSpanFits } from './addressing';
import { GeometryProjectionSpan } from './projection';
import type { GeometryJobState } from './job';
import type { Memory } from '../../memory/memory';
import type { MemoryWordCounters } from '../../memory/word_counters';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import {
	FIX16_SCALE,
	saturateRoundedI32,
	toSignedWord,
} from '../../common/numeric';

function packSat2Meta(axisIndex: number, shapeSelector: number): number {
	return (((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK)) >>> 0;
}

export enum GeometrySat2Phase { Record, LoadA, LoadB, Compute, Publish, Complete }

export type GeometrySat2Progress = {
	phase: GeometrySat2Phase;
	vertexAddressA: number; vertexAddressB: number;
	countA: number; countB: number; resultAddress: number;
	verticesA: Uint32Array; verticesB: Uint32Array; result: Uint32Array;
	pendingMemory: MemoryWordCounters;
	pendingWorkUnits: number; pendingFault: number;
};

export class GeometrySat2Unit {
	private readonly projectionA = new GeometryProjectionSpan();
	private readonly projectionB = new GeometryProjectionSpan();
	private readonly state: GeometrySat2Progress = {
		phase: GeometrySat2Phase.Record,
		vertexAddressA: 0, vertexAddressB: 0, countA: 0, countB: 0, resultAddress: 0,
		verticesA: new Uint32Array(GEO_SAT2_MAX_POLY_VERTICES * 2),
		verticesB: new Uint32Array(GEO_SAT2_MAX_POLY_VERTICES * 2),
		result: new Uint32Array(5),
		pendingMemory: { ramWords: 0, systemRomWords: 0, cartridgeWords: 0, otherWords: 0 },
		pendingWorkUnits: 0, pendingFault: 0,
	};

	public constructor(private readonly memory: Memory) {}

	public reset(): void {
		const s = this.state;
		s.phase = GeometrySat2Phase.Record;
		s.vertexAddressA = s.vertexAddressB = s.countA = s.countB = s.resultAddress = 0;
		s.verticesA.fill(0); s.verticesB.fill(0); s.result.fill(0);
		s.pendingMemory.ramWords = s.pendingMemory.systemRomWords = s.pendingMemory.cartridgeWords = s.pendingMemory.otherWords = 0;
		s.pendingWorkUnits = s.pendingFault = 0;
	}

	public beginJob(): void {
		const s = this.state;
		s.phase = GeometrySat2Phase.Record;
		s.pendingMemory.ramWords = s.pendingMemory.systemRomWords = s.pendingMemory.cartridgeWords = s.pendingMemory.otherWords = 0;
		s.pendingWorkUnits = s.pendingFault = 0;
	}
	public progress(): GeometrySat2Progress { return this.state; }
	public captureState(): GeometrySat2Progress {
		const s = this.state;
		return { ...s, verticesA: s.verticesA.slice(), verticesB: s.verticesB.slice(), result: s.result.slice(), pendingMemory: { ...s.pendingMemory } };
	}
	public restoreState(saved: GeometrySat2Progress): void {
		const s = this.state;
		s.phase = saved.phase;
		s.vertexAddressA = saved.vertexAddressA;
		s.vertexAddressB = saved.vertexAddressB;
		s.countA = saved.countA;
		s.countB = saved.countB;
		s.resultAddress = saved.resultAddress;
		s.verticesA.set(saved.verticesA); s.verticesB.set(saved.verticesB); s.result.set(saved.result);
		Object.assign(s.pendingMemory, saved.pendingMemory);
		s.pendingWorkUnits = saved.pendingWorkUnits; s.pendingFault = saved.pendingFault;
	}

	public processStep(job: GeometryJobState): void {
		const s = this.state, memory = this.memory, words = s.pendingMemory;
		words.ramWords = words.systemRomWords = words.cartridgeWords = words.otherWords = 0;
		s.pendingWorkUnits = s.pendingFault = 0;
		switch (s.phase) {
			case GeometrySat2Phase.Record: {
				const pairAddr = geometryIndexedAddr(job.src0, job.processed, job.stride0);
				if (!geometryIndexedSpanFits(job.src0, job.processed, job.stride0, GEO_SAT2_PAIR_BYTES)) {
					s.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				if (!memory.isReadableMainMemoryRange(pairAddr, GEO_SAT2_PAIR_BYTES)) {
					s.pendingFault = GEO_FAULT_SRC_RANGE;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				const flags = memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET, words);
				const indexA = memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET, words);
				const resultIndex = memory.readU32(pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET, words);
				const indexB = memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET, words);
				const flags2 = memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET, words);
				if (flags !== 0 || flags2 !== 0) {
					s.pendingFault = GEO_FAULT_BAD_RECORD_FLAGS;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				const resultAddress = geometryIndexedAddr(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES);
				if (!geometryIndexedSpanFits(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES)
					|| !memory.isRamRange(resultAddress, GEO_SAT2_RESULT_BYTES)) {
					s.pendingFault = GEO_FAULT_DST_RANGE;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				const descA = geometryIndexedAddr(job.src1, indexA, job.stride1);
				const descB = geometryIndexedAddr(job.src1, indexB, job.stride1);
				if (!geometryIndexedSpanFits(job.src1, indexA, job.stride1, GEO_SAT2_DESC_BYTES)
					|| !geometryIndexedSpanFits(job.src1, indexB, job.stride1, GEO_SAT2_DESC_BYTES)
					|| !memory.isReadableMainMemoryRange(descA, GEO_SAT2_DESC_BYTES)
					|| !memory.isReadableMainMemoryRange(descB, GEO_SAT2_DESC_BYTES)) {
					s.pendingFault = GEO_FAULT_SRC_RANGE;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				const kindA = memory.readU32(descA + GEO_SAT2_DESC_FLAGS_OFFSET, words);
				const countA = memory.readU32(descA + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, words);
				const offsetA = memory.readU32(descA + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, words);
				const reservedA = memory.readU32(descA + GEO_SAT2_DESC_RESERVED_OFFSET, words);
				const kindB = memory.readU32(descB + GEO_SAT2_DESC_FLAGS_OFFSET, words);
				const countB = memory.readU32(descB + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, words);
				const offsetB = memory.readU32(descB + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, words);
				const reservedB = memory.readU32(descB + GEO_SAT2_DESC_RESERVED_OFFSET, words);
				if (kindA !== GEO_SHAPE_CONVEX_POLY || kindB !== GEO_SHAPE_CONVEX_POLY || reservedA !== 0 || reservedB !== 0) {
					s.pendingFault = GEO_FAULT_DESCRIPTOR_KIND;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				if (countA < 3 || countB < 3) {
					s.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				if ((offsetA & GEOMETRY_WORD_ALIGN_MASK) !== 0 || (offsetB & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
					s.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				if (countA > GEO_SAT2_MAX_POLY_VERTICES || countB > GEO_SAT2_MAX_POLY_VERTICES) {
					s.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				const addressA = geometryIndexedAddr(job.src2, offsetA, 1), addressB = geometryIndexedAddr(job.src2, offsetB, 1);
				const bytesA = countA * GEO_VERTEX2_BYTES, bytesB = countB * GEO_VERTEX2_BYTES;
				if (!geometryIndexedSpanFits(job.src2, offsetA, 1, bytesA) || !geometryIndexedSpanFits(job.src2, offsetB, 1, bytesB)
					|| !memory.isReadableMainMemoryRange(addressA, bytesA) || !memory.isReadableMainMemoryRange(addressB, bytesB)) {
					s.pendingFault = GEO_FAULT_SRC_RANGE;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				s.vertexAddressA = addressA;
				s.vertexAddressB = addressB;
				s.countA = countA;
				s.countB = countB;
				s.resultAddress = resultAddress;
				s.phase = GeometrySat2Phase.LoadA;
				return;
			}
			case GeometrySat2Phase.LoadA:
				for (let i = 0; i < s.countA * 2; ++i) {
					s.verticesA[i] = memory.readU32(s.vertexAddressA + i * 4, words);
				}
				s.phase = GeometrySat2Phase.LoadB;
				return;
			case GeometrySat2Phase.LoadB:
				for (let i = 0; i < s.countB * 2; ++i) {
					s.verticesB[i] = memory.readU32(s.vertexAddressB + i * 4, words);
				}
				s.phase = GeometrySat2Phase.Compute;
				return;
			case GeometrySat2Phase.Compute: {
				let centerAX = 0, centerAY = 0, centerBX = 0, centerBY = 0;
				for (let i = 0; i < s.countA; ++i) {
					centerAX += toSignedWord(s.verticesA[i * 2]);
					centerAY += toSignedWord(s.verticesA[i * 2 + 1]);
				}
				for (let i = 0; i < s.countB; ++i) {
					centerBX += toSignedWord(s.verticesB[i * 2]);
					centerBY += toSignedWord(s.verticesB[i * 2 + 1]);
				}
				s.pendingWorkUnits += s.countA + s.countB + 4;
				centerAX /= s.countA;
				centerAY /= s.countA;
				centerBX /= s.countB;
				centerBY /= s.countB;
				let bestOverlap = Infinity, bestAxisX = 0, bestAxisY = 0, bestAxisIndex = 0;
				let bestShapeSelector = GEO_SAT_META_SHAPE_SRC, sawAxis = false, separated = false;
				for (let selector = GEO_SAT_META_SHAPE_SRC; selector <= GEO_SAT_META_SHAPE_AUX && !separated; ++selector) {
					const vertices = selector === GEO_SAT_META_SHAPE_SRC ? s.verticesA : s.verticesB;
					const count = selector === GEO_SAT_META_SHAPE_SRC ? s.countA : s.countB;
					for (let edge = 0; edge < count; ++edge) {
						const next = edge + 1 === count ? 0 : edge + 1;
						const x0 = toSignedWord(vertices[edge * 2]), y0 = toSignedWord(vertices[edge * 2 + 1]);
						const x1 = toSignedWord(vertices[next * 2]), y1 = toSignedWord(vertices[next * 2 + 1]);
						const nx = -(y1 - y0), ny = x1 - x0;
						const length = Math.sqrt(nx * nx + ny * ny);
						s.pendingWorkUnits += 2;
						if (!(length > 0)) continue;
						sawAxis = true;
						s.pendingWorkUnits += 2 + s.countA + s.countB;
						const ax = nx / length, ay = ny / length;
						this.projectVertexSpanInto(s.verticesA, s.countA, ax, ay, this.projectionA);
						this.projectVertexSpanInto(s.verticesB, s.countB, ax, ay, this.projectionB);
						if (this.projectionA.min - this.projectionB.max > 0 || this.projectionB.min - this.projectionA.max > 0) {
							separated = true;
							break;
						}
						const overlap = Math.min(this.projectionA.max, this.projectionB.max) - Math.max(this.projectionA.min, this.projectionB.min);
						if (overlap < bestOverlap) {
							bestOverlap = overlap;
							bestAxisX = ax;
							bestAxisY = ay;
							bestAxisIndex = edge;
							bestShapeSelector = selector;
						}
					}
				}
				if (!sawAxis) {
					s.pendingFault = GEO_FAULT_DESCRIPTOR_KIND;
					s.phase = GeometrySat2Phase.Complete;
					return;
				}
				if (separated) {
					s.result.fill(0);
				} else {
					if ((centerBX - centerAX) * bestAxisX + (centerBY - centerAY) * bestAxisY < 0) {
						bestAxisX = -bestAxisX;
						bestAxisY = -bestAxisY;
					}
					s.result[0] = 1;
					s.result[1] = saturateRoundedI32(bestAxisX * FIX16_SCALE) >>> 0;
					s.result[2] = saturateRoundedI32(bestAxisY * FIX16_SCALE) >>> 0;
					s.result[3] = saturateRoundedI32(bestOverlap) >>> 0;
					s.result[4] = packSat2Meta(bestAxisIndex, bestShapeSelector);
				}
				words.ramWords += GEO_SAT2_RESULT_BYTES / IO_WORD_SIZE;
				s.phase = GeometrySat2Phase.Publish;
				return;
			}
			case GeometrySat2Phase.Publish:
				memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_HIT_OFFSET, s.result[0]);
				memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_NX_OFFSET, s.result[1]);
				memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_NY_OFFSET, s.result[2]);
				memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_DEPTH_OFFSET, s.result[3]);
				memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_META_OFFSET, s.result[4]);
				s.phase = GeometrySat2Phase.Complete;
				return;
		}
	}

	private projectVertexSpanInto(vertices: Uint32Array, count: number, ax: number, ay: number, out: GeometryProjectionSpan): void {
		let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < count; ++i) {
			const projection = toSignedWord(vertices[i * 2]) * ax + toSignedWord(vertices[i * 2 + 1]) * ay;
			if (projection < min) min = projection;
			if (projection > max) max = projection;
		}
		out.min = min; out.max = max;
	}
}
