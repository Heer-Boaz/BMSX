import { f32BitsToNumber, numberToF32Bits } from '../../../common/float32';
import type { Memory } from '../../memory/memory';
import type { MemoryWordCounters } from '../../memory/word_counters';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import { geometryByteAddr, geometryByteSpanFits, geometryIndexedAddr, geometryIndexedSpanFits } from './addressing';
import {
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_RESULT_CAPACITY,
	GEO_FAULT_CLIP_CAPACITY,
	GEO_FAULT_SRC_RANGE,
	GEO_OVERLAP2D_AABB_DATA_COUNT,
	GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET,
	GEO_OVERLAP2D_INSTANCE_MASK_OFFSET,
	GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TX_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TY_OFFSET,
	GEO_OVERLAP2D_INSTANCE_BYTES,
	GEO_OVERLAP2D_INSTANCE_WORDS,
	GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS,
	GEO_OVERLAP2D_MODE_MASK,
	GEO_OVERLAP2D_MAX_CLIP_VERTICES,
	GEO_OVERLAP2D_MAX_POLY_VERTICES,
	GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET,
	GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET,
	GEO_OVERLAP2D_PAIR_BYTES,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK,
	GEO_OVERLAP2D_PAIR_META_OFFSET,
	GEO_OVERLAP2D_RESULT_BYTES,
	GEO_OVERLAP2D_RESULT_WORDS,
	GEO_OVERLAP2D_SUMMARY_BYTES,
	GEO_OVERLAP2D_RESULT_DEPTH_OFFSET,
	GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET,
	GEO_OVERLAP2D_RESULT_NX_OFFSET,
	GEO_OVERLAP2D_RESULT_NY_OFFSET,
	GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET,
	GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET,
	GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET,
	GEO_OVERLAP2D_RESULT_PX_OFFSET,
	GEO_OVERLAP2D_RESULT_PY_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES,
	GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_DESC_BYTES,
	GEO_OVERLAP2D_SHAPE_KIND_COMPOUND,
	GEO_OVERLAP2D_SHAPE_KIND_OFFSET,
	GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET,
	GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET,
	GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW,
	GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET,
	GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET,
	GEO_PRIMITIVE_AABB,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_VERTEX2_BYTES,
} from './contracts';
import { GeometryProjectionSpan } from './projection';
import type { GeometryJobState } from './job';

export enum GeometryOverlap2dPhase { Record, Pair, Piece, CompletePiece, Publish, Initialized }

export type GeometryWork = {
	axes: number;
	projectionVertices: number;
	averageVertices: number;
	clipVertices: number;
	clipEdges: number;
	squareRoots: number;
	divisions: number;
};

export type GeometryOverlap2dProgress = {
	phase: GeometryOverlap2dPhase;
	instanceBIndex: number;
	pairMeta: number;
	shapeAAddr: number; shapeBAddr: number;
	shapeAOffset: number; shapeBOffset: number;
	countA: number; countB: number;
	pieceA: number; pieceB: number;
	compoundA: boolean; compoundB: boolean; bestHit: boolean;
	bestPieceA: number; bestPieceB: number; bestFeature: number;
	bestDepth: number; bestNx: number; bestNy: number; bestPx: number; bestPy: number;
	instanceA: Uint32Array;
	instanceB: Uint32Array;
	boundsA: Float64Array;
	pendingWork: GeometryWork;
	pendingMemory: MemoryWordCounters;
	pendingWriteFlags: number;
	afterPublishPhase: GeometryOverlap2dPhase;
	pendingFault: number;
};

type PointScratch = { x: number; y: number };
type GeometryPolyView = {
	primitive: number;
	vertexCount: number;
	vertices: Float64Array;
	left: number;
	top: number;
	right: number;
	bottom: number;
};

const GEO_FAULT_NONE = 0;
const GEO_OVERLAP2D_CLIP_COORDS = GEO_OVERLAP2D_MAX_CLIP_VERTICES * 2;

export class GeometryOverlap2dUnit {
	private readonly pair: GeometryOverlap2dProgress = {
		phase: GeometryOverlap2dPhase.Record, instanceBIndex: 0, pairMeta: 0,
		shapeAAddr: 0, shapeBAddr: 0, shapeAOffset: 0, shapeBOffset: 0,
		countA: 0, countB: 0, pieceA: 0, pieceB: 0,
		compoundA: false, compoundB: false, bestHit: false,
		bestPieceA: 0, bestPieceB: 0, bestFeature: 0,
		bestDepth: 0, bestNx: 0, bestNy: 0, bestPx: 0, bestPy: 0,
		instanceA: new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS),
		instanceB: new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS),
		boundsA: new Float64Array(4),
		pendingWork: { axes: 0, projectionVertices: 0, averageVertices: 0,
			clipVertices: 0, clipEdges: 0, squareRoots: 0, divisions: 0 },
		pendingMemory: { ramWords: 0, systemRomWords: 0, cartridgeWords: 0, otherWords: 0 },
		pendingWriteFlags: 0, afterPublishPhase: GeometryOverlap2dPhase.Record,
		pendingFault: 0,
	};
	private readonly polyA: GeometryPolyView = {
		primitive: 0,
		vertexCount: 0,
		vertices: new Float64Array(GEO_OVERLAP2D_MAX_POLY_VERTICES * 2),
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
	};
	private readonly polyB: GeometryPolyView = {
		primitive: 0,
		vertexCount: 0,
		vertices: new Float64Array(GEO_OVERLAP2D_MAX_POLY_VERTICES * 2),
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
	};
	private readonly clip0 = new Float64Array(GEO_OVERLAP2D_CLIP_COORDS);
	private readonly clip1 = new Float64Array(GEO_OVERLAP2D_CLIP_COORDS);
	private clipResult = this.clip0;
	private clipResultVertexCount = 0;
	private readonly boundsB = new Float64Array(4);
	private readonly projectionA = new GeometryProjectionSpan();
	private readonly projectionB = new GeometryProjectionSpan();
	private readonly centerA: PointScratch = { x: 0, y: 0 };
	private readonly centerB: PointScratch = { x: 0, y: 0 };
	private readonly centroid: PointScratch = { x: 0, y: 0 };
	private readonly vertex0: PointScratch = { x: 0, y: 0 };
	private readonly vertex1: PointScratch = { x: 0, y: 0 };
	private contactHit = false;
	private contactNx = 0;
	private contactNy = 0;
	private contactDepth = 0;
	private contactPx = 0;
	private contactPy = 0;
	private contactFeatureMeta = 0;

	public constructor(private readonly memory: Memory) {}

	public reset(): void {
		const pair = this.pair;
		pair.phase = GeometryOverlap2dPhase.Record;
		pair.instanceBIndex = pair.pairMeta = pair.shapeAAddr = pair.shapeBAddr = 0;
		pair.shapeAOffset = pair.shapeBOffset = pair.countA = pair.countB = 0;
		pair.pieceA = pair.pieceB = pair.bestPieceA = pair.bestPieceB = pair.bestFeature = 0;
		pair.compoundA = pair.compoundB = pair.bestHit = false;
		pair.bestDepth = pair.bestNx = pair.bestNy = pair.bestPx = pair.bestPy = 0;
		pair.instanceA.fill(0); pair.instanceB.fill(0); pair.boundsA.fill(0);
		pair.pendingFault = pair.pendingWriteFlags = 0;
		pair.afterPublishPhase = GeometryOverlap2dPhase.Record;
		pair.pendingMemory.ramWords = pair.pendingMemory.systemRomWords = pair.pendingMemory.cartridgeWords = pair.pendingMemory.otherWords = 0;
		const work = pair.pendingWork;
		work.axes = work.projectionVertices = work.averageVertices = work.clipVertices = 0;
		work.clipEdges = work.squareRoots = work.divisions = 0;
	}

	public beginJob(job: GeometryJobState): void {
		this.reset();
		this.pair.pendingWriteFlags = 2;
		this.pair.afterPublishPhase = GeometryOverlap2dPhase.Initialized;
		this.pair.phase = GeometryOverlap2dPhase.Publish;
		this.pricePendingWrites(job);
	}

	public readProgress(): Readonly<GeometryOverlap2dProgress> { return this.pair; }

	public captureState(): GeometryOverlap2dProgress {
		const pair = this.pair;
		return { ...pair, instanceA: pair.instanceA.slice(), instanceB: pair.instanceB.slice(),
			boundsA: pair.boundsA.slice(), pendingWork: { ...pair.pendingWork }, pendingMemory: { ...pair.pendingMemory } };
	}

	public restoreState(state: GeometryOverlap2dProgress): void {
		const pair = this.pair;
		pair.phase = state.phase; pair.instanceBIndex = state.instanceBIndex;
		pair.pairMeta = state.pairMeta;
		pair.shapeAAddr = state.shapeAAddr; pair.shapeBAddr = state.shapeBAddr;
		pair.shapeAOffset = state.shapeAOffset; pair.shapeBOffset = state.shapeBOffset;
		pair.countA = state.countA; pair.countB = state.countB;
		pair.pieceA = state.pieceA; pair.pieceB = state.pieceB;
		pair.compoundA = state.compoundA; pair.compoundB = state.compoundB;
		pair.bestHit = state.bestHit;
		pair.bestPieceA = state.bestPieceA; pair.bestPieceB = state.bestPieceB;
		pair.bestFeature = state.bestFeature; pair.bestDepth = state.bestDepth;
		pair.bestNx = state.bestNx; pair.bestNy = state.bestNy;
		pair.bestPx = state.bestPx; pair.bestPy = state.bestPy;
		pair.instanceA.set(state.instanceA); pair.instanceB.set(state.instanceB);
		pair.boundsA.set(state.boundsA);
		Object.assign(pair.pendingWork, state.pendingWork);
		Object.assign(pair.pendingMemory, state.pendingMemory);
		pair.pendingWriteFlags = state.pendingWriteFlags;
		pair.afterPublishPhase = state.afterPublishPhase;
		pair.pendingFault = state.pendingFault;
	}

	public processStep(job: GeometryJobState): number {
		const pair = this.pair;
		if (pair.phase === GeometryOverlap2dPhase.Publish) return this.publish(job);
		const work = pair.pendingWork, memory = pair.pendingMemory;
		work.axes = work.projectionVertices = work.averageVertices = work.clipVertices = 0;
		work.clipEdges = work.squareRoots = work.divisions = 0;
		memory.ramWords = memory.systemRomWords = memory.cartridgeWords = memory.otherWords = 0;
		let fault: number;
		switch (pair.phase) {
			case GeometryOverlap2dPhase.Record:
			case GeometryOverlap2dPhase.Initialized: fault = this.beginRecord(job); break;
			case GeometryOverlap2dPhase.Pair: fault = this.beginPair(job); break;
			case GeometryOverlap2dPhase.Piece: fault = this.processPiece(); break;
			case GeometryOverlap2dPhase.CompletePiece: fault = this.completePiece(job); break;
		}
		if (fault !== GEO_FAULT_NONE) {
			pair.pendingFault = fault;
			pair.pendingWriteFlags = 0;
			pair.phase = GeometryOverlap2dPhase.Publish;
		}
		if (pair.phase === GeometryOverlap2dPhase.Publish) this.pricePendingWrites(job);
		return GEO_FAULT_NONE;
	}

	private writeSummary(job: GeometryJobState, flags: number): void {
		this.memory.writeU32(geometryByteAddr(job.dst1, GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET), job.resultCount >>> 0);
		this.memory.writeU32(geometryByteAddr(job.dst1, GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET), job.exactPairCount);
		this.memory.writeU32(geometryByteAddr(job.dst1, GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET), job.broadphasePairCount);
		this.memory.writeU32(geometryByteAddr(job.dst1, GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET), flags >>> 0);
	}

	private beginRecord(job: GeometryJobState): number {
		const pair = this.pair;
		if ((job.param0 & GEO_OVERLAP2D_MODE_MASK) === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			const address = geometryIndexedAddr(job.src1, job.processed, job.stride1);
			if (!geometryIndexedSpanFits(job.src1, job.processed, job.stride1, GEO_OVERLAP2D_PAIR_BYTES)
				|| !this.memory.isReadableMainMemoryRange(address, GEO_OVERLAP2D_PAIR_BYTES)) return GEO_FAULT_SRC_RANGE;
			const a = this.memory.readU32(address + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET, this.pair.pendingMemory);
			const b = this.memory.readU32(address + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET, this.pair.pendingMemory);
			pair.pairMeta = this.memory.readU32(address + GEO_OVERLAP2D_PAIR_META_OFFSET, this.pair.pendingMemory);
			if (a === b) return GEO_FAULT_BAD_RECORD_FLAGS;
			if (a >= job.stride2 || b >= job.stride2) return GEO_FAULT_SRC_RANGE;
			if (!this.readInstanceAt(job, a, pair.instanceA) || !this.readInstanceAt(job, b, pair.instanceB)) return GEO_FAULT_SRC_RANGE;
		} else {
			if (!this.readInstanceAt(job, job.processed, pair.instanceA)) return GEO_FAULT_SRC_RANGE;
			pair.instanceBIndex = (job.processed + 1) >>> 0;
			if (pair.instanceBIndex >= job.count) {
				pair.pendingWriteFlags = 2;
				pair.afterPublishPhase = GeometryOverlap2dPhase.Record;
				pair.phase = GeometryOverlap2dPhase.Publish;
				return GEO_FAULT_NONE;
			}
		}
		pair.phase = GeometryOverlap2dPhase.Pair;
		return GEO_FAULT_NONE;
	}

	private readInstanceAt(job: GeometryJobState, instanceIndex: number, out: Uint32Array): boolean {
		const instanceAddr = geometryIndexedAddr(job.src0, instanceIndex, job.stride0);
		if (!geometryIndexedSpanFits(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES)
			|| !this.memory.isReadableMainMemoryRange(instanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
			return false;
		}
		out[0] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, this.pair.pendingMemory);
		out[1] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TX_OFFSET, this.pair.pendingMemory);
		out[2] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TY_OFFSET, this.pair.pendingMemory);
		out[3] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET, this.pair.pendingMemory);
		out[4] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_MASK_OFFSET, this.pair.pendingMemory);
		return true;
	}

	private beginPair(job: GeometryJobState): number {
		const pair = this.pair;
		if ((job.param0 & GEO_OVERLAP2D_MODE_MASK) !== GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			if (!this.readInstanceAt(job, pair.instanceBIndex, pair.instanceB)) return GEO_FAULT_SRC_RANGE;
			pair.pairMeta = (((job.processed & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
				| (pair.instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK)) >>> 0;
		}
		const shapeA = pair.instanceA[0], shapeB = pair.instanceB[0];
		if (!this.memory.isReadableMainMemoryRange(shapeA, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeB, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
		if ((pair.instanceA[4] & pair.instanceB[3]) === 0 || (pair.instanceB[4] & pair.instanceA[3]) === 0) return this.finishPair(job);
		job.broadphasePairCount = (job.broadphasePairCount + 1) >>> 0;
		const txA = f32BitsToNumber(pair.instanceA[1]), tyA = f32BitsToNumber(pair.instanceA[2]);
		const txB = f32BitsToNumber(pair.instanceB[1]), tyB = f32BitsToNumber(pair.instanceB[2]);
		const faultA = this.readPieceBounds(shapeA, txA, tyA, pair.boundsA);
		if (faultA !== GEO_FAULT_NONE) return faultA;
		const faultB = this.readPieceBounds(shapeB, txB, tyB, this.boundsB);
		if (faultB !== GEO_FAULT_NONE) return faultB;
		if (!this.boundsOverlap(pair.boundsA, this.boundsB)) return this.finishPair(job);
		const kindA = this.memory.readU32(shapeA + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, this.pair.pendingMemory);
		const countA = this.memory.readU32(shapeA + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, this.pair.pendingMemory);
		const offsetA = this.memory.readU32(shapeA + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, this.pair.pendingMemory);
		const kindB = this.memory.readU32(shapeB + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, this.pair.pendingMemory);
		const countB = this.memory.readU32(shapeB + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, this.pair.pendingMemory);
		const offsetB = this.memory.readU32(shapeB + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, this.pair.pendingMemory);
		pair.compoundA = kindA === GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
		pair.compoundB = kindB === GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
		pair.countA = pair.compoundA ? countA : 1;
		pair.countB = pair.compoundB ? countB : 1;
		if (pair.countA === 0 || pair.countB === 0
			|| (!pair.compoundA && kindA !== GEO_PRIMITIVE_AABB && kindA !== GEO_PRIMITIVE_CONVEX_POLY)
			|| (!pair.compoundB && kindB !== GEO_PRIMITIVE_AABB && kindB !== GEO_PRIMITIVE_CONVEX_POLY)) return GEO_FAULT_DESCRIPTOR_KIND;
		job.exactPairCount = (job.exactPairCount + 1) >>> 0;
		pair.shapeAAddr = shapeA; pair.shapeBAddr = shapeB;
		pair.shapeAOffset = offsetA; pair.shapeBOffset = offsetB;
		pair.pieceA = 0; pair.pieceB = 0; pair.bestHit = false;
		pair.bestDepth = Number.POSITIVE_INFINITY;
		pair.bestPieceA = 0; pair.bestPieceB = 0; pair.bestFeature = 0;
		pair.bestNx = 0; pair.bestNy = 0; pair.bestPx = 0; pair.bestPy = 0;
		pair.phase = GeometryOverlap2dPhase.Piece;
		return GEO_FAULT_NONE;
	}

	private processPiece(): number {
		const pair = this.pair;
		pair.pendingFault = 0;
		const txA = f32BitsToNumber(pair.instanceA[1]), tyA = f32BitsToNumber(pair.instanceA[2]);
		const txB = f32BitsToNumber(pair.instanceB[1]), tyB = f32BitsToNumber(pair.instanceB[2]);
		const offsetA = pair.shapeAOffset + pair.pieceA * GEO_OVERLAP2D_SHAPE_DESC_BYTES;
		const pieceA = pair.compoundA ? geometryByteAddr(pair.shapeAAddr, offsetA) : pair.shapeAAddr;
		if (pair.pieceB === 0) {
			if ((pair.compoundA && !geometryByteSpanFits(pair.shapeAAddr, offsetA, GEO_OVERLAP2D_SHAPE_DESC_BYTES))
				|| !this.memory.isReadableMainMemoryRange(pieceA, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
			const fault = this.readPieceBounds(pieceA, txA, tyA, pair.boundsA);
			if (fault !== GEO_FAULT_NONE) return fault;
		}
		const offsetB = pair.shapeBOffset + pair.pieceB * GEO_OVERLAP2D_SHAPE_DESC_BYTES;
		const pieceB = pair.compoundB ? geometryByteAddr(pair.shapeBAddr, offsetB) : pair.shapeBAddr;
		if ((pair.compoundB && !geometryByteSpanFits(pair.shapeBAddr, offsetB, GEO_OVERLAP2D_SHAPE_DESC_BYTES))
			|| !this.memory.isReadableMainMemoryRange(pieceB, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
		const boundsFault = this.readPieceBounds(pieceB, txB, tyB, this.boundsB);
		if (boundsFault !== GEO_FAULT_NONE) return boundsFault;
		if (this.boundsOverlap(pair.boundsA, this.boundsB)) {
			const fault = this.computePiecePairContact(pieceA, txA, tyA, pieceB, txB, tyB);
			if (fault !== GEO_FAULT_NONE) return fault;
			if (this.contactHit && (!pair.bestHit || this.contactDepth < pair.bestDepth
				|| (this.contactDepth === pair.bestDepth && (pair.pieceA < pair.bestPieceA
					|| (pair.pieceA === pair.bestPieceA && (pair.pieceB < pair.bestPieceB
						|| (pair.pieceB === pair.bestPieceB && this.contactFeatureMeta < pair.bestFeature))))))) {
				pair.bestHit = true; pair.bestDepth = this.contactDepth;
				pair.bestPieceA = pair.pieceA; pair.bestPieceB = pair.pieceB; pair.bestFeature = this.contactFeatureMeta;
				pair.bestNx = this.contactNx; pair.bestNy = this.contactNy; pair.bestPx = this.contactPx; pair.bestPy = this.contactPy;
			}
		}
		pair.phase = GeometryOverlap2dPhase.CompletePiece;
		return GEO_FAULT_NONE;
	}


	private completePiece(job: GeometryJobState): number {
		const pair = this.pair;
		if (pair.pendingFault !== GEO_FAULT_NONE) return pair.pendingFault;
		pair.phase = GeometryOverlap2dPhase.Piece;
		pair.pieceB = (pair.pieceB + 1) >>> 0;
		if (pair.pieceB < pair.countB) return GEO_FAULT_NONE;
		pair.pieceB = 0;
		pair.pieceA = (pair.pieceA + 1) >>> 0;
		if (pair.pieceA < pair.countA) return GEO_FAULT_NONE;
		pair.pendingWriteFlags = 0;
		if (pair.bestHit) {
			if (job.resultCount >= job.param1) {
				pair.pendingWriteFlags = 2 | 4;
				pair.pendingFault = GEO_FAULT_RESULT_CAPACITY;
				pair.afterPublishPhase = GeometryOverlap2dPhase.Record;
				pair.phase = GeometryOverlap2dPhase.Publish;
				return GEO_FAULT_NONE;
			}
			const address = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
			if (!geometryIndexedSpanFits(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES)
				|| !this.memory.isRamRange(address, GEO_OVERLAP2D_RESULT_BYTES)) return GEO_FAULT_DST_RANGE;
			pair.pendingWriteFlags = 1;
		}
		return this.finishPair(job);
	}

	private finishPair(job: GeometryJobState): number {
		const pair = this.pair;
		const candidate = (job.param0 & GEO_OVERLAP2D_MODE_MASK) === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS;
		if (!candidate) pair.instanceBIndex = (pair.instanceBIndex + 1) >>> 0;
		if (candidate || pair.instanceBIndex >= job.count) {
			pair.pendingWriteFlags |= 2;
			pair.afterPublishPhase = GeometryOverlap2dPhase.Record;
			pair.phase = GeometryOverlap2dPhase.Publish;
		} else if ((pair.pendingWriteFlags & 1) !== 0) {
			pair.afterPublishPhase = GeometryOverlap2dPhase.Pair;
			pair.phase = GeometryOverlap2dPhase.Publish;
		} else pair.phase = GeometryOverlap2dPhase.Pair;
		return GEO_FAULT_NONE;
	}

	private pricePendingWrites(job: GeometryJobState): void {
		const pair = this.pair;
		if ((pair.pendingWriteFlags & 1) !== 0) {
			const address = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
			for (let word = 0; word < GEO_OVERLAP2D_RESULT_WORDS; ++word) {
				this.memory.countRawWriteU32(address + word * IO_WORD_SIZE, pair.pendingMemory);
			}
		}
		if ((pair.pendingWriteFlags & 2) !== 0) {
			for (let word = 0; word < GEO_OVERLAP2D_SUMMARY_BYTES / IO_WORD_SIZE; ++word) {
				this.memory.countRawWriteU32(geometryByteAddr(job.dst1, word * IO_WORD_SIZE), pair.pendingMemory);
			}
		}
	}

	private publish(job: GeometryJobState): number {
		const pair = this.pair;
		if ((pair.pendingWriteFlags & 1) !== 0) {
			const address = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
			this.writeResult(address, pair.bestNx, pair.bestNy, pair.bestDepth, pair.bestPx, pair.bestPy,
				pair.bestPieceA, pair.bestPieceB, pair.bestFeature, pair.pairMeta);
			job.resultCount = (job.resultCount + 1) >>> 0;
		}
		if ((pair.pendingWriteFlags & 2) !== 0) this.writeSummary(job, (pair.pendingWriteFlags & 4) !== 0 ? GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW : 0);
		pair.pendingWriteFlags = 0;
		pair.phase = pair.afterPublishPhase;
		return pair.pendingFault;
	}

	private readPieceBounds(pieceAddr: number, tx: number, ty: number, out: Float64Array): number {
		const boundsOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, this.pair.pendingMemory);
		const boundsAddr = geometryByteAddr(pieceAddr, boundsOffset);
		if (!geometryByteSpanFits(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)
			|| !this.memory.isReadableMainMemoryRange(boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		out[0] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET) + tx;
		out[1] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET) + ty;
		out[2] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET) + tx;
		out[3] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET) + ty;
		return GEO_FAULT_NONE;
	}

	private computePiecePairContact(pieceAAddr: number, txA: number, tyA: number, pieceBAddr: number, txB: number, tyB: number): number {
		this.contactHit = false;
		const faultA = this.loadPolyView(pieceAAddr, txA, tyA, this.polyA);
		if (faultA !== GEO_FAULT_NONE) {
			return faultA;
		}
		const faultB = this.loadPolyView(pieceBAddr, txB, tyB, this.polyB);
		if (faultB !== GEO_FAULT_NONE) {
			return faultB;
		}
		return this.computePolyPairContact(this.polyA, this.polyB);
	}

	private loadPolyView(pieceAddr: number, tx: number, ty: number, out: GeometryPolyView): number {
		const primitive = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, this.pair.pendingMemory);
		const dataCount = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, this.pair.pendingMemory);
		const dataOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, this.pair.pendingMemory);
		if (primitive === GEO_PRIMITIVE_AABB) {
			if (dataCount !== GEO_OVERLAP2D_AABB_DATA_COUNT) {
				return GEO_FAULT_BAD_VERTEX_COUNT;
			}
			const dataAddr = geometryByteAddr(pieceAddr, dataOffset);
			if (!geometryByteSpanFits(pieceAddr, dataOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)
				|| !this.memory.isReadableMainMemoryRange(dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
				return GEO_FAULT_SRC_RANGE;
			}
			out.primitive = primitive;
			out.vertexCount = GEO_OVERLAP2D_AABB_DATA_COUNT;
			out.left = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET) + tx;
			out.top = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET) + ty;
			out.right = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET) + tx;
			out.bottom = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET) + ty;
			return GEO_FAULT_NONE;
		}
		if (primitive !== GEO_PRIMITIVE_CONVEX_POLY) {
			return GEO_FAULT_DESCRIPTOR_KIND;
		}
		if (dataCount < 3 || dataCount > GEO_OVERLAP2D_MAX_POLY_VERTICES) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		const dataBytes = dataCount * GEO_VERTEX2_BYTES;
		const dataAddr = geometryByteAddr(pieceAddr, dataOffset);
		if (!geometryByteSpanFits(pieceAddr, dataOffset, dataBytes)
			|| !this.memory.isReadableMainMemoryRange(dataAddr, dataBytes)) {
			return GEO_FAULT_SRC_RANGE;
		}
		out.primitive = primitive;
		out.vertexCount = dataCount;
		for (let vertex = 0; vertex < dataCount; ++vertex) {
			const word = vertex * 2;
			out.vertices[word] = this.readF32(dataAddr + word * IO_WORD_SIZE) + tx;
			out.vertices[word + 1] = this.readF32(dataAddr + (word + 1) * IO_WORD_SIZE) + ty;
		}
		out.left = 0;
		out.top = 0;
		out.right = 0;
		out.bottom = 0;
		return GEO_FAULT_NONE;
	}

	private boundsOverlap(a: Float64Array, b: Float64Array): boolean {
		return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
	}

	private computePolyPairContact(polyA: GeometryPolyView, polyB: GeometryPolyView): number {
		let bestOverlap = Number.POSITIVE_INFINITY;
		let bestAxisX = 0;
		let bestAxisY = 0;
		let bestEdgeIndex = 0;
		let bestOwner = 0;
		let sawAxis = false;
		for (let owner = 0; owner < 2; owner += 1) {
			const poly = owner === 0 ? polyA : polyB;
			for (let edgeIndex = 0; edgeIndex < poly.vertexCount; edgeIndex += 1) {
				this.pair.pendingWork.axes += 1;
				this.pair.pendingWork.squareRoots += 1;
				const nextIndex = edgeIndex + 1 === poly.vertexCount ? 0 : edgeIndex + 1;
				this.readWorldVertexInto(poly, edgeIndex, this.vertex0);
				this.readWorldVertexInto(poly, nextIndex, this.vertex1);
				const nx = -(this.vertex1.y - this.vertex0.y);
				const ny = this.vertex1.x - this.vertex0.x;
				const len = Math.sqrt((nx * nx) + (ny * ny));
				if (!(len > 0)) {
					continue;
				}
				sawAxis = true;
				this.pair.pendingWork.divisions += 2;
				const ax = nx / len;
				const ay = ny / len;
				this.projectPolyInto(polyA, ax, ay, this.projectionA);
				this.projectPolyInto(polyB, ax, ay, this.projectionB);
				const overlap = Math.min(this.projectionA.max, this.projectionB.max) - Math.max(this.projectionA.min, this.projectionB.min);
				if (!(overlap > 0)) {
					return GEO_FAULT_NONE;
				}
				if (overlap < bestOverlap
					|| (overlap === bestOverlap && (owner < bestOwner || (owner === bestOwner && edgeIndex < bestEdgeIndex)))) {
					bestOverlap = overlap;
					bestAxisX = ax;
					bestAxisY = ay;
					bestOwner = owner;
					bestEdgeIndex = edgeIndex;
				}
			}
		}
		if (!sawAxis) {
			return GEO_FAULT_NONE;
		}
		this.computePolyAverageInto(polyA, this.centerA);
		this.computePolyAverageInto(polyB, this.centerB);
		if ((((this.centerA.x - this.centerB.x) * bestAxisX) + ((this.centerA.y - this.centerB.y) * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		let pointX;
		let pointY;
		if (!this.clipConvexPolygons(polyA, polyB)) {
			return GEO_FAULT_CLIP_CAPACITY;
		}
		if (this.clipResultVertexCount === 0) {
			pointX = (this.centerA.x + this.centerB.x) * 0.5;
			pointY = (this.centerA.y + this.centerB.y) * 0.5;
		} else {
			this.pair.pendingWork.averageVertices += this.clipResultVertexCount;
			this.pair.pendingWork.divisions += 2;
			this.computeClipAverageInto(this.clipResult, this.clipResultVertexCount, this.centroid);
			pointX = this.centroid.x;
			pointY = this.centroid.y;
		}
		this.contactNx = bestAxisX;
		this.contactNy = bestAxisY;
		this.contactDepth = bestOverlap;
		this.contactPx = pointX;
		this.contactPy = pointY;
		this.contactFeatureMeta = bestEdgeIndex >>> 0;
		this.contactHit = true;
		return GEO_FAULT_NONE;
	}

	private projectPolyInto(poly: GeometryPolyView, ax: number, ay: number, out: GeometryProjectionSpan): void {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let vertexIndex = 0; vertexIndex < poly.vertexCount; vertexIndex += 1) {
			this.readWorldVertexInto(poly, vertexIndex, this.vertex0);
			const projection = (this.vertex0.x * ax) + (this.vertex0.y * ay);
			if (projection < min) {
				min = projection;
			}
			if (projection > max) {
				max = projection;
			}
		}
		this.pair.pendingWork.projectionVertices += poly.vertexCount;
		out.min = min;
		out.max = max;
	}

	private computePolyAverageInto(poly: GeometryPolyView, out: PointScratch): void {
		let sumX = 0;
		let sumY = 0;
		for (let vertexIndex = 0; vertexIndex < poly.vertexCount; vertexIndex += 1) {
			this.readWorldVertexInto(poly, vertexIndex, this.vertex0);
			sumX += this.vertex0.x;
			sumY += this.vertex0.y;
		}
		this.pair.pendingWork.averageVertices += poly.vertexCount;
		this.pair.pendingWork.divisions += 2;
		out.x = sumX / poly.vertexCount;
		out.y = sumY / poly.vertexCount;
	}

	private clipConvexPolygons(polyA: GeometryPolyView, polyB: GeometryPolyView): boolean {
		this.pair.pendingWork.clipVertices += polyA.vertexCount;
		for (let vertexIndex = 0; vertexIndex < polyA.vertexCount; vertexIndex += 1) {
			this.readWorldVertexInto(polyA, vertexIndex, this.vertex0);
			this.writeClipVertex(this.clip0, vertexIndex, this.vertex0.x, this.vertex0.y);
		}
		let input = this.clip0;
		let output = this.clip1;
		let inputVertexCount = polyA.vertexCount;
		for (let edgeIndex = 0; edgeIndex < polyB.vertexCount; edgeIndex += 1) {
			this.pair.pendingWork.clipEdges += 1;
			let outputVertexCount = 0;
			const nextIndex = edgeIndex + 1 === polyB.vertexCount ? 0 : edgeIndex + 1;
			this.readWorldVertexInto(polyB, edgeIndex, this.vertex0);
			const x0 = this.vertex0.x;
			const y0 = this.vertex0.y;
			this.readWorldVertexInto(polyB, nextIndex, this.vertex1);
			const x1 = this.vertex1.x;
			const y1 = this.vertex1.y;
			if (inputVertexCount === 0) {
				break;
			}
			let sx = input[(inputVertexCount - 1) * 2];
			let sy = input[((inputVertexCount - 1) * 2) + 1];
			let sd = this.clipPlaneDistance(x0, y0, x1, y1, sx, sy);
			let sInside = sd >= 0;
			for (let inputIndex = 0; inputIndex < inputVertexCount; inputIndex += 1) {
				this.pair.pendingWork.clipVertices += 1;
				const inputOffset = inputIndex * 2;
				const ex = input[inputOffset];
				const ey = input[inputOffset + 1];
				const ed = this.clipPlaneDistance(x0, y0, x1, y1, ex, ey);
				const eInside = ed >= 0;
				if ((sInside || eInside) && outputVertexCount === GEO_OVERLAP2D_MAX_CLIP_VERTICES) {
					return false;
				}
				if (sInside && eInside) {
					this.writeClipVertex(output, outputVertexCount, ex, ey);
					outputVertexCount += 1;
				} else if (sInside && !eInside) {
					this.pair.pendingWork.divisions += 1;
					const t = sd / (sd - ed);
					this.writeClipVertex(output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
					outputVertexCount += 1;
				} else if (!sInside && eInside) {
					this.pair.pendingWork.divisions += 1;
					const t = sd / (sd - ed);
					this.writeClipVertex(output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
					outputVertexCount += 1;
					if (outputVertexCount === GEO_OVERLAP2D_MAX_CLIP_VERTICES) {
						return false;
					}
					this.writeClipVertex(output, outputVertexCount, ex, ey);
					outputVertexCount += 1;
				}
				sx = ex;
				sy = ey;
				sd = ed;
				sInside = eInside;
			}
			const swap = input;
			input = output;
			output = swap;
			inputVertexCount = outputVertexCount;
		}
		this.clipResult = input;
		this.clipResultVertexCount = inputVertexCount;
		return true;
	}

	private readWorldVertexInto(poly: GeometryPolyView, vertexIndex: number, out: PointScratch): void {
		if (poly.primitive === GEO_PRIMITIVE_AABB) {
			if (vertexIndex === 0) {
				out.x = poly.left;
				out.y = poly.top;
			} else if (vertexIndex === 1) {
				out.x = poly.right;
				out.y = poly.top;
			} else if (vertexIndex === 2) {
				out.x = poly.right;
				out.y = poly.bottom;
			} else {
				out.x = poly.left;
				out.y = poly.bottom;
			}
			return;
		}
		const word = vertexIndex * 2;
		out.x = poly.vertices[word];
		out.y = poly.vertices[word + 1];
	}

	private writeClipVertex(buffer: Float64Array, vertexIndex: number, x: number, y: number): void {
		const offset = vertexIndex * 2;
		buffer[offset] = x;
		buffer[offset + 1] = y;
	}

	private computeClipAverageInto(buffer: Float64Array, vertexCount: number, out: PointScratch): void {
		let sumX = 0;
		let sumY = 0;
		for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
			const offset = vertexIndex * 2;
			sumX += buffer[offset];
			sumY += buffer[offset + 1];
		}
		out.x = sumX / vertexCount;
		out.y = sumY / vertexCount;
	}

	private clipPlaneDistance(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
		return ((x1 - x0) * (py - y0)) - ((y1 - y0) * (px - x0));
	}

	private writeResult(addr: number, nx: number, ny: number, depth: number, px: number, py: number, pieceA: number, pieceB: number, featureMeta: number, pairMeta: number): void {
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_NX_OFFSET, numberToF32Bits(nx));
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_NY_OFFSET, numberToF32Bits(ny));
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_DEPTH_OFFSET, numberToF32Bits(depth));
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PX_OFFSET, numberToF32Bits(px));
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PY_OFFSET, numberToF32Bits(py));
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET, pieceA >>> 0);
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET, pieceB >>> 0);
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET, featureMeta >>> 0);
		this.memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET, pairMeta >>> 0);
	}

	private readF32(addr: number): number {
		return f32BitsToNumber(this.memory.readU32(addr, this.pair.pendingMemory));
	}
}
