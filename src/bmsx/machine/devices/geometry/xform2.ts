import {
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_SRC_RANGE,
	GEO_INDEX_NONE,
	GEO_VERTEX2_BYTES,
	GEO_VERTEX2_X_OFFSET,
	GEO_VERTEX2_Y_OFFSET,
	GEO_XFORM2_AABB_BYTES,
	GEO_XFORM2_AABB_MAX_X_OFFSET,
	GEO_XFORM2_AABB_MAX_Y_OFFSET,
	GEO_XFORM2_AABB_MIN_X_OFFSET,
	GEO_XFORM2_AABB_MIN_Y_OFFSET,
	GEO_XFORM2_MATRIX_BYTES,
	GEO_XFORM2_MATRIX_M00_OFFSET,
	GEO_XFORM2_MATRIX_M01_OFFSET,
	GEO_XFORM2_MATRIX_M10_OFFSET,
	GEO_XFORM2_MATRIX_M11_OFFSET,
	GEO_XFORM2_MATRIX_TX_OFFSET,
	GEO_XFORM2_MATRIX_TY_OFFSET,
	GEO_XFORM2_RECORD_AUX_INDEX_OFFSET,
	GEO_XFORM2_RECORD_BYTES,
	GEO_XFORM2_RECORD_DST1_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST_INDEX_OFFSET,
	GEO_XFORM2_RECORD_FLAGS_OFFSET,
	GEO_XFORM2_RECORD_SRC_INDEX_OFFSET,
	GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET,
	GEO_XFORM2_MAX_VERTICES,
} from './contracts';
import { GEOMETRY_WORD_ALIGN_MASK, resolveGeometryIndexedSpan } from './addressing';
import type { GeometryJobState } from './state';
import type { Memory } from '../../memory/memory';
import { toSignedWord, transformFixed16 } from '../../common/numeric';

const GEO_FAULT_NONE = 0;

export class GeometryXform2Unit {
	public constructor(private readonly memory: Memory) {}

	public validateSubmission(job: GeometryJobState): number {
		if (job.param0 !== 0 || job.param1 !== 0) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
		if (job.stride0 !== GEO_XFORM2_RECORD_BYTES || job.stride1 !== GEO_VERTEX2_BYTES || job.stride2 !== GEO_XFORM2_MATRIX_BYTES) {
			return GEO_FAULT_REJECT_BAD_STRIDE;
		}
		if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.src2 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) !== 0
			|| (job.dst1 & GEOMETRY_WORD_ALIGN_MASK) !== 0) {
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
		if (!this.memory.isRamRange(job.dst0, GEO_VERTEX2_BYTES)) {
			return GEO_FAULT_REJECT_DST_NOT_RAM;
		}
		if (job.dst1 !== 0 && !this.memory.isRamRange(job.dst1, 4)) {
			return GEO_FAULT_REJECT_DST_NOT_RAM;
		}
		return GEO_FAULT_NONE;
	}

	public processRecord(job: GeometryJobState): number {
		const recordIndex = job.processed;
		const recordAddr = resolveGeometryIndexedSpan(job.src0, recordIndex, job.stride0, GEO_XFORM2_RECORD_BYTES);
		if (recordAddr === null) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		if (!this.memory.isReadableMainMemoryRange(recordAddr, GEO_XFORM2_RECORD_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const flags = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET);
		const srcIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
		const dstIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
		const auxIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
		const vertexCount = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
		const dst1Index = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
		if (flags !== 0) {
			return GEO_FAULT_BAD_RECORD_FLAGS;
		}
		if (vertexCount === 0) {
			return GEO_FAULT_NONE;
		}
		if (vertexCount > GEO_XFORM2_MAX_VERTICES) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		const vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
		const srcAddr = resolveGeometryIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
		if (srcAddr === null || !this.memory.isReadableMainMemoryRange(srcAddr, vertexBytes)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const matrixAddr = resolveGeometryIndexedSpan(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES);
		if (matrixAddr === null || !this.memory.isReadableMainMemoryRange(matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const dstAddr = resolveGeometryIndexedSpan(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes);
		if (dstAddr === null || !this.memory.isRamRange(dstAddr, vertexBytes)) {
			return GEO_FAULT_DST_RANGE;
		}
		let aabbAddr = 0;
		if (dst1Index !== GEO_INDEX_NONE) {
			aabbAddr = resolveGeometryIndexedSpan(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES);
			if (aabbAddr === null || !this.memory.isRamRange(aabbAddr, GEO_XFORM2_AABB_BYTES)) {
				return GEO_FAULT_DST_RANGE;
			}
		}
		const m00 = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_M00_OFFSET));
		const m01 = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_M01_OFFSET));
		const tx = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_TX_OFFSET));
		const m10 = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_M10_OFFSET));
		const m11 = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_M11_OFFSET));
		const ty = toSignedWord(this.memory.readU32(matrixAddr + GEO_XFORM2_MATRIX_TY_OFFSET));
		let minX = 0;
		let minY = 0;
		let maxX = 0;
		let maxY = 0;
		for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
			const localAddr = srcAddr + vertexIndex * GEO_VERTEX2_BYTES;
			const worldAddr = dstAddr + vertexIndex * GEO_VERTEX2_BYTES;
			const localX = toSignedWord(this.memory.readU32(localAddr + GEO_VERTEX2_X_OFFSET));
			const localY = toSignedWord(this.memory.readU32(localAddr + GEO_VERTEX2_Y_OFFSET));
			const worldX = transformFixed16(m00, m01, tx, localX, localY);
			const worldY = transformFixed16(m10, m11, ty, localX, localY);
			this.memory.writeU32(worldAddr + GEO_VERTEX2_X_OFFSET, worldX >>> 0);
			this.memory.writeU32(worldAddr + GEO_VERTEX2_Y_OFFSET, worldY >>> 0);
			if (vertexIndex === 0) {
				minX = worldX;
				minY = worldY;
				maxX = worldX;
				maxY = worldY;
				continue;
			}
			if (worldX < minX) {
				minX = worldX;
			}
			if (worldY < minY) {
				minY = worldY;
			}
			if (worldX > maxX) {
				maxX = worldX;
			}
			if (worldY > maxY) {
				maxY = worldY;
			}
		}
		if (dst1Index !== GEO_INDEX_NONE) {
			this.memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_X_OFFSET, minX >>> 0);
			this.memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_Y_OFFSET, minY >>> 0);
			this.memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_X_OFFSET, maxX >>> 0);
			this.memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_Y_OFFSET, maxY >>> 0);
		}
		return GEO_FAULT_NONE;
	}
}
