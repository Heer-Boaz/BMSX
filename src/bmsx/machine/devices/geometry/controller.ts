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
	GEO_FAULT_ABORTED_BY_HOST,
	GEO_FAULT_CODE_MASK,
	GEO_FAULT_CODE_SHIFT,
	GEO_FAULT_RECORD_INDEX_MASK,
	GEO_FAULT_RECORD_INDEX_NONE,
	GEO_FAULT_REJECT_BAD_CMD,
	GEO_FAULT_REJECT_BUSY,
	GEOMETRY_CONTROLLER_PHASE_BUSY,
	GEOMETRY_CONTROLLER_PHASE_DONE,
	GEOMETRY_CONTROLLER_PHASE_ERROR,
	GEOMETRY_CONTROLLER_PHASE_IDLE,
	GEOMETRY_CONTROLLER_PHASE_REJECTED,
	GEOMETRY_CONTROLLER_REGISTER_COUNT,
	type GeometryControllerPhase,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
} from './contracts';
import { GeometryOverlap2dUnit } from './overlap2d';
import { GeometrySat2Unit } from './sat2';
import { GeometryXform2Unit } from './xform2';
import type { GeometryControllerState, GeometryJobState } from './state';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_GEO, type DeviceScheduler } from '../../scheduler/device';

const GEO_SERVICE_BATCH_RECORDS = 1;

function packFault(code: number, recordIndex: number): number {
	return (((code & GEO_FAULT_CODE_MASK) << GEO_FAULT_CODE_SHIFT) | (recordIndex & GEO_FAULT_RECORD_INDEX_MASK)) >>> 0;
}


export class GeometryController {
	private phase: GeometryControllerPhase = GEOMETRY_CONTROLLER_PHASE_IDLE;
	private activeJob: GeometryJobState | null = null;
	private cpuHz = 1;
	private workUnitsPerSec = 1;
	private workCarry = 0;
	private availableWorkUnits = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly xform2: GeometryXform2Unit;
	private readonly sat2: GeometrySat2Unit;
	private readonly overlap2d: GeometryOverlap2dUnit;

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.xform2 = new GeometryXform2Unit(memory);
		this.sat2 = new GeometrySat2Unit(memory);
		this.overlap2d = new GeometryOverlap2dUnit(memory);
		this.memory.mapIoWrite(IO_GEO_CMD, this.onCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_GEO_CTRL, this.onCtrlRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_GEO_FAULT_ACK, this.onFaultAckWrite.bind(this));
	}

	private onCommandWrite(_addr: number, value: Value): void {
		this.onCommandDoorbell(this.scheduler.currentNowCycles(), (value as number) >>> 0);
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
				case IO_CMD_GEO_XFORM2_BATCH: {
					const fault = this.xform2.processRecord(job);
					if (fault !== 0) {
						this.finishError(fault, job.processed);
					} else {
						this.completeRecord(job);
					}
					break;
				}
				case IO_CMD_GEO_SAT2_BATCH: {
					const fault = this.sat2.processRecord(job);
					if (fault !== 0) {
						this.finishError(fault, job.processed);
					} else {
						this.completeRecord(job);
					}
					break;
				}
				case IO_CMD_GEO_OVERLAP2D_PASS: {
					const fault = this.overlap2d.processRecord(job);
					if (fault !== 0) {
						this.finishError(fault, job.processed);
					} else {
						this.completeRecord(job);
					}
					break;
				}
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
		this.memory.writeIoValue(IO_GEO_CMD, 0);
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
		this.memory.writeIoValue(IO_GEO_CTRL, this.memory.readIoU32(IO_GEO_CTRL) & ~GEO_CTRL_ABORT);
		this.scheduleNextService(nowCycles);
	}

	public onCtrlWrite(_nowCycles: number): void {
		const ctrl = this.memory.readIoU32(IO_GEO_CTRL);
		const abort = (ctrl & GEO_CTRL_ABORT) !== 0;
		if (!abort) {
			return;
		}
		this.memory.writeIoValue(IO_GEO_CTRL, ctrl & ~GEO_CTRL_ABORT);
		if (
			this.phase === GEOMETRY_CONTROLLER_PHASE_ERROR ||
			this.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED
		) {
			return;
		}
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.finishError(GEO_FAULT_ABORTED_BY_HOST, this.activeJob!.processed);
		}
	}

	private onCommandDoorbell(nowCycles: number, command: number): void {
		if (
			this.phase === GEOMETRY_CONTROLLER_PHASE_ERROR ||
			this.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED
		) {
			return;
		}
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.finishRejected(GEO_FAULT_REJECT_BUSY);
			return;
		}
		this.tryStart(nowCycles, command);
	}

	private tryStart(nowCycles: number, command: number): void {
		const job: GeometryJobState = {
			cmd: command,
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
			case IO_CMD_GEO_XFORM2_BATCH: {
				const rejectFault = this.xform2.validateSubmission(job);
				if (rejectFault !== 0) {
					this.finishRejected(rejectFault);
					return;
				}
				break;
			}
			case IO_CMD_GEO_SAT2_BATCH: {
				const rejectFault = this.sat2.validateSubmission(job);
				if (rejectFault !== 0) {
					this.finishRejected(rejectFault);
					return;
				}
				break;
			}
			case IO_CMD_GEO_OVERLAP2D_PASS: {
				const rejectFault = this.overlap2d.validateSubmission(job);
				if (rejectFault !== 0) {
					this.finishRejected(rejectFault);
					return;
				}
				break;
			}
			default:
				this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
				return;
		}
		this.memory.writeValue(IO_GEO_STATUS, 0);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			this.overlap2d.writeSummary(job, 0);
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

	private completeRecord(job: GeometryJobState): void {
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
}
