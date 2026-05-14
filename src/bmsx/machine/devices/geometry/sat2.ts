import {
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_SRC_RANGE,
	GEO_SAT_META_AXIS_MASK,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SAT2_DESC_BYTES,
	GEO_SAT2_DESC_FLAGS_OFFSET,
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
	GEO_VERTEX2_X_OFFSET,
	GEO_VERTEX2_Y_OFFSET,
} from './contracts';
import { GEOMETRY_WORD_ALIGN_MASK, resolveGeometryIndexedSpan } from './addressing';
import { GeometryProjectionSpan } from './projection';
import type { GeometryJobState } from './state';
import type { Memory } from '../../memory/memory';
import {
	FIX16_SCALE,
	saturateRoundedI32,
	toSignedWord,
} from '../../common/numeric';

const GEO_FAULT_NONE = 0;

function packSat2Meta(axisIndex: number, shapeSelector: number): number {
	return (((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK)) >>> 0;
}

export class GeometrySat2Unit {
	private readonly projectionA = new GeometryProjectionSpan();
	private readonly projectionB = new GeometryProjectionSpan();

	public constructor(private readonly memory: Memory) {}

	public validateSubmission(job: GeometryJobState): number {
		if (job.param0 !== 0 || job.param1 !== 0 || job.dst1 !== 0) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if (job.stride0 !== GEO_SAT2_PAIR_BYTES || job.stride1 !== GEO_SAT2_DESC_BYTES || job.stride2 !== GEO_VERTEX2_BYTES) {
			return GEO_FAULT_REJECT_BAD_STRIDE;
		}
		if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.src2 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
			return GEO_FAULT_REJECT_MISALIGNED_REGS;
		}
		if (job.count === 0) {
			return GEO_FAULT_NONE;
		}
		if (!this.memory.isReadableMainMemoryRange(job.src0, job.stride0)
			|| !this.memory.isReadableMainMemoryRange(job.src1, job.stride1)
			|| !this.memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if (!this.memory.isRamRange(job.dst0, GEO_SAT2_RESULT_BYTES)) {
			return GEO_FAULT_REJECT_DST_NOT_RAM;
		}
		return GEO_FAULT_NONE;
	}

	public processRecord(job: GeometryJobState): number {
		const recordIndex = job.processed;
		const pairAddr = resolveGeometryIndexedSpan(job.src0, recordIndex, job.stride0, GEO_SAT2_PAIR_BYTES);
		if (pairAddr === null) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		if (!this.memory.isReadableMainMemoryRange(pairAddr, GEO_SAT2_PAIR_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const flags = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET);
		const shapeAIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
		const resultIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
		const shapeBIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
		const pairFlags = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET);
		if (flags !== 0 || pairFlags !== 0) {
			return GEO_FAULT_BAD_RECORD_FLAGS;
		}
		const resultAddr = resolveGeometryIndexedSpan(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, GEO_SAT2_RESULT_BYTES)) {
			return GEO_FAULT_DST_RANGE;
		}
		const shapeADescAddr = resolveGeometryIndexedSpan(job.src1, shapeAIndex, job.stride1, GEO_SAT2_DESC_BYTES);
		const shapeBDescAddr = resolveGeometryIndexedSpan(job.src1, shapeBIndex, job.stride1, GEO_SAT2_DESC_BYTES);
		if (shapeADescAddr === null || shapeBDescAddr === null) {
			return GEO_FAULT_SRC_RANGE;
		}
		if (!this.memory.isReadableMainMemoryRange(shapeADescAddr, GEO_SAT2_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeBDescAddr, GEO_SAT2_DESC_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const shapeAFlags = this.memory.readU32(shapeADescAddr + GEO_SAT2_DESC_FLAGS_OFFSET);
		const shapeAVertexCount = this.memory.readU32(shapeADescAddr + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
		const shapeAVertexOffsetBytes = this.memory.readU32(shapeADescAddr + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
		const shapeAReserved = this.memory.readU32(shapeADescAddr + GEO_SAT2_DESC_RESERVED_OFFSET);
		const shapeBFlags = this.memory.readU32(shapeBDescAddr + GEO_SAT2_DESC_FLAGS_OFFSET);
		const shapeBVertexCount = this.memory.readU32(shapeBDescAddr + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
		const shapeBVertexOffsetBytes = this.memory.readU32(shapeBDescAddr + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
		const shapeBReserved = this.memory.readU32(shapeBDescAddr + GEO_SAT2_DESC_RESERVED_OFFSET);
		if (shapeAFlags !== GEO_SHAPE_CONVEX_POLY
			|| shapeBFlags !== GEO_SHAPE_CONVEX_POLY
			|| shapeAReserved !== 0
			|| shapeBReserved !== 0) {
			return GEO_FAULT_DESCRIPTOR_KIND;
		}
		if (shapeAVertexCount < 3 || shapeBVertexCount < 3) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		if ((shapeAVertexOffsetBytes & GEOMETRY_WORD_ALIGN_MASK) !== 0 || (shapeBVertexOffsetBytes & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		if (shapeAVertexCount > GEO_SAT2_MAX_POLY_VERTICES
			|| shapeBVertexCount > GEO_SAT2_MAX_POLY_VERTICES) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		const shapeAVertexBytes = shapeAVertexCount * GEO_VERTEX2_BYTES;
		const shapeBVertexBytes = shapeBVertexCount * GEO_VERTEX2_BYTES;
		const shapeAVertexAddr = resolveGeometryIndexedSpan(job.src2, shapeAVertexOffsetBytes, 1, shapeAVertexBytes);
		const shapeBVertexAddr = resolveGeometryIndexedSpan(job.src2, shapeBVertexOffsetBytes, 1, shapeBVertexBytes);
		if (shapeAVertexAddr === null || shapeBVertexAddr === null) {
			return GEO_FAULT_SRC_RANGE;
		}
		if (!this.memory.isReadableMainMemoryRange(shapeAVertexAddr, shapeAVertexBytes)
			|| !this.memory.isReadableMainMemoryRange(shapeBVertexAddr, shapeBVertexBytes)) {
			return GEO_FAULT_SRC_RANGE;
		}
		let centerAX = 0;
		let centerAY = 0;
		let vertexXAddr = shapeAVertexAddr + GEO_VERTEX2_X_OFFSET;
		let vertexYAddr = shapeAVertexAddr + GEO_VERTEX2_Y_OFFSET;
		for (let vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1) {
			centerAX += toSignedWord(this.memory.readU32(vertexXAddr));
			centerAY += toSignedWord(this.memory.readU32(vertexYAddr));
			vertexXAddr += GEO_VERTEX2_BYTES;
			vertexYAddr += GEO_VERTEX2_BYTES;
		}
		let centerBX = 0;
		let centerBY = 0;
		vertexXAddr = shapeBVertexAddr + GEO_VERTEX2_X_OFFSET;
		vertexYAddr = shapeBVertexAddr + GEO_VERTEX2_Y_OFFSET;
		for (let vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1) {
			centerBX += toSignedWord(this.memory.readU32(vertexXAddr));
			centerBY += toSignedWord(this.memory.readU32(vertexYAddr));
			vertexXAddr += GEO_VERTEX2_BYTES;
			vertexYAddr += GEO_VERTEX2_BYTES;
		}
		centerAX /= shapeAVertexCount;
		centerAY /= shapeAVertexCount;
		centerBX /= shapeBVertexCount;
		centerBY /= shapeBVertexCount;
		let bestOverlap = Infinity;
		let bestAxisX = 0;
		let bestAxisY = 0;
		let bestAxisIndex = 0;
		let bestShapeSelector = GEO_SAT_META_SHAPE_SRC;
		let sawAxis = false;
		for (let shapeSelector = GEO_SAT_META_SHAPE_SRC; shapeSelector <= GEO_SAT_META_SHAPE_AUX; shapeSelector += 1) {
			const axisBase = shapeSelector === GEO_SAT_META_SHAPE_SRC ? shapeAVertexAddr : shapeBVertexAddr;
			const axisCount = shapeSelector === GEO_SAT_META_SHAPE_SRC ? shapeAVertexCount : shapeBVertexCount;
			for (let edgeIndex = 0; edgeIndex < axisCount; edgeIndex += 1) {
				const currentAddr = axisBase + edgeIndex * GEO_VERTEX2_BYTES;
				const nextIndex = edgeIndex + 1 === axisCount ? 0 : edgeIndex + 1;
				const nextAddr = axisBase + nextIndex * GEO_VERTEX2_BYTES;
				const x0 = toSignedWord(this.memory.readU32(currentAddr + GEO_VERTEX2_X_OFFSET));
				const y0 = toSignedWord(this.memory.readU32(currentAddr + GEO_VERTEX2_Y_OFFSET));
				const x1 = toSignedWord(this.memory.readU32(nextAddr + GEO_VERTEX2_X_OFFSET));
				const y1 = toSignedWord(this.memory.readU32(nextAddr + GEO_VERTEX2_Y_OFFSET));
				const nx = -(y1 - y0);
				const ny = x1 - x0;
				const axisLength = Math.sqrt((nx * nx) + (ny * ny));
				if (!(axisLength > 0)) {
					continue;
				}
				sawAxis = true;
				const ax = nx / axisLength;
				const ay = ny / axisLength;
				this.projectVertexSpanInto(shapeAVertexAddr, shapeAVertexCount, ax, ay, this.projectionA);
				this.projectVertexSpanInto(shapeBVertexAddr, shapeBVertexCount, ax, ay, this.projectionB);
				const sepA = this.projectionA.min - this.projectionB.max;
				const sepB = this.projectionB.min - this.projectionA.max;
				if (sepA > 0 || sepB > 0) {
					this.writeResult(resultAddr, 0, 0, 0, 0, 0);
					return GEO_FAULT_NONE;
				}
				const overlap = Math.min(this.projectionA.max, this.projectionB.max) - Math.max(this.projectionA.min, this.projectionB.min);
				if (overlap < bestOverlap) {
					bestOverlap = overlap;
					bestAxisX = ax;
					bestAxisY = ay;
					bestAxisIndex = edgeIndex;
					bestShapeSelector = shapeSelector;
				}
			}
		}
		if (!sawAxis) {
			return GEO_FAULT_DESCRIPTOR_KIND;
		}
		const deltaX = centerBX - centerAX;
		const deltaY = centerBY - centerAY;
		if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		this.writeResult(
			resultAddr,
			1,
			saturateRoundedI32(bestAxisX * FIX16_SCALE),
			saturateRoundedI32(bestAxisY * FIX16_SCALE),
			saturateRoundedI32(bestOverlap),
			packSat2Meta(bestAxisIndex, bestShapeSelector),
		);
		return GEO_FAULT_NONE;
	}

	private projectVertexSpanInto(base: number, count: number, ax: number, ay: number, out: GeometryProjectionSpan): void {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		let xAddr = base + GEO_VERTEX2_X_OFFSET;
		let yAddr = base + GEO_VERTEX2_Y_OFFSET;
		for (let vertexIndex = 0; vertexIndex < count; vertexIndex += 1) {
			const px = toSignedWord(this.memory.readU32(xAddr));
			const py = toSignedWord(this.memory.readU32(yAddr));
			const projection = (px * ax) + (py * ay);
			if (projection < min) {
				min = projection;
			}
			if (projection > max) {
				max = projection;
			}
			xAddr += GEO_VERTEX2_BYTES;
			yAddr += GEO_VERTEX2_BYTES;
		}
		out.min = min;
		out.max = max;
	}

	private writeResult(addr: number, hit: number, nx: number, ny: number, depth: number, meta: number): void {
		this.memory.writeU32(addr + GEO_SAT2_RESULT_HIT_OFFSET, hit >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_NX_OFFSET, nx >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_NY_OFFSET, ny >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_DEPTH_OFFSET, depth >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_META_OFFSET, meta >>> 0);
	}
}
