import {
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_INDEX_NONE,
	GEO_VERTEX2_BYTES,
	GEO_VERTEX2_X_OFFSET,
	GEO_VERTEX2_Y_OFFSET,
	GEO_XFORM2_AABB_BYTES,
	GEO_XFORM2_AABB_MAX_X_OFFSET,
	GEO_XFORM2_AABB_MAX_Y_OFFSET,
	GEO_XFORM2_AABB_MIN_X_OFFSET,
	GEO_XFORM2_AABB_MIN_Y_OFFSET,
	GEO_XFORM2_MATRIX_M00_OFFSET,
	GEO_XFORM2_MATRIX_M01_OFFSET,
	GEO_XFORM2_MATRIX_M10_OFFSET,
	GEO_XFORM2_MATRIX_M11_OFFSET,
	GEO_XFORM2_MATRIX_TX_OFFSET,
	GEO_XFORM2_MATRIX_TY_OFFSET,
	GEO_XFORM2_RECORD_AUX_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST1_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST_INDEX_OFFSET,
	GEO_XFORM2_RECORD_FLAGS_OFFSET,
	GEO_XFORM2_RECORD_SRC_INDEX_OFFSET,
	GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET,
	GEO_XFORM2_MAX_VERTICES,
} from './contracts';
import { geometryIndexedAddr } from './addressing';
import type { GeometryJobState } from './job';
import type { Memory } from '../../memory/memory';
import { toSignedWord, transformFixed16 } from '../../common/numeric';

const GEO_FAULT_NONE = 0;

export class GeometryXform2Unit {
	public constructor(private readonly memory: Memory) {}

	public processRecord(job: GeometryJobState): number {
		const recordIndex = job.processed;
		const recordAddr = geometryIndexedAddr(job.src0, recordIndex, job.stride0);
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
		const srcAddr = geometryIndexedAddr(job.src1, srcIndex, job.stride1);
		const matrixAddr = geometryIndexedAddr(job.src2, auxIndex, job.stride2);
		const dstAddr = geometryIndexedAddr(job.dst0, dstIndex, GEO_VERTEX2_BYTES);
		let aabbAddr = 0;
		if (dst1Index !== GEO_INDEX_NONE) {
			aabbAddr = geometryIndexedAddr(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES);
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
