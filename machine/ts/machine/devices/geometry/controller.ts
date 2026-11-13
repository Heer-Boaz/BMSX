import {
	IO_GEO_BASE,
	DMA_BURST_WORD_CAPACITY,
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
} from '../../../spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import {
	GEO_CTRL_ABORT,
	GEO_OVERLAP2D_INSTANCE_WORDS,
	GEO_OVERLAP2D_SHAPE_DESC_BYTES,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES,
	GEO_FAULT_ABORTED,
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
import { GeometryOverlap2dPhase, GeometryOverlap2dUnit } from './overlap2d';
import { PSX_DMA_RAM_CYCLES_PER_WORD, PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD, PSX_DMA_CART_ROM_CYCLES_PER_WORD } from '../../../spec/bmsx/model';
import { GeometrySat2Unit } from './sat2';
import { GeometryXform2Unit } from './xform2';
import type { GeometryJobState } from './job';
import type { GeometryControllerState } from './save_state';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_GEO, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';

const GEO_SERVICE_BATCH_RECORDS = 1;
const GEO_OVERLAP_PAIR_HEADER_WORDS = GEO_OVERLAP2D_INSTANCE_WORDS
	+ 2 * (GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES) / IO_WORD_SIZE;
const GEO_REGISTER_SRC0 = (IO_GEO_SRC0 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_SRC1 = (IO_GEO_SRC1 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_SRC2 = (IO_GEO_SRC2 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_DST0 = (IO_GEO_DST0 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_DST1 = (IO_GEO_DST1 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_COUNT = (IO_GEO_COUNT - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_CMD = (IO_GEO_CMD - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_CTRL = (IO_GEO_CTRL - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_STATUS = (IO_GEO_STATUS - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_PARAM0 = (IO_GEO_PARAM0 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_PARAM1 = (IO_GEO_PARAM1 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_STRIDE0 = (IO_GEO_STRIDE0 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_STRIDE1 = (IO_GEO_STRIDE1 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_STRIDE2 = (IO_GEO_STRIDE2 - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_PROCESSED = (IO_GEO_PROCESSED - IO_GEO_BASE) / IO_WORD_SIZE;
const GEO_REGISTER_FAULT = (IO_GEO_FAULT - IO_GEO_BASE) / IO_WORD_SIZE;

function packFault(code: number, recordIndex: number): number {
	return (((code & GEO_FAULT_CODE_MASK) << GEO_FAULT_CODE_SHIFT) | (recordIndex & GEO_FAULT_RECORD_INDEX_MASK)) >>> 0;
}


export class GeometryController {
	private readonly registerWords = new Uint32Array(GEOMETRY_CONTROLLER_REGISTER_COUNT);
	private phase: GeometryControllerPhase = GEOMETRY_CONTROLLER_PHASE_IDLE;
	private activeJob: GeometryJobState | null = null;
	private cpuHz = 1;
	private workUnitsPerSec = 1;
	private workCarry = 0;
	private availableWorkUnits = 0;
	private pendingCycles = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly xform2: GeometryXform2Unit;
	private readonly sat2: GeometrySat2Unit;
	private readonly overlap2d: GeometryOverlap2dUnit;
	private supervisorQuiesceRequested = false;

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.xform2 = new GeometryXform2Unit(memory);
		this.sat2 = new GeometrySat2Unit(memory);
		this.overlap2d = new GeometryOverlap2dUnit(memory);
		for (let address = IO_GEO_SRC0; address <= IO_GEO_COUNT; address += IO_WORD_SIZE) {
			this.memory.mapIoWrite(address, this, GeometryController.onConfigWrite);
		}
		for (let address = IO_GEO_PARAM0; address <= IO_GEO_STRIDE2; address += IO_WORD_SIZE) {
			this.memory.mapIoWrite(address, this, GeometryController.onConfigWrite);
		}
		this.memory.mapIoWrite(IO_GEO_CMD, this, GeometryController.onCommandWrite);
		this.memory.mapIoWriteReady(IO_GEO_CMD, GeometryController.commandWriteReady);
		this.memory.mapIoWrite(IO_GEO_CTRL, this, GeometryController.onCtrlRegisterWrite);
		this.memory.mapIoWrite(IO_GEO_FAULT_ACK, this, GeometryController.onFaultAckWrite);
	}

	private static commandWriteReady(context: GeometryController): boolean {
		return !context.supervisorQuiesceRequested;
	}

	private static onConfigWrite(context: GeometryController, address: number, value: number): void {
		context.registerWords[(address - IO_GEO_BASE) / IO_WORD_SIZE] = value;
	}

	private static onCommandWrite(context: GeometryController, _addr: number, value: number): void {
		context.registerWords[GEO_REGISTER_CMD] = value;
		context.onCommandDoorbell(context.scheduler.currentNowCycles(), value);
	}

	private static onCtrlRegisterWrite(context: GeometryController, _address: number, value: number): void {
		context.registerWords[GEO_REGISTER_CTRL] = value;
		context.onCtrlWrite();
	}

	private static onFaultAckWrite(context: GeometryController, _addr: number, value: number): void {
		if (value === 0) {
			return;
		}
		const status = context.registerWords[GEO_REGISTER_STATUS]!
			& ~(GEO_STATUS_ERROR | GEO_STATUS_REJECTED);
		context.registerWords[GEO_REGISTER_STATUS] = status;
		context.registerWords[GEO_REGISTER_FAULT] = 0;
		context.memory.writeIoU32(IO_GEO_STATUS, status);
		context.memory.writeIoU32(IO_GEO_FAULT, 0);
		context.memory.writeIoU32(IO_GEO_FAULT_ACK, 0);
		if (context.phase === GEOMETRY_CONTROLLER_PHASE_ERROR) {
			context.phase = GEOMETRY_CONTROLLER_PHASE_DONE;
		} else if (context.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED) {
			context.phase = GEOMETRY_CONTROLLER_PHASE_IDLE;
		}
	}

	public setTiming(cpuHz: number, workUnitsPerSec: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		this.workUnitsPerSec = workUnitsPerSec;
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.workCarry = 0;
			this.availableWorkUnits = 0;
			this.pendingCycles = 0;
		}
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY || cycles <= 0) {
			return;
		}
		const job = this.activeJob!;
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			this.pendingCycles = cycles >= this.pendingCycles ? 0 : this.pendingCycles - cycles;
			this.scheduleNextService(nowCycles);
			return;
		}
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
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY && this.activeJob!.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			this.serviceOverlap(nowCycles);
			return;
		}
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
				default:
					this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
					return;
			}
			remaining -= 1;
		}
		this.availableWorkUnits = this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY ? remaining : 0;
		this.scheduleNextService(nowCycles);
	}

	private serviceOverlap(nowCycles: number): void {
		const job = this.activeJob!;
		while (this.pendingCycles === 0) {
			const initialPhase = this.overlap2d.readProgress().phase;
			const readingHeaders = initialPhase === GeometryOverlap2dPhase.Record || initialPhase === GeometryOverlap2dPhase.Pair
				|| initialPhase === GeometryOverlap2dPhase.Initialized;
			let groupWords = 0;
			do {
				const publishing = this.overlap2d.readProgress().phase === GeometryOverlap2dPhase.Publish;
				const fault = this.overlap2d.processStep(job);
				if (fault !== 0) {
					this.finishError(fault, job.processed);
					return;
				}
				if (publishing) {
					if (this.overlap2d.readProgress().phase === GeometryOverlap2dPhase.Initialized && job.count === 0) {
						this.finishSuccess(0);
						return;
					}
					if (this.overlap2d.readProgress().phase === GeometryOverlap2dPhase.Record) {
						this.completeRecord(job);
						if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) return;
					}
					break;
				}
				const progress = this.overlap2d.readProgress();
				const memory = progress.pendingMemory, work = progress.pendingWork;
				groupWords += memory.ramWords + memory.systemRomWords + memory.cartridgeWords + memory.otherWords;
				this.pendingCycles += memory.ramWords * PSX_DMA_RAM_CYCLES_PER_WORD
					+ memory.systemRomWords * PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD
					+ memory.cartridgeWords * PSX_DMA_CART_ROM_CYCLES_PER_WORD + memory.otherWords;
				const units = work.axes + work.projectionVertices + work.averageVertices + work.clipVertices
					+ work.clipEdges + work.squareRoots + work.divisions;
				if (units !== 0) {
					const cycles = cyclesUntilBudgetUnits(this.cpuHz, this.workUnitsPerSec, this.workCarry, units);
					this.workCarry += cycles * this.workUnitsPerSec - units * this.cpuHz;
					this.pendingCycles += cycles;
				}
			} while (readingHeaders && this.overlap2d.readProgress().phase === GeometryOverlap2dPhase.Pair
				&& groupWords + GEO_OVERLAP_PAIR_HEADER_WORDS <= DMA_BURST_WORD_CAPACITY);
		}
		this.scheduleNextService(nowCycles);
	}

	public reset(): void {
		this.overlap2d.reset();
		this.phase = GEOMETRY_CONTROLLER_PHASE_IDLE;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.pendingCycles = 0;
		this.activeJob = null;
		this.supervisorQuiesceRequested = false;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.registerWords.fill(0);
		this.mirrorRegisters();
		this.memory.writeIoU32(IO_GEO_FAULT_ACK, 0);
	}

	public captureState(): GeometryControllerState {
		const registerWords = new Array<number>(GEOMETRY_CONTROLLER_REGISTER_COUNT);
		for (let index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.registerWords[index]!;
		}
		return {
			phase: this.phase,
			registerWords,
			activeJob: this.activeJob === null ? null : { ...this.activeJob },
			overlap: this.overlap2d.captureState(),
			workCarry: this.workCarry,
			availableWorkUnits: this.availableWorkUnits,
			pendingCycles: this.pendingCycles,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
		};
	}

	public restoreState(state: GeometryControllerState, nowCycles: number): void {
		for (let index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1) {
			this.registerWords[index] = state.registerWords[index]!;
		}
		this.registerWords[GEO_REGISTER_CTRL] = this.registerWords[GEO_REGISTER_CTRL]! & ~GEO_CTRL_ABORT;
		this.mirrorRegisters();
		this.phase = state.phase;
		this.activeJob = state.activeJob === null ? null : { ...state.activeJob };
		this.overlap2d.restoreState(state.overlap);
		this.workCarry = state.workCarry;
		this.availableWorkUnits = state.availableWorkUnits;
		this.pendingCycles = state.pendingCycles;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.scheduleNextService(nowCycles);
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		return this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY;
	}

	public leaveSupervisorContext(): void {
		this.supervisorQuiesceRequested = false;
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiesceRequested) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	private onCtrlWrite(): void {
		const ctrl = this.registerWords[GEO_REGISTER_CTRL]!;
		const abort = (ctrl & GEO_CTRL_ABORT) !== 0;
		if (!abort) {
			return;
		}
		this.registerWords[GEO_REGISTER_CTRL] = ctrl & ~GEO_CTRL_ABORT;
		this.memory.writeIoU32(IO_GEO_CTRL, this.registerWords[GEO_REGISTER_CTRL]!);
		if (
			this.phase === GEOMETRY_CONTROLLER_PHASE_ERROR ||
			this.phase === GEOMETRY_CONTROLLER_PHASE_REJECTED
		) {
			return;
		}
		if (this.phase === GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.finishError(GEO_FAULT_ABORTED, this.activeJob!.processed);
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
		this.start(nowCycles, command);
	}

	private start(nowCycles: number, command: number): void {
		const job: GeometryJobState = {
			cmd: command,
			src0: this.registerWords[GEO_REGISTER_SRC0]!,
			src1: this.registerWords[GEO_REGISTER_SRC1]!,
			src2: this.registerWords[GEO_REGISTER_SRC2]!,
			dst0: this.registerWords[GEO_REGISTER_DST0]!,
			dst1: this.registerWords[GEO_REGISTER_DST1]!,
			count: this.registerWords[GEO_REGISTER_COUNT]!,
			param0: this.registerWords[GEO_REGISTER_PARAM0]!,
			param1: this.registerWords[GEO_REGISTER_PARAM1]!,
			stride0: this.registerWords[GEO_REGISTER_STRIDE0]!,
			stride1: this.registerWords[GEO_REGISTER_STRIDE1]!,
			stride2: this.registerWords[GEO_REGISTER_STRIDE2]!,
			processed: 0,
			resultCount: 0,
			exactPairCount: 0,
			broadphasePairCount: 0,
		};
		switch (job.cmd) {
			case IO_CMD_GEO_XFORM2_BATCH:
			case IO_CMD_GEO_SAT2_BATCH:
			case IO_CMD_GEO_OVERLAP2D_PASS:
				break;
			default:
				this.finishRejected(GEO_FAULT_REJECT_BAD_CMD);
				return;
		}
		this.latchResultRegisters(0, 0, 0);
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) this.overlap2d.beginJob(job);
		if (job.count === 0 && job.cmd !== IO_CMD_GEO_OVERLAP2D_PASS) {
			this.finishSuccess(0);
			return;
		}
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.pendingCycles = 0;
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			const memory = this.overlap2d.readProgress().pendingMemory;
			this.pendingCycles = memory.ramWords * PSX_DMA_RAM_CYCLES_PER_WORD
				+ memory.systemRomWords * PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD
				+ memory.cartridgeWords * PSX_DMA_CART_ROM_CYCLES_PER_WORD + memory.otherWords;
		}
		this.activeJob = job;
		this.phase = GEOMETRY_CONTROLLER_PHASE_BUSY;
		this.registerWords[GEO_REGISTER_STATUS] = GEO_STATUS_BUSY;
		this.memory.writeIoU32(IO_GEO_STATUS, this.registerWords[GEO_REGISTER_STATUS]!);
		this.scheduleNextService(nowCycles);
	}

	private scheduleNextService(nowCycles: number): void {
		if (this.phase !== GEOMETRY_CONTROLLER_PHASE_BUSY) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
			return;
		}
		const job = this.activeJob!;
		if (job.cmd === IO_CMD_GEO_OVERLAP2D_PASS) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, nowCycles + this.pendingCycles);
			return;
		}
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
		this.registerWords[GEO_REGISTER_PROCESSED] = job.processed;
		this.memory.writeIoU32(IO_GEO_PROCESSED, this.registerWords[GEO_REGISTER_PROCESSED]!);
		if (job.processed >= job.count) {
			this.finishSuccess(job.processed);
		}
	}

	private finishSuccess(processed: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_DONE;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.pendingCycles = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.latchResultRegisters(GEO_STATUS_DONE, processed, 0);
		this.irq.raise(IRQ_GEO_DONE);
		this.notifySupervisorBoundary();
	}

	private finishError(code: number, recordIndex: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_ERROR;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.pendingCycles = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.registerWords[GEO_REGISTER_STATUS] = GEO_STATUS_DONE | GEO_STATUS_ERROR;
		this.registerWords[GEO_REGISTER_FAULT] = packFault(code, recordIndex);
		this.memory.writeIoU32(IO_GEO_STATUS, this.registerWords[GEO_REGISTER_STATUS]!);
		this.memory.writeIoU32(IO_GEO_FAULT, this.registerWords[GEO_REGISTER_FAULT]!);
		this.irq.raise(IRQ_GEO_ERROR);
		this.notifySupervisorBoundary();
	}

	private finishRejected(code: number): void {
		this.phase = GEOMETRY_CONTROLLER_PHASE_REJECTED;
		this.activeJob = null;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.pendingCycles = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		this.latchResultRegisters(
			GEO_STATUS_REJECTED,
			0,
			packFault(code, GEO_FAULT_RECORD_INDEX_NONE),
		);
		this.irq.raise(IRQ_GEO_ERROR);
		this.notifySupervisorBoundary();
	}

	private latchResultRegisters(status: number, processed: number, fault: number): void {
		this.registerWords[GEO_REGISTER_STATUS] = status;
		this.registerWords[GEO_REGISTER_PROCESSED] = processed;
		this.registerWords[GEO_REGISTER_FAULT] = fault;
		this.memory.writeIoU32(IO_GEO_STATUS, this.registerWords[GEO_REGISTER_STATUS]!);
		this.memory.writeIoU32(IO_GEO_PROCESSED, this.registerWords[GEO_REGISTER_PROCESSED]!);
		this.memory.writeIoU32(IO_GEO_FAULT, this.registerWords[GEO_REGISTER_FAULT]!);
	}

	private mirrorRegisters(): void {
		for (let index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoU32(IO_GEO_REGISTER_ADDRS[index]!, this.registerWords[index]!);
		}
	}
}
