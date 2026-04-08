import {
	GEO_CTRL_ABORT,
	GEO_CTRL_START,
	GEO_FAULT_ABORTED_BY_HOST,
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL,
	GEO_FAULT_REJECT_BAD_CMD,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_REJECT_BUSY,
	GEO_FAULT_SRC_RANGE,
	GEO_INDEX_NONE,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SHAPE_CONVEX_POLY,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
	IO_GEO_SRC0,
	IO_GEO_SRC1,
	IO_GEO_SRC2,
	IO_GEO_STATUS,
	IO_GEO_STRIDE0,
	IO_GEO_STRIDE1,
	IO_GEO_STRIDE2,
	IRQ_GEO_DONE,
	IRQ_GEO_ERROR,
} from '../io';
import { Memory } from '../memory';

type GeoJob = {
	cmd: number;
	src0: number;
	src1: number;
	src2: number;
	dst0: number;
	dst1: number;
	count: number;
	param0: number;
	param1: number;
	stride0: number;
	stride1: number;
	stride2: number;
	processed: number;
};

const GEO_RECORD_INDEX_NONE = 0xffff;
const WORD_ALIGN_MASK = 3;
const XFORM2_JOB_WORDS = 6;
const XFORM2_JOB_BYTES = XFORM2_JOB_WORDS * 4;
const XFORM2_VERTEX_BYTES = 8;
const XFORM2_MATRIX_WORDS = 6;
const XFORM2_MATRIX_BYTES = XFORM2_MATRIX_WORDS * 4;
const XFORM2_AABB_BYTES = 16;
const FIX16_SHIFT = 16n;
const FIX16_ONE = 1n << FIX16_SHIFT;
const FIX16_SCALE = 65536;
const I32_MIN = -0x8000_0000n;
const I32_MAX = 0x7fff_ffffn;
const I32_MIN_NUMBER = -0x8000_0000;
const I32_MAX_NUMBER = 0x7fff_ffff;
const SAT2_PAIR_WORDS = 5;
const SAT2_PAIR_BYTES = SAT2_PAIR_WORDS * 4;
const SAT2_DESC_WORDS = 4;
const SAT2_DESC_BYTES = SAT2_DESC_WORDS * 4;
const SAT2_RESULT_WORDS = 5;
const SAT2_RESULT_BYTES = SAT2_RESULT_WORDS * 4;

function packFault(code: number, recordIndex: number): number {
	return (((code & 0xffff) << 16) | (recordIndex & 0xffff)) >>> 0;
}

function packSat2Meta(axisIndex: number, shapeSelector: number): number {
	return (((shapeSelector & 0xffff) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & 0xffff)) >>> 0;
}

function toSignedWord(value: number): number {
	return value | 0;
}

function saturateI32(value: bigint): number {
	if (value < I32_MIN) {
		return -0x8000_0000;
	}
	if (value > I32_MAX) {
		return 0x7fff_ffff;
	}
	return Number(value);
}

function saturateRoundedI32(value: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('expected finite value');
	}
	const rounded = Math.round(value);
	if (rounded <= I32_MIN_NUMBER) {
		return I32_MIN_NUMBER;
	}
	if (rounded >= I32_MAX_NUMBER) {
		return I32_MAX_NUMBER;
	}
	return rounded | 0;
}

function transformFixed16(m0: number, m1: number, tx: number, x: number, y: number): number {
	const accum = (BigInt(m0) * BigInt(x)) + (BigInt(m1) * BigInt(y)) + (BigInt(tx) * FIX16_ONE);
	return saturateI32(accum >> FIX16_SHIFT);
}

export class GeometryController {
	private workBudget = 0;
	private activeJob: GeoJob | null = null;

	public constructor(
		private readonly memory: Memory,
		private readonly raiseIrq: (mask: number) => void,
	) {}

	public setWorkBudget(workUnits: number): void {
		this.workBudget = workUnits >>> 0;
	}

	public hasPendingWork(): boolean {
		return this.activeJob !== null;
	}

	public getPendingWorkUnits(): number {
		const job = this.activeJob;
		return job === null ? 0 : (job.count - job.processed) >>> 0;
	}

	public reset(): void {
		this.workBudget = 0;
		this.activeJob = null;
		this.memory.writeValue(IO_GEO_SRC0, 0);
		this.memory.writeValue(IO_GEO_SRC1, 0);
		this.memory.writeValue(IO_GEO_SRC2, 0);
		this.memory.writeValue(IO_GEO_DST0, 0);
		this.memory.writeValue(IO_GEO_DST1, 0);
		this.memory.writeValue(IO_GEO_COUNT, 0);
		this.memory.writeValue(IO_GEO_CMD, 0);
		this.memory.writeValue(IO_GEO_CTRL, 0);
		this.memory.writeValue(IO_GEO_STATUS, 0);
		this.memory.writeValue(IO_GEO_PARAM0, 0);
		this.memory.writeValue(IO_GEO_PARAM1, 0);
		this.memory.writeValue(IO_GEO_STRIDE0, 0);
		this.memory.writeValue(IO_GEO_STRIDE1, 0);
		this.memory.writeValue(IO_GEO_STRIDE2, 0);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
	}

	public normalizeAfterStateRestore(): void {
		this.workBudget = 0;
		this.activeJob = null;
		const ctrl = this.readRegister(IO_GEO_CTRL);
		const status = this.readRegister(IO_GEO_STATUS);
		const processed = this.readRegister(IO_GEO_PROCESSED);
		this.memory.writeValue(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
		if ((status & GEO_STATUS_BUSY) !== 0) {
			this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
			this.memory.writeValue(IO_GEO_PROCESSED, processed);
			this.memory.writeValue(IO_GEO_FAULT, packFault(GEO_FAULT_ABORTED_BY_HOST, processed));
		}
	}

	public onCtrlWrite(): void {
		const ctrl = this.readRegister(IO_GEO_CTRL);
		const start = (ctrl & GEO_CTRL_START) !== 0;
		const abort = (ctrl & GEO_CTRL_ABORT) !== 0;
		if (!start && !abort) {
			return;
		}
		this.memory.writeValue(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
		if (start && abort) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return;
		}
		if (abort) {
			if (this.activeJob !== null) {
				this.finishError(GEO_FAULT_ABORTED_BY_HOST, this.activeJob.processed);
			}
			return;
		}
		if (this.activeJob !== null) {
			this.finishRejected(GEO_FAULT_REJECT_BUSY);
			return;
		}
		this.tryStart();
	}

	public tick(): void {
		const job = this.activeJob;
		if (job === null || this.workBudget === 0) {
			return;
		}
		let remaining = this.workBudget;
		this.workBudget = 0;
			while (this.activeJob !== null && remaining > 0) {
				switch (job.cmd) {
					case IO_CMD_GEO_XFORM2_BATCH:
						this.processXform2Record(job);
						break;
					case IO_CMD_GEO_SAT2_BATCH:
						this.processSat2Record(job);
						break;
					default:
						this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
						return;
				}
			remaining -= 1;
		}
	}

	private tryStart(): void {
		const job: GeoJob = {
			cmd: this.readRegister(IO_GEO_CMD),
			src0: this.readRegister(IO_GEO_SRC0),
			src1: this.readRegister(IO_GEO_SRC1),
			src2: this.readRegister(IO_GEO_SRC2),
			dst0: this.readRegister(IO_GEO_DST0),
			dst1: this.readRegister(IO_GEO_DST1),
			count: this.readRegister(IO_GEO_COUNT),
			param0: this.readRegister(IO_GEO_PARAM0),
			param1: this.readRegister(IO_GEO_PARAM1),
			stride0: this.readRegister(IO_GEO_STRIDE0),
			stride1: this.readRegister(IO_GEO_STRIDE1),
			stride2: this.readRegister(IO_GEO_STRIDE2),
			processed: 0,
		};
			switch (job.cmd) {
				case IO_CMD_GEO_XFORM2_BATCH:
					if (!this.validateXform2Submission(job)) {
						return;
					}
					break;
				case IO_CMD_GEO_SAT2_BATCH:
					if (!this.validateSat2Submission(job)) {
						return;
					}
					break;
				default:
					this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
					return;
			}
		this.memory.writeValue(IO_GEO_STATUS, 0);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		if (job.count === 0) {
			this.finishSuccess(0);
			return;
		}
		this.activeJob = job;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_BUSY);
	}

	private validateXform2Submission(job: GeoJob): boolean {
		if (job.param0 !== 0 || job.param1 !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (job.stride0 !== XFORM2_JOB_BYTES || job.stride1 !== XFORM2_VERTEX_BYTES || job.stride2 !== XFORM2_MATRIX_BYTES) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
		if ((job.src0 & WORD_ALIGN_MASK) !== 0
			|| (job.src1 & WORD_ALIGN_MASK) !== 0
			|| (job.src2 & WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & WORD_ALIGN_MASK) !== 0
			|| (job.dst1 & WORD_ALIGN_MASK) !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
			return false;
		}
		if (job.count === 0) {
			return true;
		}
		if (!this.memory.isReadableMainMemoryRange(job.src0, job.stride0)
			|| !this.memory.isReadableMainMemoryRange(job.src1, job.stride1)
			|| !this.memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (!this.memory.isRamRange(job.dst0, XFORM2_VERTEX_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		if (job.dst1 !== 0 && !this.memory.isRamRange(job.dst1, 4)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		return true;
	}

	private validateSat2Submission(job: GeoJob): boolean {
		if (job.param0 !== 0 || job.param1 !== 0 || job.dst1 !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (job.stride0 !== SAT2_PAIR_BYTES || job.stride1 !== SAT2_DESC_BYTES || job.stride2 !== XFORM2_VERTEX_BYTES) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
		if ((job.src0 & WORD_ALIGN_MASK) !== 0
			|| (job.src1 & WORD_ALIGN_MASK) !== 0
			|| (job.src2 & WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & WORD_ALIGN_MASK) !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
			return false;
		}
		if (job.count === 0) {
			return true;
		}
		if (!this.memory.isReadableMainMemoryRange(job.src0, job.stride0)
			|| !this.memory.isReadableMainMemoryRange(job.src1, job.stride1)
			|| !this.memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (!this.memory.isRamRange(job.dst0, SAT2_RESULT_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		return true;
	}

	private processXform2Record(job: GeoJob): void {
		const recordIndex = job.processed;
		const recordAddr = this.resolveIndexedSpan(job.src0, recordIndex, job.stride0, XFORM2_JOB_BYTES);
		if (recordAddr === null) {
			this.finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(recordAddr, XFORM2_JOB_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const flags = this.memory.readU32(recordAddr + 0);
		const srcIndex = this.memory.readU32(recordAddr + 4);
		const dstIndex = this.memory.readU32(recordAddr + 8);
		const auxIndex = this.memory.readU32(recordAddr + 12);
		const vertexCount = this.memory.readU32(recordAddr + 16);
		const dst1Index = this.memory.readU32(recordAddr + 20);
		if (flags !== 0) {
			this.finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
			return;
		}
		if (vertexCount === 0) {
			this.completeRecord(job);
			return;
		}
		const vertexBytes = vertexCount * XFORM2_VERTEX_BYTES;
		if (!Number.isSafeInteger(vertexBytes) || vertexBytes > 0xffff_ffff) {
			this.finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
			return;
		}
		const srcAddr = this.resolveIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
		if (srcAddr === null || !this.memory.isReadableMainMemoryRange(srcAddr, vertexBytes)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const matrixAddr = this.resolveIndexedSpan(job.src2, auxIndex, job.stride2, XFORM2_MATRIX_BYTES);
		if (matrixAddr === null || !this.memory.isReadableMainMemoryRange(matrixAddr, XFORM2_MATRIX_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const dstAddr = this.resolveIndexedSpan(job.dst0, dstIndex, XFORM2_VERTEX_BYTES, vertexBytes);
		if (dstAddr === null || !this.memory.isRamRange(dstAddr, vertexBytes)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		let aabbAddr = 0;
		if (dst1Index !== GEO_INDEX_NONE) {
			aabbAddr = this.resolveIndexedSpan(job.dst1, dst1Index, XFORM2_AABB_BYTES, XFORM2_AABB_BYTES);
			if (aabbAddr === null || !this.memory.isRamRange(aabbAddr, XFORM2_AABB_BYTES)) {
				this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
				return;
			}
		}
		const m00 = toSignedWord(this.memory.readU32(matrixAddr + 0));
		const m01 = toSignedWord(this.memory.readU32(matrixAddr + 4));
		const tx = toSignedWord(this.memory.readU32(matrixAddr + 8));
		const m10 = toSignedWord(this.memory.readU32(matrixAddr + 12));
		const m11 = toSignedWord(this.memory.readU32(matrixAddr + 16));
		const ty = toSignedWord(this.memory.readU32(matrixAddr + 20));
		let minX = 0;
		let minY = 0;
		let maxX = 0;
		let maxY = 0;
		for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
			const localAddr = srcAddr + vertexIndex * XFORM2_VERTEX_BYTES;
			const worldAddr = dstAddr + vertexIndex * XFORM2_VERTEX_BYTES;
			const localX = toSignedWord(this.memory.readU32(localAddr + 0));
			const localY = toSignedWord(this.memory.readU32(localAddr + 4));
			const worldX = transformFixed16(m00, m01, tx, localX, localY);
			const worldY = transformFixed16(m10, m11, ty, localX, localY);
			this.memory.writeU32(worldAddr + 0, worldX >>> 0);
			this.memory.writeU32(worldAddr + 4, worldY >>> 0);
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
			this.memory.writeU32(aabbAddr + 0, minX >>> 0);
			this.memory.writeU32(aabbAddr + 4, minY >>> 0);
			this.memory.writeU32(aabbAddr + 8, maxX >>> 0);
			this.memory.writeU32(aabbAddr + 12, maxY >>> 0);
		}
		this.completeRecord(job);
	}

	private processSat2Record(job: GeoJob): void {
		const recordIndex = job.processed;
		const pairAddr = this.resolveIndexedSpan(job.src0, recordIndex, job.stride0, SAT2_PAIR_BYTES);
		if (pairAddr === null) {
			this.finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(pairAddr, SAT2_PAIR_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const flags = this.memory.readU32(pairAddr + 0);
		const shapeAIndex = this.memory.readU32(pairAddr + 4);
		const resultIndex = this.memory.readU32(pairAddr + 8);
		const shapeBIndex = this.memory.readU32(pairAddr + 12);
		const pairFlags = this.memory.readU32(pairAddr + 16);
		if (flags !== 0 || pairFlags !== 0) {
			this.finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
			return;
		}
		const resultAddr = this.resolveIndexedSpan(job.dst0, resultIndex, SAT2_RESULT_BYTES, SAT2_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, SAT2_RESULT_BYTES)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		const shapeADescAddr = this.resolveIndexedSpan(job.src1, shapeAIndex, job.stride1, SAT2_DESC_BYTES);
		const shapeBDescAddr = this.resolveIndexedSpan(job.src1, shapeBIndex, job.stride1, SAT2_DESC_BYTES);
		if (shapeADescAddr === null || shapeBDescAddr === null) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(shapeADescAddr, SAT2_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeBDescAddr, SAT2_DESC_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const shapeAFlags = this.memory.readU32(shapeADescAddr + 0);
		const shapeAVertexCount = this.memory.readU32(shapeADescAddr + 4);
		const shapeAVertexOffsetBytes = this.memory.readU32(shapeADescAddr + 8);
		const shapeAReserved = this.memory.readU32(shapeADescAddr + 12);
		const shapeBFlags = this.memory.readU32(shapeBDescAddr + 0);
		const shapeBVertexCount = this.memory.readU32(shapeBDescAddr + 4);
		const shapeBVertexOffsetBytes = this.memory.readU32(shapeBDescAddr + 8);
		const shapeBReserved = this.memory.readU32(shapeBDescAddr + 12);
		if (shapeAFlags !== GEO_SHAPE_CONVEX_POLY
			|| shapeBFlags !== GEO_SHAPE_CONVEX_POLY
			|| shapeAReserved !== 0
			|| shapeBReserved !== 0) {
			this.finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
			return;
		}
		if (shapeAVertexCount < 3 || shapeBVertexCount < 3) {
			this.finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
			return;
		}
		if ((shapeAVertexOffsetBytes & WORD_ALIGN_MASK) !== 0 || (shapeBVertexOffsetBytes & WORD_ALIGN_MASK) !== 0) {
			this.finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
			return;
		}
		const shapeAVertexBytes = shapeAVertexCount * XFORM2_VERTEX_BYTES;
		const shapeBVertexBytes = shapeBVertexCount * XFORM2_VERTEX_BYTES;
		if (!Number.isSafeInteger(shapeAVertexBytes)
			|| !Number.isSafeInteger(shapeBVertexBytes)
			|| shapeAVertexBytes > 0xffff_ffff
			|| shapeBVertexBytes > 0xffff_ffff) {
			this.finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
			return;
		}
		const shapeAVertexAddr = this.resolveIndexedSpan(job.src2, shapeAVertexOffsetBytes, 1, shapeAVertexBytes);
		const shapeBVertexAddr = this.resolveIndexedSpan(job.src2, shapeBVertexOffsetBytes, 1, shapeBVertexBytes);
		if (shapeAVertexAddr === null || shapeBVertexAddr === null) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(shapeAVertexAddr, shapeAVertexBytes)
			|| !this.memory.isReadableMainMemoryRange(shapeBVertexAddr, shapeBVertexBytes)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		let centerAX = 0;
		let centerAY = 0;
		for (let vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1) {
			const vertexAddr = shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
			centerAX += toSignedWord(this.memory.readU32(vertexAddr + 0));
			centerAY += toSignedWord(this.memory.readU32(vertexAddr + 4));
		}
		let centerBX = 0;
		let centerBY = 0;
		for (let vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1) {
			const vertexAddr = shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
			centerBX += toSignedWord(this.memory.readU32(vertexAddr + 0));
			centerBY += toSignedWord(this.memory.readU32(vertexAddr + 4));
		}
		centerAX /= shapeAVertexCount;
		centerAY /= shapeAVertexCount;
		centerBX /= shapeBVertexCount;
		centerBY /= shapeBVertexCount;
		let bestOverlap = Number.POSITIVE_INFINITY;
		let bestAxisX = 0;
		let bestAxisY = 0;
		let bestAxisIndex = 0;
		let bestShapeSelector = GEO_SAT_META_SHAPE_SRC;
		let sawAxis = false;
		for (let shapeSelector = GEO_SAT_META_SHAPE_SRC; shapeSelector <= GEO_SAT_META_SHAPE_AUX; shapeSelector += 1) {
			const axisBase = shapeSelector === GEO_SAT_META_SHAPE_SRC ? shapeAVertexAddr : shapeBVertexAddr;
			const axisCount = shapeSelector === GEO_SAT_META_SHAPE_SRC ? shapeAVertexCount : shapeBVertexCount;
			for (let edgeIndex = 0; edgeIndex < axisCount; edgeIndex += 1) {
				const currentAddr = axisBase + edgeIndex * XFORM2_VERTEX_BYTES;
				const nextIndex = edgeIndex + 1 === axisCount ? 0 : edgeIndex + 1;
				const nextAddr = axisBase + nextIndex * XFORM2_VERTEX_BYTES;
				const x0 = toSignedWord(this.memory.readU32(currentAddr + 0));
				const y0 = toSignedWord(this.memory.readU32(currentAddr + 4));
				const x1 = toSignedWord(this.memory.readU32(nextAddr + 0));
				const y1 = toSignedWord(this.memory.readU32(nextAddr + 4));
				const nx = -(y1 - y0);
				const ny = x1 - x0;
				const axisLength = Math.sqrt((nx * nx) + (ny * ny));
				if (!(axisLength > 0)) {
					continue;
				}
				sawAxis = true;
				const ax = nx / axisLength;
				const ay = ny / axisLength;
				let minA = Number.POSITIVE_INFINITY;
				let maxA = Number.NEGATIVE_INFINITY;
				for (let vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1) {
					const vertexAddr = shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
					const px = toSignedWord(this.memory.readU32(vertexAddr + 0));
					const py = toSignedWord(this.memory.readU32(vertexAddr + 4));
					const projection = (px * ax) + (py * ay);
					if (projection < minA) {
						minA = projection;
					}
					if (projection > maxA) {
						maxA = projection;
					}
				}
				let minB = Number.POSITIVE_INFINITY;
				let maxB = Number.NEGATIVE_INFINITY;
				for (let vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1) {
					const vertexAddr = shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
					const px = toSignedWord(this.memory.readU32(vertexAddr + 0));
					const py = toSignedWord(this.memory.readU32(vertexAddr + 4));
					const projection = (px * ax) + (py * ay);
					if (projection < minB) {
						minB = projection;
					}
					if (projection > maxB) {
						maxB = projection;
					}
				}
				const sepA = minA - maxB;
				const sepB = minB - maxA;
				if (sepA > 0 || sepB > 0) {
					this.writeSat2Result(resultAddr, 0, 0, 0, 0, 0);
					this.completeRecord(job);
					return;
				}
				const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
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
			this.finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
			return;
		}
		if (!Number.isFinite(bestOverlap) || !Number.isFinite(bestAxisX) || !Number.isFinite(bestAxisY)) {
			this.finishError(GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL, recordIndex);
			return;
		}
		const deltaX = centerBX - centerAX;
		const deltaY = centerBY - centerAY;
		if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		this.writeSat2Result(
			resultAddr,
			1,
			saturateRoundedI32(bestAxisX * FIX16_SCALE),
			saturateRoundedI32(bestAxisY * FIX16_SCALE),
			saturateRoundedI32(bestOverlap),
			packSat2Meta(bestAxisIndex, bestShapeSelector),
		);
		this.completeRecord(job);
	}

	private completeRecord(job: GeoJob): void {
		job.processed += 1;
		this.memory.writeValue(IO_GEO_PROCESSED, job.processed >>> 0);
		if (job.processed >= job.count) {
			this.finishSuccess(job.processed);
		}
	}

	private finishSuccess(processed: number): void {
		this.activeJob = null;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE);
		this.memory.writeValue(IO_GEO_PROCESSED, processed >>> 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		this.raiseIrq(IRQ_GEO_DONE);
	}

	private finishError(code: number, recordIndex: number): void {
		this.activeJob = null;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
		this.memory.writeValue(IO_GEO_FAULT, packFault(code, recordIndex));
		this.raiseIrq(IRQ_GEO_ERROR);
	}

	private finishRejected(code: number): void {
		this.activeJob = null;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_REJECTED);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, packFault(code, GEO_RECORD_INDEX_NONE));
	}

	private resolveIndexedSpan(base: number, index: number, stride: number, byteLength: number): number | null {
		const offset = index * stride;
		if (!Number.isSafeInteger(offset) || offset > 0xffff_ffff) {
			return null;
		}
		const addr = base + offset;
		if (!Number.isSafeInteger(addr) || addr > 0xffff_ffff) {
			return null;
		}
		const end = addr + byteLength;
		if (!Number.isSafeInteger(end) || end > 0x1_0000_0000) {
			return null;
		}
		return addr >>> 0;
	}

	private readRegister(addr: number): number {
		return (this.memory.readValue(addr) as number) >>> 0;
	}

	private writeSat2Result(addr: number, hit: number, nx: number, ny: number, depth: number, meta: number): void {
		this.memory.writeU32(addr + 0, hit >>> 0);
		this.memory.writeU32(addr + 4, nx >>> 0);
		this.memory.writeU32(addr + 8, ny >>> 0);
		this.memory.writeU32(addr + 12, depth >>> 0);
		this.memory.writeU32(addr + 16, meta >>> 0);
	}
}
