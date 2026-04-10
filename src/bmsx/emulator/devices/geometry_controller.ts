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
	GEO_FAULT_RESULT_CAPACITY,
	GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB,
	GEO_FAULT_REJECT_BAD_CMD,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_REJECT_BUSY,
	GEO_FAULT_SRC_RANGE,
	GEO_INDEX_NONE,
	GEO_OVERLAP2D_BROADPHASE_MASK,
	GEO_OVERLAP2D_BROADPHASE_NONE,
	GEO_OVERLAP2D_CONTACT_POLICY_MASK,
	GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE,
	GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS,
	GEO_OVERLAP2D_MODE_FULL_PASS,
	GEO_OVERLAP2D_MODE_MASK,
	GEO_OVERLAP2D_OUTPUT_POLICY_MASK,
	GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW,
	GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW,
	GEO_PRIMITIVE_AABB,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SHAPE_CONVEX_POLY,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
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
	resultCount?: number;
	exactPairCount?: number;
	broadphasePairCount?: number;
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
const OVERLAP2D_INSTANCE_WORDS = 5;
const OVERLAP2D_INSTANCE_BYTES = OVERLAP2D_INSTANCE_WORDS * 4;
const OVERLAP2D_PAIR_WORDS = 3;
const OVERLAP2D_PAIR_BYTES = OVERLAP2D_PAIR_WORDS * 4;
const OVERLAP2D_RESULT_WORDS = 9;
const OVERLAP2D_RESULT_BYTES = OVERLAP2D_RESULT_WORDS * 4;
const OVERLAP2D_SUMMARY_BYTES = 16;
const OVERLAP2D_DESC_BYTES = 16;
const OVERLAP2D_BOUNDS_BYTES = 16;
const OVERLAP2D_KIND_COMPOUND = 4;
const GEO_SERVICE_BATCH_RECORDS = 1;

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
	private activeJob: GeoJob | null = null;
	private cpuHz: bigint = 1n;
	private workUnitsPerSec: bigint = 1n;
	private workCarry: bigint = 0n;
	private availableWorkUnits = 0;
	private readonly overlapWorldPolyA: number[] = [];
	private readonly overlapWorldPolyB: number[] = [];
	private readonly overlapClip0: number[] = [];
	private readonly overlapClip1: number[] = [];
	private readonly overlapInstanceA = new Uint32Array(OVERLAP2D_INSTANCE_WORDS);
	private readonly overlapInstanceB = new Uint32Array(OVERLAP2D_INSTANCE_WORDS);
	private readonly overlapBoundsA = new Int32Array(4);
	private readonly overlapBoundsB = new Int32Array(4);
	private overlapContactNx = 0;
	private overlapContactNy = 0;
	private overlapContactDepth = 0;
	private overlapContactPx = 0;
	private overlapContactPy = 0;
	private overlapContactFeatureMeta = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly raiseIrq: (mask: number) => void,
		private readonly scheduleService: (deadlineCycles: number) => void,
		private readonly cancelService: () => void,
	) { }

	public setTiming(cpuHz: number, workUnitsPerSec: number, nowCycles: number): void {
		this.cpuHz = BigInt(cpuHz);
		this.workUnitsPerSec = BigInt(workUnitsPerSec);
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.maybeScheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		const job = this.activeJob;
		if (job === null || cycles <= 0) {
			return;
		}
		const numerator = this.workUnitsPerSec * BigInt(cycles) + this.workCarry;
		const wholeUnits = numerator / this.cpuHz;
		this.workCarry = numerator % this.cpuHz;
		if (wholeUnits > 0n) {
			const remainingRecords = job.count - job.processed;
			const maxGrant = BigInt(remainingRecords - this.availableWorkUnits);
			const granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
			this.availableWorkUnits += Number(granted);
		}
		this.maybeScheduleNextService(nowCycles);
	}

	public hasPendingWork(): boolean {
		return this.activeJob !== null;
	}

	public getPendingWorkUnits(): number {
		const job = this.activeJob;
		return job === null ? 0 : (job.count - job.processed) >>> 0;
	}

	public onService(nowCycles: number): void {
		const job = this.activeJob;
		if (job === null || this.availableWorkUnits === 0) {
			this.maybeScheduleNextService(nowCycles);
			return;
		}
		let remaining = this.availableWorkUnits;
		this.availableWorkUnits = 0;
		while (this.activeJob !== null && remaining > 0) {
			switch (job.cmd) {
				case IO_CMD_GEO_XFORM2_BATCH:
					this.processXform2Record(job);
					break;
				case IO_CMD_GEO_SAT2_BATCH:
					this.processSat2Record(job);
					break;
				case IO_CMD_GEO_OVERLAP2D_PASS:
					this.processOverlap2dRecord(job);
					break;
				default:
					this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
					return;
			}
			remaining -= 1;
		}
		this.availableWorkUnits = remaining;
		this.maybeScheduleNextService(nowCycles);
	}

	public reset(): void {
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.activeJob = null;
		this.cancelService();
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
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.activeJob = null;
		this.cancelService();
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

	public onCtrlWrite(nowCycles: number): void {
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
		this.tryStart(nowCycles);
	}

	private tryStart(nowCycles: number): void {
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
			case IO_CMD_GEO_OVERLAP2D_PASS:
				if (!this.validateOverlap2dSubmission(job)) {
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
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			job.resultCount = 0;
			job.exactPairCount = 0;
			job.broadphasePairCount = 0;
			this.writeOverlap2dSummary(job, 0);
		}
		if (job.count === 0) {
			this.finishSuccess(0);
			return;
		}
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.activeJob = job;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_BUSY);
		this.maybeScheduleNextService(nowCycles);
	}

	private maybeScheduleNextService(nowCycles: number): void {
		const job = this.activeJob;
		if (job === null) {
			this.cancelService();
			return;
		}
		const remainingRecords = job.count - job.processed;
		const targetUnits = remainingRecords < GEO_SERVICE_BATCH_RECORDS ? remainingRecords : GEO_SERVICE_BATCH_RECORDS;
		if (this.availableWorkUnits >= targetUnits) {
			this.scheduleService(nowCycles);
			return;
		}
		this.scheduleService(nowCycles + this.cyclesUntilWorkUnits(targetUnits - this.availableWorkUnits));
	}

	private cyclesUntilWorkUnits(targetUnits: number): number {
		const needed = BigInt(targetUnits) * this.cpuHz - this.workCarry;
		if (needed <= 0n) {
			return 1;
		}
		const cycles = (needed + this.workUnitsPerSec - 1n) / this.workUnitsPerSec;
		const max = BigInt(Number.MAX_SAFE_INTEGER);
		const clamped = cycles > max ? max : cycles;
		const out = Number(clamped);
		return out <= 0 ? 1 : out;
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

	private validateOverlap2dSubmission(job: GeoJob): boolean {
		const mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
		if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) !== GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
			|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) !== GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
			|| (job.param0 & 0xffff_0000) !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (job.stride0 !== OVERLAP2D_INSTANCE_BYTES) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_NONE
				|| job.stride1 !== OVERLAP2D_PAIR_BYTES
				|| job.stride2 === 0) {
				this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
				return false;
			}
		} else if (mode === GEO_OVERLAP2D_MODE_FULL_PASS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
				|| job.src1 !== 0
				|| job.stride1 !== 0
				|| job.stride2 !== 0
				|| job.count > 0xffff) {
				this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
				return false;
			}
		} else {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if ((job.src0 & WORD_ALIGN_MASK) !== 0
			|| (job.src1 & WORD_ALIGN_MASK) !== 0
			|| (job.dst0 & WORD_ALIGN_MASK) !== 0
			|| (job.dst1 & WORD_ALIGN_MASK) !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
			return false;
		}
		if (!this.memory.isRamRange(job.dst1, OVERLAP2D_SUMMARY_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		if (job.param1 !== 0 && !this.memory.isRamRange(job.dst0, OVERLAP2D_RESULT_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		if (job.count === 0) {
			return true;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !this.memory.isReadableMainMemoryRange(job.src1, OVERLAP2D_PAIR_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		const instanceCount = mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
		const lastInstanceAddr = this.resolveIndexedSpan(job.src0, instanceCount - 1, job.stride0, OVERLAP2D_INSTANCE_BYTES);
		if (lastInstanceAddr === null || !this.memory.isReadableMainMemoryRange(lastInstanceAddr, OVERLAP2D_INSTANCE_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		return true;
	}

	private processOverlap2dRecord(job: GeoJob): void {
		const mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			this.processOverlap2dCandidateRecord(job);
			return;
		}
		this.processOverlap2dFullPassRecord(job);
	}

	private processOverlap2dCandidateRecord(job: GeoJob): void {
		const recordIndex = job.processed;
		const pairAddr = this.resolveIndexedSpan(job.src1, recordIndex, job.stride1, OVERLAP2D_PAIR_BYTES);
		if (pairAddr === null || !this.memory.isReadableMainMemoryRange(pairAddr, OVERLAP2D_PAIR_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const instanceAIndex = this.memory.readU32(pairAddr + 0);
		const instanceBIndex = this.memory.readU32(pairAddr + 4);
		const pairMeta = this.memory.readU32(pairAddr + 8);
		if (instanceAIndex === instanceBIndex) {
			this.finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
			return;
		}
		const instanceCount = job.stride2;
		if (instanceAIndex >= instanceCount || instanceBIndex >= instanceCount) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		if (!this.readOverlapInstanceAt(job, instanceAIndex, this.overlapInstanceA)
			|| !this.readOverlapInstanceAt(job, instanceBIndex, this.overlapInstanceB)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		if (!this.processOverlap2dPair(job, recordIndex, this.overlapInstanceA, this.overlapInstanceB, pairMeta)) {
			return;
		}
		this.writeOverlap2dSummary(job, 0);
		this.completeRecord(job);
	}

	private processOverlap2dFullPassRecord(job: GeoJob): void {
		const recordIndex = job.processed;
		if (!this.readOverlapInstanceAt(job, recordIndex, this.overlapInstanceA)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const instanceCount = job.count;
		for (let instanceBIndex = recordIndex + 1; instanceBIndex < instanceCount; instanceBIndex += 1) {
			if (!this.readOverlapInstanceAt(job, instanceBIndex, this.overlapInstanceB)) {
				this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return;
			}
			const pairMeta = (((recordIndex & 0xffff) << 16) | (instanceBIndex & 0xffff)) >>> 0;
			if (!this.processOverlap2dPair(job, recordIndex, this.overlapInstanceA, this.overlapInstanceB, pairMeta)) {
				return;
			}
		}
		this.writeOverlap2dSummary(job, 0);
		this.completeRecord(job);
	}

	private readOverlapInstanceAt(job: GeoJob, instanceIndex: number, out: Uint32Array): boolean {
		const instanceAddr = this.resolveIndexedSpan(job.src0, instanceIndex, job.stride0, OVERLAP2D_INSTANCE_BYTES);
		if (instanceAddr === null || !this.memory.isReadableMainMemoryRange(instanceAddr, OVERLAP2D_INSTANCE_BYTES)) {
			return false;
		}
		out[0] = this.memory.readU32(instanceAddr + 0);
		out[1] = this.memory.readU32(instanceAddr + 4);
		out[2] = this.memory.readU32(instanceAddr + 8);
		out[3] = this.memory.readU32(instanceAddr + 12);
		out[4] = this.memory.readU32(instanceAddr + 16);
		return true;
	}

	private processOverlap2dPair(job: GeoJob, recordIndex: number, instanceA: Uint32Array, instanceB: Uint32Array, pairMeta: number): boolean {
		const shapeAAddr = instanceA[0];
		const txA = toSignedWord(instanceA[1]);
		const tyA = toSignedWord(instanceA[2]);
		const layerA = instanceA[3];
		const maskA = instanceA[4];
		const shapeBAddr = instanceB[0];
		const txB = toSignedWord(instanceB[1]);
		const tyB = toSignedWord(instanceB[2]);
		const layerB = instanceB[3];
		const maskB = instanceB[4];
		if (!this.memory.isReadableMainMemoryRange(shapeAAddr, OVERLAP2D_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeBAddr, OVERLAP2D_DESC_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if ((maskA & layerB) === 0 || (maskB & layerA) === 0) {
			return true;
		}
		job.broadphasePairCount = (job.broadphasePairCount ?? 0) + 1;
		if (!this.readPieceBounds(shapeAAddr, txA, tyA, this.overlapBoundsA)
			|| !this.readPieceBounds(shapeBAddr, txB, tyB, this.overlapBoundsB)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if (!this.boundsOverlap(this.overlapBoundsA, this.overlapBoundsB)) {
			return true;
		}
		const shapeAKind = this.memory.readU32(shapeAAddr + 0);
		const shapeACount = this.memory.readU32(shapeAAddr + 4);
		const shapeADataOffset = this.memory.readU32(shapeAAddr + 8);
		const shapeBKind = this.memory.readU32(shapeBAddr + 0);
		const shapeBCount = this.memory.readU32(shapeBAddr + 4);
		const shapeBDataOffset = this.memory.readU32(shapeBAddr + 8);
		const shapeAPieceCount = shapeAKind === OVERLAP2D_KIND_COMPOUND ? shapeACount : 1;
		const shapeBPieceCount = shapeBKind === OVERLAP2D_KIND_COMPOUND ? shapeBCount : 1;
		if (shapeAPieceCount === 0 || shapeBPieceCount === 0
			|| (shapeAKind === OVERLAP2D_KIND_COMPOUND && (shapeADataOffset & WORD_ALIGN_MASK) !== 0)
			|| (shapeBKind === OVERLAP2D_KIND_COMPOUND && (shapeBDataOffset & WORD_ALIGN_MASK) !== 0)
			|| (shapeAKind !== OVERLAP2D_KIND_COMPOUND && shapeAKind !== GEO_PRIMITIVE_AABB && shapeAKind !== GEO_PRIMITIVE_CONVEX_POLY)
			|| (shapeBKind !== OVERLAP2D_KIND_COMPOUND && shapeBKind !== GEO_PRIMITIVE_AABB && shapeBKind !== GEO_PRIMITIVE_CONVEX_POLY)) {
			this.finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
			return false;
		}
		job.exactPairCount = (job.exactPairCount ?? 0) + 1;
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
			const pieceAAddr = shapeAKind === OVERLAP2D_KIND_COMPOUND
				? this.resolveByteOffset(shapeAAddr, shapeADataOffset + pieceAIndex * OVERLAP2D_DESC_BYTES, OVERLAP2D_DESC_BYTES)
				: shapeAAddr;
			if (pieceAAddr === null || !this.memory.isReadableMainMemoryRange(pieceAAddr, OVERLAP2D_DESC_BYTES)) {
				this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			if (!this.readPieceBounds(pieceAAddr, txA, tyA, this.overlapBoundsA)) {
				this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			for (let pieceBIndex = 0; pieceBIndex < shapeBPieceCount; pieceBIndex += 1) {
				const pieceBAddr = shapeBKind === OVERLAP2D_KIND_COMPOUND
					? this.resolveByteOffset(shapeBAddr, shapeBDataOffset + pieceBIndex * OVERLAP2D_DESC_BYTES, OVERLAP2D_DESC_BYTES)
					: shapeBAddr;
				if (pieceBAddr === null || !this.memory.isReadableMainMemoryRange(pieceBAddr, OVERLAP2D_DESC_BYTES)) {
					this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
					return false;
				}
				if (!this.readPieceBounds(pieceBAddr, txB, tyB, this.overlapBoundsB)) {
					this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
					return false;
				}
				if (!this.boundsOverlap(this.overlapBoundsA, this.overlapBoundsB)) {
					continue;
				}
				if (!this.computePiecePairContact(pieceAAddr, txA, tyA, pieceBAddr, txB, tyB, recordIndex)) {
					if (this.activeJob === null) {
						return false;
					}
					continue;
				}
				if (!bestHit
					|| this.overlapContactDepth < bestDepth
					|| (this.overlapContactDepth === bestDepth && (pieceAIndex < bestPieceA
						|| (pieceAIndex === bestPieceA && (pieceBIndex < bestPieceB
							|| (pieceBIndex === bestPieceB && this.overlapContactFeatureMeta < bestFeatureMeta)))))) {
					bestHit = true;
					bestDepth = this.overlapContactDepth;
					bestPieceA = pieceAIndex;
					bestPieceB = pieceBIndex;
					bestFeatureMeta = this.overlapContactFeatureMeta;
					bestNx = this.overlapContactNx;
					bestNy = this.overlapContactNy;
					bestPx = this.overlapContactPx;
					bestPy = this.overlapContactPy;
				}
			}
		}
		if (!bestHit) {
			return true;
		}
		const resultCount = job.resultCount ?? 0;
		if (resultCount >= job.param1) {
			this.writeOverlap2dSummary(job, GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
			this.finishError(GEO_FAULT_RESULT_CAPACITY, recordIndex);
			return false;
		}
		const resultAddr = this.resolveIndexedSpan(job.dst0, resultCount, OVERLAP2D_RESULT_BYTES, OVERLAP2D_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, OVERLAP2D_RESULT_BYTES)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return false;
		}
		this.writeOverlap2dResult(resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
		job.resultCount = resultCount + 1;
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


	private readPieceBounds(pieceAddr: number, tx: number, ty: number, out: Int32Array): boolean {
		const boundsOffset = this.memory.readU32(pieceAddr + 12);
		const boundsAddr = this.resolveByteOffset(pieceAddr, boundsOffset, OVERLAP2D_BOUNDS_BYTES);
		if (boundsAddr === null || !this.memory.isReadableMainMemoryRange(boundsAddr, OVERLAP2D_BOUNDS_BYTES)) {
			return false;
		}
		out[0] = this.readI32(boundsAddr + 0) + tx;
		out[1] = this.readI32(boundsAddr + 4) + ty;
		out[2] = this.readI32(boundsAddr + 8) + tx;
		out[3] = this.readI32(boundsAddr + 12) + ty;
		return true;
	}

	private computePiecePairContact(
		pieceAAddr: number,
		txA: number,
		tyA: number,
		pieceBAddr: number,
		txB: number,
		tyB: number,
		recordIndex: number,
	): boolean {
		const primitiveA = this.memory.readU32(pieceAAddr + 0);
		const primitiveB = this.memory.readU32(pieceBAddr + 0);
		if ((primitiveA !== GEO_PRIMITIVE_AABB && primitiveA !== GEO_PRIMITIVE_CONVEX_POLY)
			|| (primitiveB !== GEO_PRIMITIVE_AABB && primitiveB !== GEO_PRIMITIVE_CONVEX_POLY)) {
			this.finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
			return false;
		}
		if (!this.loadWorldPoly(pieceAAddr, txA, tyA, this.overlapWorldPolyA)
			|| !this.loadWorldPoly(pieceBAddr, txB, tyB, this.overlapWorldPolyB)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		return this.computePolyPairContact(this.overlapWorldPolyA, this.overlapWorldPolyB);
	}

	private loadWorldPoly(pieceAddr: number, tx: number, ty: number, out: number[]): boolean {
		const primitive = this.memory.readU32(pieceAddr + 0);
		const dataCount = this.memory.readU32(pieceAddr + 4);
		const dataOffset = this.memory.readU32(pieceAddr + 8);
		const dataAddr = this.resolveByteOffset(pieceAddr, dataOffset, primitive === GEO_PRIMITIVE_AABB ? 16 : dataCount * XFORM2_VERTEX_BYTES);
		if (dataAddr === null) {
			return false;
		}
		out.length = 0;
		if (primitive === GEO_PRIMITIVE_AABB) {
			if (dataCount !== 4 || !this.memory.isReadableMainMemoryRange(dataAddr, 16)) {
				return false;
			}
			const left = this.readI32(dataAddr + 0);
			const top = this.readI32(dataAddr + 4);
			const right = this.readI32(dataAddr + 8);
			const bottom = this.readI32(dataAddr + 12);
			this.pushWorldVertex(out, tx, ty, left, top);
			this.pushWorldVertex(out, tx, ty, right, top);
			this.pushWorldVertex(out, tx, ty, right, bottom);
			this.pushWorldVertex(out, tx, ty, left, bottom);
			return true;
		}
		if (primitive !== GEO_PRIMITIVE_CONVEX_POLY || dataCount < 3 || !this.memory.isReadableMainMemoryRange(dataAddr, dataCount * XFORM2_VERTEX_BYTES)) {
			return false;
		}
		for (let vertexIndex = 0; vertexIndex < dataCount; vertexIndex += 1) {
			const vertexAddr = dataAddr + vertexIndex * XFORM2_VERTEX_BYTES;
			this.pushWorldVertex(out, tx, ty, this.readI32(vertexAddr + 0), this.readI32(vertexAddr + 4));
		}
		return true;
	}

	private pushWorldVertex(out: number[], tx: number, ty: number, localX: number, localY: number): void {
		out.push((localX + tx) / FIX16_SCALE);
		out.push((localY + ty) / FIX16_SCALE);
	}

	private boundsOverlap(a: Int32Array, b: Int32Array): boolean {
		return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
	}

	private computePolyPairContact(polyA: number[], polyB: number[]): boolean {
		let bestOverlap = Number.POSITIVE_INFINITY;
		let bestAxisX = 0;
		let bestAxisY = 0;
		let bestEdgeIndex = 0;
		let bestOwner = 0;
		let sawAxis = false;
		for (let owner = 0; owner < 2; owner += 1) {
			const poly = owner === 0 ? polyA : polyB;
			for (let i = 0; i < poly.length; i += 2) {
				const next = i + 2 >= poly.length ? 0 : i + 2;
				const nx = -(poly[next + 1] - poly[i + 1]);
				const ny = poly[next] - poly[i];
				const len = Math.sqrt((nx * nx) + (ny * ny));
				if (!(len > 0)) {
					continue;
				}
				sawAxis = true;
				const ax = nx / len;
				const ay = ny / len;
				const projA = this.projectPoly(polyA, ax, ay);
				const projB = this.projectPoly(polyB, ax, ay);
				const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
				if (!(overlap > 0)) {
					return false;
				}
				const edgeIndex = i >> 1;
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
		const centerA = this.computePolyAverage(polyA);
		const centerB = this.computePolyAverage(polyB);
		if ((((centerA.x - centerB.x) * bestAxisX) + ((centerA.y - centerB.y) * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		const intersection = this.clipConvexPolygons(polyA, polyB);
		let pointX;
		let pointY;
		if (intersection.length === 0) {
			pointX = (centerA.x + centerB.x) * 0.5;
			pointY = (centerA.y + centerB.y) * 0.5;
		} else {
			const centroid = this.computePolyAverage(intersection);
			pointX = centroid.x;
			pointY = centroid.y;
		}
		this.overlapContactNx = saturateRoundedI32(bestAxisX * FIX16_SCALE);
		this.overlapContactNy = saturateRoundedI32(bestAxisY * FIX16_SCALE);
		this.overlapContactDepth = saturateRoundedI32(bestOverlap * FIX16_SCALE);
		this.overlapContactPx = saturateRoundedI32(pointX * FIX16_SCALE);
		this.overlapContactPy = saturateRoundedI32(pointY * FIX16_SCALE);
		this.overlapContactFeatureMeta = bestEdgeIndex >>> 0;
		return true;
	}

	private projectPoly(poly: number[], ax: number, ay: number): { min: number; max: number } {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < poly.length; i += 2) {
			const projection = (poly[i] * ax) + (poly[i + 1] * ay);
			if (projection < min) {
				min = projection;
			}
			if (projection > max) {
				max = projection;
			}
		}
		return { min, max };
	}

	private computePolyAverage(poly: number[]): { x: number; y: number } {
		let sumX = 0;
		let sumY = 0;
		const count = poly.length >> 1;
		for (let i = 0; i < poly.length; i += 2) {
			sumX += poly[i];
			sumY += poly[i + 1];
		}
		return { x: sumX / count, y: sumY / count };
	}

	private clipConvexPolygons(polyA: number[], polyB: number[]): number[] {
		this.overlapClip0.length = polyA.length;
		for (let i = 0; i < polyA.length; i += 1) {
			this.overlapClip0[i] = polyA[i];
		}
		let input = this.overlapClip0;
		let output = this.overlapClip1;
		for (let i = 0; i < polyB.length; i += 2) {
			output.length = 0;
			const x0 = polyB[i];
			const y0 = polyB[i + 1];
			const next = i + 2 >= polyB.length ? 0 : i + 2;
			const x1 = polyB[next];
			const y1 = polyB[next + 1];
			if (input.length === 0) {
				break;
			}
			let sx = input[input.length - 2];
			let sy = input[input.length - 1];
			let sd = this.clipPlaneDistance(x0, y0, x1, y1, sx, sy);
			let sInside = sd >= 0;
			for (let j = 0; j < input.length; j += 2) {
				const ex = input[j];
				const ey = input[j + 1];
				const ed = this.clipPlaneDistance(x0, y0, x1, y1, ex, ey);
				const eInside = ed >= 0;
				if (sInside && eInside) {
					output.push(ex, ey);
				} else if (sInside && !eInside) {
					const t = sd / (sd - ed);
					output.push(sx + ((ex - sx) * t), sy + ((ey - sy) * t));
				} else if (!sInside && eInside) {
					const t = sd / (sd - ed);
					output.push(sx + ((ex - sx) * t), sy + ((ey - sy) * t), ex, ey);
				}
				sx = ex;
				sy = ey;
				sd = ed;
				sInside = eInside;
			}
			const swap = input;
			input = output;
			output = swap;
		}
		return input;
	}

	private clipPlaneDistance(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
		return ((x1 - x0) * (py - y0)) - ((y1 - y0) * (px - x0));
	}

	private writeOverlap2dSummary(job: GeoJob, flags: number): void {
		this.memory.writeU32(job.dst1 + 0, (job.resultCount ?? 0) >>> 0);
		this.memory.writeU32(job.dst1 + 4, (job.exactPairCount ?? 0) >>> 0);
		this.memory.writeU32(job.dst1 + 8, (job.broadphasePairCount ?? 0) >>> 0);
		this.memory.writeU32(job.dst1 + 12, flags >>> 0);
	}

	private writeOverlap2dResult(addr: number, nx: number, ny: number, depth: number, px: number, py: number, pieceA: number, pieceB: number, featureMeta: number, pairMeta: number): void {
		this.memory.writeU32(addr + 0, nx >>> 0);
		this.memory.writeU32(addr + 4, ny >>> 0);
		this.memory.writeU32(addr + 8, depth >>> 0);
		this.memory.writeU32(addr + 12, px >>> 0);
		this.memory.writeU32(addr + 16, py >>> 0);
		this.memory.writeU32(addr + 20, pieceA >>> 0);
		this.memory.writeU32(addr + 24, pieceB >>> 0);
		this.memory.writeU32(addr + 28, featureMeta >>> 0);
		this.memory.writeU32(addr + 32, pairMeta >>> 0);
	}

	private resolveByteOffset(base: number, offset: number, byteLength: number): number | null {
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

	private readI32(addr: number): number {
		return this.memory.readU32(addr) | 0;
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
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.cancelService();
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE);
		this.memory.writeValue(IO_GEO_PROCESSED, processed >>> 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		this.raiseIrq(IRQ_GEO_DONE);
	}

	private finishError(code: number, recordIndex: number): void {
		this.activeJob = null;
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.cancelService();
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
		this.memory.writeValue(IO_GEO_FAULT, packFault(code, recordIndex));
		this.raiseIrq(IRQ_GEO_ERROR);
	}

	private finishRejected(code: number): void {
		this.activeJob = null;
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.cancelService();
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
