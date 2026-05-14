import {
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_FAULT_ACK,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
	IO_GEO_REGISTER_ADDRS,
	IO_GEO_SRC0,
	IO_GEO_SRC1,
	IO_GEO_SRC2,
	IO_GEO_STATUS,
	IO_GEO_STRIDE0,
	IO_GEO_STRIDE1,
	IO_GEO_STRIDE2,
	IRQ_GEO_DONE,
	IRQ_GEO_ERROR,
} from '../../bus/io';
import {
	GEO_CTRL_ABORT,
	GEO_CTRL_START,
	GEO_FAULT_ABORTED_BY_HOST,
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_CODE_MASK,
	GEO_FAULT_CODE_SHIFT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_RECORD_INDEX_MASK,
	GEO_FAULT_RECORD_INDEX_NONE,
	GEO_FAULT_RESULT_CAPACITY,
	GEO_FAULT_REJECT_BAD_CMD,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_REJECT_BUSY,
	GEO_FAULT_SRC_RANGE,
	GEOMETRY_CONTROLLER_PHASE_BUSY,
	GEOMETRY_CONTROLLER_PHASE_DONE,
	GEOMETRY_CONTROLLER_PHASE_ERROR,
	GEOMETRY_CONTROLLER_PHASE_IDLE,
	GEOMETRY_CONTROLLER_PHASE_REJECTED,
	GEOMETRY_CONTROLLER_REGISTER_COUNT,
	type GeometryControllerPhase,
	GEO_INDEX_NONE,
	GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB,
	GEO_OVERLAP2D_BROADPHASE_MASK,
	GEO_OVERLAP2D_BROADPHASE_NONE,
	GEO_OVERLAP2D_CONTACT_POLICY_MASK,
	GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE,
	GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS,
	GEO_OVERLAP2D_MODE_FULL_PASS,
	GEO_OVERLAP2D_MODE_MASK,
	GEO_OVERLAP2D_OUTPUT_POLICY_MASK,
	GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW,
	GEO_OVERLAP2D_AABB_DATA_COUNT,
	GEO_OVERLAP2D_INSTANCE_BYTES,
	GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET,
	GEO_OVERLAP2D_INSTANCE_MASK_OFFSET,
	GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TX_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TY_OFFSET,
	GEO_OVERLAP2D_INSTANCE_WORDS,
	GEO_OVERLAP2D_PAIR_BYTES,
	GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET,
	GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET,
	GEO_OVERLAP2D_PAIR_META_OFFSET,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK,
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
	GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET,
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
	GEO_SAT_META_AXIS_MASK,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SHAPE_CONVEX_POLY,
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
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
} from './contracts';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import {
	FIX16_SCALE,
	f32BitsToNumber,
	numberToF32Bits,
	saturateRoundedI32,
	toSignedWord,
	transformFixed16,
} from '../../common/numeric';
import type { IrqController } from '../irq/controller';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_GEO, type DeviceScheduler } from '../../scheduler/device';

export type GeometryJobState = {
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
	resultCount: number;
	exactPairCount: number;
	broadphasePairCount: number;
};

export type GeometryControllerState = {
	phase: GeometryControllerPhase;
	registerWords: number[];
	activeJob: GeometryJobState | null;
	workCarry: number;
	availableWorkUnits: number;
};

type GeoJob = GeometryJobState;
type GeoProjectionScratch = {
	min: number;
	max: number;
};
type GeoPointScratch = {
	x: number;
	y: number;
};

const WORD_ALIGN_MASK = 3;
const GEO_SERVICE_BATCH_RECORDS = 1;

function packFault(code: number, recordIndex: number): number {
	return (((code & GEO_FAULT_CODE_MASK) << GEO_FAULT_CODE_SHIFT) | (recordIndex & GEO_FAULT_RECORD_INDEX_MASK)) >>> 0;
}

function packSat2Meta(axisIndex: number, shapeSelector: number): number {
	return (((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK)) >>> 0;
}

export class GeometryController {
	private phase: GeometryControllerPhase = GEOMETRY_CONTROLLER_PHASE_IDLE;
	private activeJob: GeoJob | null = null;
	private cpuHz = 1;
	private workUnitsPerSec = 1;
	private workCarry = 0;
	private availableWorkUnits = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly overlapWorldPolyA: number[] = [];
	private readonly overlapWorldPolyB: number[] = [];
	private readonly overlapClip0: number[] = [];
	private readonly overlapClip1: number[] = [];
	private readonly overlapInstanceA = new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS);
	private readonly overlapInstanceB = new Uint32Array(GEO_OVERLAP2D_INSTANCE_WORDS);
	private readonly overlapBoundsA = new Float64Array(4);
	private readonly overlapBoundsB = new Float64Array(4);
	private readonly overlapProjectionA: GeoProjectionScratch = { min: 0, max: 0 };
	private readonly overlapProjectionB: GeoProjectionScratch = { min: 0, max: 0 };
	private readonly overlapCenterA: GeoPointScratch = { x: 0, y: 0 };
	private readonly overlapCenterB: GeoPointScratch = { x: 0, y: 0 };
	private readonly overlapCentroid: GeoPointScratch = { x: 0, y: 0 };
	private overlapContactNx = 0;
	private overlapContactNy = 0;
	private overlapContactDepth = 0;
	private overlapContactPx = 0;
	private overlapContactPy = 0;
	private overlapContactFeatureMeta = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.memory.mapIoWrite(IO_GEO_CTRL, this.onCtrlRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_GEO_FAULT_ACK, this.onFaultAckWrite.bind(this));
	}

	private onCtrlRegisterWrite(): void {
		this.onCtrlWrite(this.scheduler.currentNowCycles());
	}

	private onFaultAckWrite(_addr: number, value: Value): void {
		if (((value as number) >>> 0) === 0) {
			return;
		}
		const status = this.memory.readIoU32(IO_GEO_STATUS) & ~(GEO_STATUS_ERROR | GEO_STATUS_REJECTED);
		this.memory.writeIoValue(IO_GEO_STATUS, status);
		this.memory.writeIoValue(IO_GEO_FAULT, 0);
		this.memory.writeIoValue(IO_GEO_FAULT_ACK, 0);
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_ERROR) {
			this.phase = GEOMETRY_CONTROLLER_PHASE_DONE;
		} else if (this.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED) {
			this.phase = GEOMETRY_CONTROLLER_PHASE_IDLE;
		}
	}

	public setTiming(cpuHz: number, workUnitsPerSec: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		this.workUnitsPerSec = workUnitsPerSec;
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.workCarry = 0;
			this.availableWorkUnits = 0;
		}
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY || cycles <= 0) {
			return;
		}
		const job = this.activeJob!;
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, this.workUnitsPerSec, this.workCarry, cycles);
		const wholeUnits = this.budgetAccrual.wholeUnits;
		this.workCarry = this.budgetAccrual.carry;
		if (wholeUnits > 0) {
			const remainingRecords = job.count - job.processed;
			const maxGrant = remainingRecords - this.availableWorkUnits;
			this.availableWorkUnits += wholeUnits > maxGrant ? maxGrant : wholeUnits;
		}
		this.scheduleNextService(nowCycles);
	}

	public hasPendingWork(): boolean {
		return this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY;
	}

	public getPendingWorkUnits(): number {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) {
			return 0;
		}
		const job = this.activeJob!;
		return (job.count - job.processed) >>> 0;
	}

	public onService(nowCycles: number): void {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY || this.availableWorkUnits === 0) {
			this.scheduleNextService(nowCycles);
			return;
		}
		const job = this.activeJob!;
		let remaining = this.availableWorkUnits;
		this.availableWorkUnits = 0;
		while (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY && remaining > 0) {
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
		this.availableWorkUnits = this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY ? remaining : 0;
		this.scheduleNextService(nowCycles);
	}

	public reset(): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_IDLE;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.activeJob = null;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.memory.writeValue(IO_GEO_SRC0, 0);
		this.memory.writeValue(IO_GEO_SRC1, 0);
		this.memory.writeValue(IO_GEO_SRC2, 0);
		this.memory.writeValue(IO_GEO_DST0, 0);
		this.memory.writeValue(IO_GEO_DST1, 0);
		this.memory.writeValue(IO_GEO_COUNT, 0);
		this.memory.writeValue(IO_GEO_CMD, 0);
		this.memory.writeIoValue(IO_GEO_CTRL, 0);
		this.memory.writeValue(IO_GEO_STATUS, 0);
		this.memory.writeValue(IO_GEO_PARAM0, 0);
		this.memory.writeValue(IO_GEO_PARAM1, 0);
		this.memory.writeValue(IO_GEO_STRIDE0, 0);
		this.memory.writeValue(IO_GEO_STRIDE1, 0);
		this.memory.writeValue(IO_GEO_STRIDE2, 0);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		this.memory.writeIoValue(IO_GEO_FAULT_ACK, 0);
	}

	public captureState(): GeometryControllerState {
		const registerWords = new Array<number>(GEOMETRY_CONTROLLER_REGISTER_COUNT);
		for (let index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.memory.readIoU32(IO_GEO_REGISTER_ADDRS[index]!);
		}
		return {
			phase: this.phase,
			registerWords,
			activeJob: this.activeJob === null ? null : { ...this.activeJob },
			workCarry: this.workCarry,
			availableWorkUnits: this.availableWorkUnits,
		};
	}

	public restoreState(state: GeometryControllerState, nowCycles: number): void {
		for (let index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_GEO_REGISTER_ADDRS[index]!, state.registerWords[index]!);
		}
		this.phase = state.phase;
		this.activeJob = state.activeJob === null ? null : { ...state.activeJob };
		this.workCarry = state.workCarry;
		this.availableWorkUnits = state.availableWorkUnits;
		this.memory.writeIoValue(IO_GEO_CTRL, this.memory.readIoU32(IO_GEO_CTRL) & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
		this.scheduleNextService(nowCycles);
	}

	public onCtrlWrite(nowCycles: number): void {
		const ctrl = this.memory.readIoU32(IO_GEO_CTRL);
		const start = (ctrl & GEO_CTRL_START) !== 0;
		const abort = (ctrl & GEO_CTRL_ABORT) !== 0;
		if (!start && !abort) {
			return;
		}
		this.memory.writeIoValue(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
		if (
			this.phase === GEOMETRY_CONTROLLER_PHASE_ERROR ||
			this.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED
		) {
			return;
		}
		if (start && abort) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return;
		}
		if (abort) {
			if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY) {
				this.finishError(GEO_FAULT_ABORTED_BY_HOST, this.activeJob!.processed);
			}
			return;
		}
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.finishRejected(GEO_FAULT_REJECT_BUSY);
			return;
		}
		this.tryStart(nowCycles);
	}

	private tryStart(nowCycles: number): void {
		const job: GeoJob = {
			cmd: this.memory.readIoU32(IO_GEO_CMD),
			src0: this.memory.readIoU32(IO_GEO_SRC0),
			src1: this.memory.readIoU32(IO_GEO_SRC1),
			src2: this.memory.readIoU32(IO_GEO_SRC2),
			dst0: this.memory.readIoU32(IO_GEO_DST0),
			dst1: this.memory.readIoU32(IO_GEO_DST1),
			count: this.memory.readIoU32(IO_GEO_COUNT),
			param0: this.memory.readIoU32(IO_GEO_PARAM0),
			param1: this.memory.readIoU32(IO_GEO_PARAM1),
			stride0: this.memory.readIoU32(IO_GEO_STRIDE0),
			stride1: this.memory.readIoU32(IO_GEO_STRIDE1),
			stride2: this.memory.readIoU32(IO_GEO_STRIDE2),
			processed: 0,
			resultCount: 0,
			exactPairCount: 0,
			broadphasePairCount: 0,
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
			this.writeOverlap2dSummary(job, 0);
		}
		if (job.count === 0) {
			this.finishSuccess(0);
			return;
		}
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.activeJob = job;
		this.phase = GEOMETRY_CONTROLLER_PHASE_BUSY;
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_BUSY);
		this.scheduleNextService(nowCycles);
	}

	private scheduleNextService(nowCycles: number): void {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
			return;
		}
		const job = this.activeJob!;
		const remainingRecords = job.count - job.processed;
		const targetUnits = remainingRecords < GEO_SERVICE_BATCH_RECORDS ? remainingRecords : GEO_SERVICE_BATCH_RECORDS;
		if (this.availableWorkUnits >= targetUnits) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, nowCycles);
			return;
		}
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, nowCycles + cyclesUntilBudgetUnits(this.cpuHz, this.workUnitsPerSec, this.workCarry, targetUnits - this.availableWorkUnits));
	}

	private validateXform2Submission(job: GeoJob): boolean {
		if (job.param0 !== 0 || job.param1 !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (job.stride0 !== GEO_XFORM2_RECORD_BYTES || job.stride1 !== GEO_VERTEX2_BYTES || job.stride2 !== GEO_XFORM2_MATRIX_BYTES) {
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
		if (!this.memory.isRamRange(job.dst0, GEO_VERTEX2_BYTES)) {
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
		if (job.stride0 !== GEO_SAT2_PAIR_BYTES || job.stride1 !== GEO_SAT2_DESC_BYTES || job.stride2 !== GEO_VERTEX2_BYTES) {
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
		if (!this.memory.isRamRange(job.dst0, GEO_SAT2_RESULT_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		return true;
	}

	private validateOverlap2dSubmission(job: GeoJob): boolean {
		const mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
		if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) !== GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
			|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) !== GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
			|| (job.param0 & GEO_OVERLAP2D_PARAM0_RESERVED_MASK) !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (job.stride0 !== GEO_OVERLAP2D_INSTANCE_BYTES) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
		if (job.src2 !== 0) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_NONE
				|| job.stride1 !== GEO_OVERLAP2D_PAIR_BYTES
				|| job.stride2 === 0) {
				this.finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
				return false;
			}
		} else if (mode === GEO_OVERLAP2D_MODE_FULL_PASS) {
			if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) !== GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
				|| job.src1 !== 0
				|| job.stride1 !== 0
				|| job.stride2 !== 0
				|| job.count > GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) {
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
		if (!this.memory.isRamRange(job.dst1, GEO_OVERLAP2D_SUMMARY_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		if (!this.memory.isRamRange(job.dst0, GEO_OVERLAP2D_RESULT_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
			return false;
		}
		if (job.count === 0) {
			return true;
		}
		if (mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !this.memory.isReadableMainMemoryRange(job.src1, GEO_OVERLAP2D_PAIR_BYTES)) {
			this.finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
		const instanceCount = mode === GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
		const lastInstanceAddr = this.resolveIndexedSpan(job.src0, instanceCount - 1, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
		if (lastInstanceAddr === null || !this.memory.isReadableMainMemoryRange(lastInstanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
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
		const pairAddr = this.resolveIndexedSpan(job.src1, recordIndex, job.stride1, GEO_OVERLAP2D_PAIR_BYTES);
		if (pairAddr === null || !this.memory.isReadableMainMemoryRange(pairAddr, GEO_OVERLAP2D_PAIR_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const instanceAIndex = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
		const instanceBIndex = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
		const pairMeta = this.memory.readU32(pairAddr + GEO_OVERLAP2D_PAIR_META_OFFSET);
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
			const pairMeta = (((recordIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
				| (instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK)) >>> 0;
			if (!this.processOverlap2dPair(job, recordIndex, this.overlapInstanceA, this.overlapInstanceB, pairMeta)) {
				return;
			}
		}
		this.writeOverlap2dSummary(job, 0);
		this.completeRecord(job);
	}

	private readOverlapInstanceAt(job: GeoJob, instanceIndex: number, out: Uint32Array): boolean {
		const instanceAddr = this.resolveIndexedSpan(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
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

	private processOverlap2dPair(job: GeoJob, recordIndex: number, instanceA: Uint32Array, instanceB: Uint32Array, pairMeta: number): boolean {
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
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if ((maskA & layerB) === 0 || (maskB & layerA) === 0) {
			return true;
		}
		job.broadphasePairCount += 1;
		if (!this.readPieceBounds(shapeAAddr, txA, tyA, this.overlapBoundsA)
			|| !this.readPieceBounds(shapeBAddr, txB, tyB, this.overlapBoundsB)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if (!this.boundsOverlap(this.overlapBoundsA, this.overlapBoundsB)) {
			return true;
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
			|| (shapeAIsCompound && (shapeADataOffset & WORD_ALIGN_MASK) !== 0)
			|| (shapeBIsCompound && (shapeBDataOffset & WORD_ALIGN_MASK) !== 0)
			|| (!shapeAIsCompound && shapeAKind !== GEO_PRIMITIVE_AABB && shapeAKind !== GEO_PRIMITIVE_CONVEX_POLY)
			|| (!shapeBIsCompound && shapeBKind !== GEO_PRIMITIVE_AABB && shapeBKind !== GEO_PRIMITIVE_CONVEX_POLY)) {
			this.finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
			return false;
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
				? this.resolveByteOffset(shapeAAddr, shapeADataOffset + pieceAIndex * GEO_OVERLAP2D_SHAPE_DESC_BYTES, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
				: shapeAAddr;
			if (pieceAAddr === null || !this.memory.isReadableMainMemoryRange(pieceAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
				this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			if (!this.readPieceBounds(pieceAAddr, txA, tyA, this.overlapBoundsA)) {
				this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			for (let pieceBIndex = 0; pieceBIndex < shapeBPieceCount; pieceBIndex += 1) {
				const pieceBAddr = shapeBIsCompound
					? this.resolveByteOffset(shapeBAddr, shapeBDataOffset + pieceBIndex * GEO_OVERLAP2D_SHAPE_DESC_BYTES, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
					: shapeBAddr;
				if (pieceBAddr === null || !this.memory.isReadableMainMemoryRange(pieceBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
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
		const resultCount = job.resultCount;
		if (resultCount >= job.param1) {
			this.writeOverlap2dSummary(job, GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
			this.finishError(GEO_FAULT_RESULT_CAPACITY, recordIndex);
			return false;
		}
		const resultAddr = this.resolveIndexedSpan(job.dst0, resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, GEO_OVERLAP2D_RESULT_BYTES)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return false;
		}
		this.writeOverlap2dResult(resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
		job.resultCount = resultCount + 1;
		return true;
	}

	private processXform2Record(job: GeoJob): void {
		const recordIndex = job.processed;
		const recordAddr = this.resolveIndexedSpan(job.src0, recordIndex, job.stride0, GEO_XFORM2_RECORD_BYTES);
		if (recordAddr === null) {
			this.finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(recordAddr, GEO_XFORM2_RECORD_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const flags = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET);
		const srcIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
		const dstIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
		const auxIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
		const vertexCount = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
		const dst1Index = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
		if (flags !== 0) {
			this.finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
			return;
		}
		if (vertexCount === 0) {
			this.completeRecord(job);
			return;
		}
		const vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
		if (!Number.isSafeInteger(vertexBytes) || vertexBytes > 0xffff_ffff) {
			this.finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
			return;
		}
		const srcAddr = this.resolveIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
		if (srcAddr === null || !this.memory.isReadableMainMemoryRange(srcAddr, vertexBytes)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const matrixAddr = this.resolveIndexedSpan(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES);
		if (matrixAddr === null || !this.memory.isReadableMainMemoryRange(matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const dstAddr = this.resolveIndexedSpan(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes);
		if (dstAddr === null || !this.memory.isRamRange(dstAddr, vertexBytes)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		let aabbAddr = 0;
		if (dst1Index !== GEO_INDEX_NONE) {
			aabbAddr = this.resolveIndexedSpan(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES);
			if (aabbAddr === null || !this.memory.isRamRange(aabbAddr, GEO_XFORM2_AABB_BYTES)) {
				this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
				return;
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
		this.completeRecord(job);
	}

	private processSat2Record(job: GeoJob): void {
		const recordIndex = job.processed;
		const pairAddr = this.resolveIndexedSpan(job.src0, recordIndex, job.stride0, GEO_SAT2_PAIR_BYTES);
		if (pairAddr === null) {
			this.finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(pairAddr, GEO_SAT2_PAIR_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const flags = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET);
		const shapeAIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
		const resultIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
		const shapeBIndex = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
		const pairFlags = this.memory.readU32(pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET);
		if (flags !== 0 || pairFlags !== 0) {
			this.finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
			return;
		}
		const resultAddr = this.resolveIndexedSpan(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES);
		if (resultAddr === null || !this.memory.isRamRange(resultAddr, GEO_SAT2_RESULT_BYTES)) {
			this.finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		const shapeADescAddr = this.resolveIndexedSpan(job.src1, shapeAIndex, job.stride1, GEO_SAT2_DESC_BYTES);
		const shapeBDescAddr = this.resolveIndexedSpan(job.src1, shapeBIndex, job.stride1, GEO_SAT2_DESC_BYTES);
		if (shapeADescAddr === null || shapeBDescAddr === null) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		if (!this.memory.isReadableMainMemoryRange(shapeADescAddr, GEO_SAT2_DESC_BYTES)
			|| !this.memory.isReadableMainMemoryRange(shapeBDescAddr, GEO_SAT2_DESC_BYTES)) {
			this.finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
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
		const shapeAVertexBytes = shapeAVertexCount * GEO_VERTEX2_BYTES;
		const shapeBVertexBytes = shapeBVertexCount * GEO_VERTEX2_BYTES;
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
				this.projectVertexSpanInto(shapeAVertexAddr, shapeAVertexCount, ax, ay, this.overlapProjectionA);
				this.projectVertexSpanInto(shapeBVertexAddr, shapeBVertexCount, ax, ay, this.overlapProjectionB);
				const sepA = this.overlapProjectionA.min - this.overlapProjectionB.max;
				const sepB = this.overlapProjectionB.min - this.overlapProjectionA.max;
				if (sepA > 0 || sepB > 0) {
					this.writeSat2Result(resultAddr, 0, 0, 0, 0, 0);
					this.completeRecord(job);
					return;
				}
				const overlap = Math.min(this.overlapProjectionA.max, this.overlapProjectionB.max) - Math.max(this.overlapProjectionA.min, this.overlapProjectionB.min);
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


	private readPieceBounds(pieceAddr: number, tx: number, ty: number, out: Float64Array): boolean {
		const boundsOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
		const boundsAddr = this.resolveByteOffset(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
		if (boundsAddr === null || !this.memory.isReadableMainMemoryRange(boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
			return false;
		}
		out[0] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET) + tx;
		out[1] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET) + ty;
		out[2] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET) + tx;
		out[3] = this.readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET) + ty;
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
		const primitiveA = this.memory.readU32(pieceAAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
		const primitiveB = this.memory.readU32(pieceBAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
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
		const primitive = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
		const dataCount = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
		const dataOffset = this.memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
		const dataAddr = this.resolveByteOffset(pieceAddr, dataOffset, primitive === GEO_PRIMITIVE_AABB ? GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES : dataCount * GEO_VERTEX2_BYTES);
		if (dataAddr === null) {
			return false;
		}
		out.length = 0;
		if (primitive === GEO_PRIMITIVE_AABB) {
			if (dataCount !== GEO_OVERLAP2D_AABB_DATA_COUNT || !this.memory.isReadableMainMemoryRange(dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
				return false;
			}
			const left = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET);
			const top = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET);
			const right = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET);
			const bottom = this.readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET);
			this.pushWorldVertex(out, tx, ty, left, top);
			this.pushWorldVertex(out, tx, ty, right, top);
			this.pushWorldVertex(out, tx, ty, right, bottom);
			this.pushWorldVertex(out, tx, ty, left, bottom);
			return true;
		}
		if (primitive !== GEO_PRIMITIVE_CONVEX_POLY || dataCount < 3 || !this.memory.isReadableMainMemoryRange(dataAddr, dataCount * GEO_VERTEX2_BYTES)) {
			return false;
		}
		for (let vertexIndex = 0; vertexIndex < dataCount; vertexIndex += 1) {
			const vertexAddr = dataAddr + vertexIndex * GEO_VERTEX2_BYTES;
			this.pushWorldVertex(out, tx, ty, this.readF32(vertexAddr + GEO_VERTEX2_X_OFFSET), this.readF32(vertexAddr + GEO_VERTEX2_Y_OFFSET));
		}
		return true;
	}

	private pushWorldVertex(out: number[], tx: number, ty: number, localX: number, localY: number): void {
		out.push(localX + tx);
		out.push(localY + ty);
	}

	private boundsOverlap(a: Float64Array, b: Float64Array): boolean {
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
				this.projectPolyInto(polyA, ax, ay, this.overlapProjectionA);
				this.projectPolyInto(polyB, ax, ay, this.overlapProjectionB);
				const overlap = Math.min(this.overlapProjectionA.max, this.overlapProjectionB.max) - Math.max(this.overlapProjectionA.min, this.overlapProjectionB.min);
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
		this.computePolyAverageInto(polyA, this.overlapCenterA);
		this.computePolyAverageInto(polyB, this.overlapCenterB);
		if ((((this.overlapCenterA.x - this.overlapCenterB.x) * bestAxisX) + ((this.overlapCenterA.y - this.overlapCenterB.y) * bestAxisY)) < 0) {
			bestAxisX = -bestAxisX;
			bestAxisY = -bestAxisY;
		}
		const intersection = this.clipConvexPolygons(polyA, polyB);
		let pointX;
		let pointY;
		if (intersection.length === 0) {
			pointX = (this.overlapCenterA.x + this.overlapCenterB.x) * 0.5;
			pointY = (this.overlapCenterA.y + this.overlapCenterB.y) * 0.5;
		} else {
			this.computePolyAverageInto(intersection, this.overlapCentroid);
			pointX = this.overlapCentroid.x;
			pointY = this.overlapCentroid.y;
		}
		this.overlapContactNx = bestAxisX;
		this.overlapContactNy = bestAxisY;
		this.overlapContactDepth = bestOverlap;
		this.overlapContactPx = pointX;
		this.overlapContactPy = pointY;
		this.overlapContactFeatureMeta = bestEdgeIndex >>> 0;
		return true;
	}

	private projectVertexSpanInto(base: number, count: number, ax: number, ay: number, out: GeoProjectionScratch): void {
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

	private projectPolyInto(poly: number[], ax: number, ay: number, out: GeoProjectionScratch): void {
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
		out.min = min;
		out.max = max;
	}

	private computePolyAverageInto(poly: number[], out: GeoPointScratch): void {
		let sumX = 0;
		let sumY = 0;
		const count = poly.length >> 1;
		for (let i = 0; i < poly.length; i += 2) {
			sumX += poly[i];
			sumY += poly[i + 1];
		}
		out.x = sumX / count;
		out.y = sumY / count;
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
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET, job.resultCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET, job.exactPairCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET, job.broadphasePairCount >>> 0);
		this.memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET, flags >>> 0);
	}

	private writeOverlap2dResult(addr: number, nx: number, ny: number, depth: number, px: number, py: number, pieceA: number, pieceB: number, featureMeta: number, pairMeta: number): void {
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

	private readF32(addr: number): number {
		return f32BitsToNumber(this.memory.readU32(addr));
	}

	private completeRecord(job: GeoJob): void {
		job.processed += 1;
		this.memory.writeValue(IO_GEO_PROCESSED, job.processed >>> 0);
		if (job.processed >= job.count) {
			this.finishSuccess(job.processed);
		}
	}

	private finishSuccess(processed: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_DONE;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE);
		this.memory.writeValue(IO_GEO_PROCESSED, processed >>> 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		this.irq.raise(IRQ_GEO_DONE);
	}

	private finishError(code: number, recordIndex: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_ERROR;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
		this.memory.writeValue(IO_GEO_FAULT, packFault(code, recordIndex));
		this.irq.raise(IRQ_GEO_ERROR);
	}

	private finishRejected(code: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_REJECTED;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.memory.writeValue(IO_GEO_STATUS, GEO_STATUS_REJECTED);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, packFault(code, GEO_FAULT_RECORD_INDEX_NONE));
		this.irq.raise(IRQ_GEO_ERROR);
	}

	private resolveIndexedSpan(base: number, index: number, stride: number, byteLength: number): number | null {
		const offset = index * stride;
		return this.resolveByteOffset(base, offset, byteLength);
	}

	private writeSat2Result(addr: number, hit: number, nx: number, ny: number, depth: number, meta: number): void {
		this.memory.writeU32(addr + GEO_SAT2_RESULT_HIT_OFFSET, hit >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_NX_OFFSET, nx >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_NY_OFFSET, ny >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_DEPTH_OFFSET, depth >>> 0);
		this.memory.writeU32(addr + GEO_SAT2_RESULT_META_OFFSET, meta >>> 0);
	}
}
