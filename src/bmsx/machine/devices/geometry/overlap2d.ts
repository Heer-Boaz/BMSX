import { f32BitsToNumber, numberToF32Bits } from '../../common/numeric';
import type { Memory } from '../../memory/memory';
import { GEOMETRY_WORD_ALIGN_MASK, resolveGeometryByteOffset, resolveGeometryIndexedSpan } from './addressing';
import {
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_RESULT_CAPACITY,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_SRC_RANGE,
	GEO_OVERLAP2D_AABB_DATA_COUNT,
	GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB,
	GEO_OVERLAP2D_BROADPHASE_MASK,
	GEO_OVERLAP2D_BROADPHASE_NONE,
	GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE,
	GEO_OVERLAP2D_CONTACT_POLICY_MASK,
	GEO_OVERLAP2D_INSTANCE_BYTES,
	GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET,
	GEO_OVERLAP2D_INSTANCE_MASK_OFFSET,
	GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TX_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TY_OFFSET,
	GEO_OVERLAP2D_INSTANCE_WORDS,
	GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS,
	GEO_OVERLAP2D_MODE_FULL_PASS,
	GEO_OVERLAP2D_MODE_MASK,
	GEO_OVERLAP2D_MAX_CLIP_VERTICES,
	GEO_OVERLAP2D_MAX_POLY_VERTICES,
	GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW,
	GEO_OVERLAP2D_OUTPUT_POLICY_MASK,
	GEO_OVERLAP2D_PAIR_BYTES,
	GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET,
	GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK,
	GEO_OVERLAP2D_PAIR_META_OFFSET,
	GEO_OVERLAP2D_PARAM0_RESERVED_MASK,
	GEO_OVERLAP2D_RESULT_BYTES,
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
	GEO_OVERLAP2D_SUMMARY_BYTES,
	GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET,
	GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW,
	GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET,
	GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET,
	GEO_PRIMITIVE_AABB,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_VERTEX2_BYTES,
	GEO_VERTEX2_X_OFFSET,
	GEO_VERTEX2_Y_OFFSET,
} from './contracts';
import { GeometryProjectionSpan } from './projection';
import type { GeometryJobState } from './state';

type PointScratch = { x: number; y: number };
type GeometryPolyView = {
	primitive: number;
	vertexCount: number;
	dataAddr: number;
	tx: number;
	ty: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
};

const GEO_FAULT_NONE = 0;
const GEO_OVERLAP2D_CLIP_COORDS = GEO_OVERLAP2D_MAX_CLIP_VERTICES * 2;

export class GeometryOverlap2dUnit {
	private readonly polyA: GeometryPolyView = {
		primitive: 0,
		vertexCount: 0,
		dataAddr: 0,
		tx: 0,
		ty: 0,
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
	};
	private readonly polyB: GeometryPolyView = {
		primitive: 0,
		vertexCount: 0,
		dataAddr: 0,
		tx: 0,
		ty: 0,
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
	};
	private readonly clip0 = new Float64Array(GEO_OVERLAP2D_CLIP_COORDS);
	private readonly clip1 = new Float64Array(GEO_OVERLAP2D_CLIP_COORDS);
	private clipResult = this.clip0;
	private clipResultVertexCount = 0;
	private readonly instanceA = new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS);
	private readonly instanceB = new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS);
	private readonly boundsA = new Float64Array(4);
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

	public validateSubmission(job: GeometryJobState): number {
		const mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
		if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) !== GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
			|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) !== GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
			|| (job.param0 & GEO_OVERLAP2D_PARAM0_RESERVED_MASK) !== 0) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if (job.stride0 !== GEO_OVERLAP2D_INSTANCE_BYTES) {
			return GEO_FAULT_REJECT_BAD_STRIDE;
		}
		if (job.src2 !== 0) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_NONE
				|| job.stride1 !== GEO_OVERLAP2D_PAIR_BYTES
				|| job.stride2 === 0) {
				return GEO_FAULT_REJECT_BAD_STRIDE;
			}
		} else if (mode === GEO_OVERLAP2D_MODE_FULL_PASS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
				|| job.src1 !== 0
				|| job.stride1 !== 0
				|| job.stride2 !== 0
				|| job.count > GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) {
				return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
			}
		} else {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.dst1 & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
			return GEO_FAULT_REJECT_MISALIGNED_REGS;
		}
		if (!this.memory.isRamRange(job.dst1, GEO_OVERLAP2D_SUMMARY_BYTES)) {
			return GEO_FAULT_REJECT_DST_NOT_RAM;
		}
		if (!this.memory.isRamRange(job.dst0, GEO_OVERLAP2D_RESULT_BYTES)) {
			return GEO_FAULT_REJECT_DST_NOT_RAM;
		}
		if (job.count === 0) {
			return GEO_FAULT_NONE;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !this.memory.isReadableMainMemoryRange(job.src1, GEO_OVERLAP2D_PAIR_BYTES)) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		const instanceCount = mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
		const lastInstanceAddr = resolveGeometryIndexedSpan(job.src0, instanceCount - 1, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
		if (lastInstanceAddr === null || !this.memory.isReadableMainMemoryRange(lastInstanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		return GEO_FAULT_NONE;
	}

	public processRecord(job: GeometryJobState): number {
		const mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			return this.processCandidateRecord(job);
		}
		return this.processFullPassRecord(job);
	}

	public writeSummary(job: GeometryJobState, flags: number): void {
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET, job.resultCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET, job.exactPairCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET, job.broadphasePairCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET, flags >>> 0);
	}

	private processCandidateRecord(job: GeometryJobState): number {
		const recordIndex = job.processed;
		const pairAddr = resolveGeometryIndexedSpan(job.src1, recordIndex, job.stride1, GEO_OVERLAP2D_PAIR_BYTES);
		if (pairAddr === null || !this.memory.isReadableMainMemoryRange(pairAddr, GEO_OVERLAP2D_PAIR_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const instanceAIndex = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
		const instanceBIndex = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
		const pairMeta = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_META_OFFSET);
		if (instanceAIndex === instanceBIndex) {
			return GEO_FAULT_BAD_RECORD_FLAGS;
		}
		const instanceCount = job.stride2;
		if (instanceAIndex >= instanceCount || instanceBIndex >= instanceCount) {
			return GEO_FAULT_SRC_RANGE;
		}
		if (!this.readInstanceAt(job, instanceAIndex, this.instanceA)
			|| !this.readInstanceAt(job, instanceBIndex, this.instanceB)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const fault = this.processPair(job, this.instanceA, this.instanceB, pairMeta);
		if (fault !== GEO_FAULT_NONE) {
			return fault;
		}
		this.writeSummary(job, 0);
		return GEO_FAULT_NONE;
	}

	private processFullPassRecord(job: GeometryJobState): number {
		const recordIndex = job.processed;
		if (!this.readInstanceAt(job, recordIndex, this.instanceA)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const instanceCount = job.count;
		for (let instanceBIndex = recordIndex + 1; instanceBIndex < instanceCount; instanceBIndex += 1) {
			if (!this.readInstanceAt(job, instanceBIndex, this.instanceB)) {
				return GEO_FAULT_SRC_RANGE;
			}
			const pairMeta = (((recordIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
				| (instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK)) >>> 0;
			const fault = this.processPair(job, this.instanceA, this.instanceB, pairMeta);
			if (fault !== GEO_FAULT_NONE) {
				return fault;
			}
		}
		this.writeSummary(job, 0);
		return GEO_FAULT_NONE;
	}

	private readInstanceAt(job: GeometryJobState, instanceIndex: number, out: Uint32Array): boolean {
		const instanceAddr = resolveGeometryIndexedSpan(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
		if (instanceAddr === null || !this.memory.isReadableMainMemoryRange(instanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
			return false;
		}
		out[0] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
		out[1] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TX_OFFSET);
		out[2] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TY_OFFSET);
		out[3] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET);
		out[4] = this.memory.readU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_MASK_OFFSET);
		return true;
	}

	private processPair(job: GeometryJobState, instanceA: Uint32Array, instanceB: Uint32Array, pairMeta: number): number {
		const shapeAAddr = instanceA[0];
		const txA = f32BitsToNumber(instanceA[1]);
		const tyA = f32BitsToNumber(instanceA[2]);
		const layerA = instanceA[3];
		const maskA = instanceA[4];
		const shapeBAddr = instanceB[0];
		const txB = f32BitsToNumber(instanceB[1]);
		const tyB = f32BitsToNumber(instanceB[2]);
		const layerB = instanceB[3];
		const maskB = instanceB[4];
		if (!this.memory.isReadableMainMemoryRange(shapeAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		if ((maskA & layerB) === 0 || (maskB & layerA) === 0) {
			return GEO_FAULT_NONE;
		}
		job.broadphasePairCount += 1;
		const shapeABoundsFault = this.readPieceBounds(shapeAAddr, txA, tyA, this.boundsA);
		if (shapeABoundsFault !== GEO_FAULT_NONE) {
			return shapeABoundsFault;
		}
		const shapeBBoundsFault = this.readPieceBounds(shapeBAddr, txB, tyB, this.boundsB);
		if (shapeBBoundsFault !== GEO_FAULT_NONE) {
			return shapeBBoundsFault;
		}
		if (!this.boundsOverlap(this.boundsA, this.boundsB)) {
			return GEO_FAULT_NONE;
		}
		const shapeAKind = this.memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
		const shapeACount = this.memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
		const shapeADataOffset = this.memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
		const shapeBKind = this.memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
		const shapeBCount = this.memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
		const shapeBDataOffset = this.memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
		const shapeAIsCompound = shapeAKind === GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
		const shapeBIsCompound = shapeBKind === GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
		const shapeAPieceCount = shapeAIsCompound ? shapeACount : 1;
		const shapeBPieceCount = shapeBIsCompound ? shapeBCount : 1;
		if (shapeAPieceCount === 0 || shapeBPieceCount === 0
			|| (shapeAIsCompound && (shapeADataOffset & GEOMETRY_WORD_ALIGN_MASK) !== 0)
			|| (shapeBIsCompound && (shapeBDataOffset & GEOMETRY_WORD_ALIGN_MASK) !== 0)
			|| (!shapeAIsCompound && shapeAKind !== GEO_PRIMITIVE_AABB && shapeAKind !== GEO_PRIMITIVE_CONVEX_POLY)
			|| (!shapeBIsCompound && shapeBKind !== GEO_PRIMITIVE_AABB && shapeBKind !== GEO_PRIMITIVE_CONVEX_POLY)) {
			return GEO_FAULT_DESCRIPTOR_KIND;
		}
		job.exactPairCount += 1;
		let bestHit = false;
		let bestDepth = Number.POSITIVE_INFINITY;
		let bestPieceA = 0;
		let bestPieceB = 0;
		let bestFeatureMeta = 0;
		let bestNx = 0;
		let bestNy = 0;
		let bestPx = 0;
		let bestPy = 0;
		for (let pieceAIndex = 0; pieceAIndex < shapeAPieceCount; pieceAIndex += 1) {
			const pieceAAddr = shapeAIsCompound
				? resolveGeometryByteOffset(shapeAAddr, shapeADataOffset + pieceAIndex * GEO_OVERLAP2D_SHAPE_DESC_BYTES, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
				: shapeAAddr;
			if (pieceAAddr === null || !this.memory.isReadableMainMemoryRange(pieceAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
				return GEO_FAULT_SRC_RANGE;
			}
			const pieceABoundsFault = this.readPieceBounds(pieceAAddr, txA, tyA, this.boundsA);
			if (pieceABoundsFault !== GEO_FAULT_NONE) {
				return pieceABoundsFault;
			}
			for (let pieceBIndex = 0; pieceBIndex < shapeBPieceCount; pieceBIndex += 1) {
				const pieceBAddr = shapeBIsCompound
					? resolveGeometryByteOffset(shapeBAddr, shapeBDataOffset + pieceBIndex * GEO_OVERLAP2D_SHAPE_DESC_BYTES, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
					: shapeBAddr;
				if (pieceBAddr === null || !this.memory.isReadableMainMemoryRange(pieceBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
					return GEO_FAULT_SRC_RANGE;
				}
				const pieceBBoundsFault = this.readPieceBounds(pieceBAddr, txB, tyB, this.boundsB);
				if (pieceBBoundsFault !== GEO_FAULT_NONE) {
					return pieceBBoundsFault;
				}
				if (!this.boundsOverlap(this.boundsA, this.boundsB)) {
					continue;
				}
				const fault = this.computePiecePairContact(pieceAAddr, txA, tyA, pieceBAddr, txB, tyB);
				if (fault !== GEO_FAULT_NONE) {
					return fault;
				}
				if (!this.contactHit) {
					continue;
				}
				if (!bestHit
					|| this.contactDepth < bestDepth
					|| (this.contactDepth === bestDepth && (pieceAIndex < bestPieceA
						|| (pieceAIndex === bestPieceA && (pieceBIndex < bestPieceB
							|| (pieceBIndex === bestPieceB && this.contactFeatureMeta < bestFeatureMeta)))))) {
					bestHit = true;
					bestDepth = this.contactDepth;
					bestPieceA = pieceAIndex;
					bestPieceB = pieceBIndex;
					bestFeatureMeta = this.contactFeatureMeta;
					bestNx = this.contactNx;
					bestNy = this.contactNy;
					bestPx = this.contactPx;
					bestPy = this.contactPy;
				}
			}
		}
		if (!bestHit) {
			return GEO_FAULT_NONE;
		}
		const resultCount = job.resultCount;
		if (resultCount >= job.param1) {
			this.writeSummary(job, GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
			return GEO_FAULT_RESULT_CAPACITY;
		}
		const resultAddr = resolveGeometryIndexedSpan(job.dst0, resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, GEO_OVERLAP2D_RESULT_BYTES)) {
			return GEO_FAULT_DST_RANGE;
		}
		this.writeResult(resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
		job.resultCount = resultCount + 1;
		return GEO_FAULT_NONE;
	}

	private readPieceBounds(pieceAddr: number, tx: number, ty: number, out: Float64Array): number {
		const boundsOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
		if ((boundsOffset & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		const boundsAddr = resolveGeometryByteOffset(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
		if (boundsAddr === null || !this.memory.isReadableMainMemoryRange(boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
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
		this.contactHit = this.computePolyPairContact(this.polyA, this.polyB);
		return GEO_FAULT_NONE;
	}

	private loadPolyView(pieceAddr: number, tx: number, ty: number, out: GeometryPolyView): number {
		const primitive = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
		const dataCount = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
		const dataOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
		if (primitive === GEO_PRIMITIVE_AABB) {
			if (dataCount !== GEO_OVERLAP2D_AABB_DATA_COUNT) {
				return GEO_FAULT_BAD_VERTEX_COUNT;
			}
			if ((dataOffset & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
				return GEO_FAULT_BAD_RECORD_ALIGNMENT;
			}
			const dataAddr = resolveGeometryByteOffset(pieceAddr, dataOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
			if (dataAddr === null || !this.memory.isReadableMainMemoryRange(dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
				return GEO_FAULT_SRC_RANGE;
			}
			out.primitive = primitive;
			out.vertexCount = GEO_OVERLAP2D_AABB_DATA_COUNT;
			out.dataAddr = dataAddr;
			out.tx = tx;
			out.ty = ty;
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
		if ((dataOffset & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		const dataBytes = dataCount * GEO_VERTEX2_BYTES;
		const dataAddr = resolveGeometryByteOffset(pieceAddr, dataOffset, dataBytes);
		if (dataAddr === null || !this.memory.isReadableMainMemoryRange(dataAddr, dataBytes)) {
			return GEO_FAULT_SRC_RANGE;
		}
		out.primitive = primitive;
		out.vertexCount = dataCount;
		out.dataAddr = dataAddr;
		out.tx = tx;
		out.ty = ty;
		out.left = 0;
		out.top = 0;
		out.right = 0;
		out.bottom = 0;
		return GEO_FAULT_NONE;
	}

	private boundsOverlap(a: Float64Array, b: Float64Array): boolean {
		return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
	}

	private computePolyPairContact(polyA: GeometryPolyView, polyB: GeometryPolyView): boolean {
		let bestOverlap = Number.POSITIVE_INFINITY;
		let bestAxisX = 0;
		let bestAxisY = 0;
		let bestEdgeIndex = 0;
		let bestOwner = 0;
		let sawAxis = false;
		for (let owner = 0; owner < 2; owner += 1) {
			const poly = owner === 0 ? polyA : polyB;
			for (let edgeIndex = 0; edgeIndex < poly.vertexCount; edgeIndex += 1) {
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
				const ax = nx / len;
				const ay = ny / len;
				this.projectPolyInto(polyA, ax, ay, this.projectionA);
				this.projectPolyInto(polyB, ax, ay, this.projectionB);
				const overlap = Math.min(this.projectionA.max, this.projectionB.max) - Math.max(this.projectionA.min, this.projectionB.min);
				if (!(overlap > 0)) {
					return false;
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
			return false;
		}
		this.computePolyAverageInto(polyA, this.centerA);
		this.computePolyAverageInto(polyB, this.centerB);
		if ((((this.centerA.x - this.centerB.x) * bestAxisX) + ((this.centerA.y - this.centerB.y) * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		let pointX;
		let pointY;
		this.clipConvexPolygons(polyA, polyB);
		if (this.clipResultVertexCount === 0) {
			pointX = (this.centerA.x + this.centerB.x) * 0.5;
			pointY = (this.centerA.y + this.centerB.y) * 0.5;
		} else {
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
		return true;
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
		out.x = sumX / poly.vertexCount;
		out.y = sumY / poly.vertexCount;
	}

	private clipConvexPolygons(polyA: GeometryPolyView, polyB: GeometryPolyView): void {
		for (let vertexIndex = 0; vertexIndex < polyA.vertexCount; vertexIndex += 1) {
			this.readWorldVertexInto(polyA, vertexIndex, this.vertex0);
			this.writeClipVertex(this.clip0, vertexIndex, this.vertex0.x, this.vertex0.y);
		}
		let input = this.clip0;
		let output = this.clip1;
		let inputVertexCount = polyA.vertexCount;
		for (let edgeIndex = 0; edgeIndex < polyB.vertexCount; edgeIndex += 1) {
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
				const inputOffset = inputIndex * 2;
				const ex = input[inputOffset];
				const ey = input[inputOffset + 1];
				const ed = this.clipPlaneDistance(x0, y0, x1, y1, ex, ey);
				const eInside = ed >= 0;
				if (sInside && eInside) {
					this.writeClipVertex(output, outputVertexCount, ex, ey);
					outputVertexCount += 1;
				} else if (sInside && !eInside) {
					const t = sd / (sd - ed);
					this.writeClipVertex(output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
					outputVertexCount += 1;
				} else if (!sInside && eInside) {
					const t = sd / (sd - ed);
					this.writeClipVertex(output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
					outputVertexCount += 1;
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
		const vertexAddr = poly.dataAddr + vertexIndex * GEO_VERTEX2_BYTES;
		out.x = this.readF32(vertexAddr + GEO_VERTEX2_X_OFFSET) + poly.tx;
		out.y = this.readF32(vertexAddr + GEO_VERTEX2_Y_OFFSET) + poly.ty;
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
		return f32BitsToNumber(this.memory.readU32(addr));
	}
}
