import {
	DMA_CONTROL_BLOCK_WORDS_MASK,
	DMA_CONTROL_BLOCK_WORDS_SHIFT,
	DMA_CONTROL_READ_INCREMENT,
	DMA_CONTROL_REQUEST_APU_READ,
	DMA_CONTROL_REQUEST_APU_WRITE,
	DMA_CONTROL_REQUEST_FORCE,
	DMA_CONTROL_REQUEST_GX_READ,
	DMA_CONTROL_REQUEST_GX_WRITE,
	DMA_CONTROL_REQUEST_MASK,
	DMA_CONTROL_WRITE_INCREMENT,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_DMA_CONTROL,
	IO_DMA_READ_ADDR,
	IO_DMA_STATUS,
	IO_DMA_TRANSFER_COUNT,
	IO_DMA_TRIGGER,
	IO_DMA_WRITE_ADDR,
	IO_APU_TRANSFER_DATA,
	IO_GX_GPU_GP0,
	IRQ_DMA_DONE,
} from '../../bus/io';
import { IO_WORD_SIZE, RAM_BASE } from '../../memory/map';
import { Memory } from '../../memory/memory';
import {
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_BLOCK_END,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import { classifyMemoryRegion, MEMORY_REGION_OTHER, MEMORY_REGION_RAM, type MemoryRegionKind } from '../../memory/region';
import { PSX_DMA_RAM_ROW_WORDS } from '../../model_registry';
import type { CPU, Value } from '../../cpu/cpu';
import type { IrqController } from '../irq/controller';
import { cyclesForBudgetUnitsNoFloor } from '../../scheduler/budget';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
} from '../gx/gpu';

export const DMA_RAM_ROW_NONE = 0xffffffff;

export type DmaControllerState = {
	readAddressWord: number;
	writeAddressWord: number;
	transferCountWord: number;
	controlWord: number;
	statusWord: number;
	timingCarry: number;
	scheduledBlockWords: number;
	scheduledBlockCycles: number;
	supervisorQuiesceRequested: boolean;
	userReadAddressWord: number;
	userWriteAddressWord: number;
	userTransferCountWord: number;
	userControlWord: number;
	userStatusWord: number;
	userTimingCarry: number;
	lastRamRowRead: number;
	lastRamRowWrite: number;
};

export class DmaController {
	private cpuHz = 1;
	private ramWordsPerSec = 1;
	private ramRowReopenCycles = 0;
	private romWaitCyclesPerWord = 0;
	private timingCarry = 0;
	private lastRamRowRead = DMA_RAM_ROW_NONE;
	private lastRamRowWrite = DMA_RAM_ROW_NONE;
	private scheduledBlockWords = 0;
	private serviceDeadline = 0;
	private gxGpuReadReady = false;
	private gxGpuDmaWriteReady = false;
	private gxGpuCpuWriteReady = false;
	private gxGpuDmaDirection = 0;
	private apuDmaReadReady = false;
	private apuDmaWriteReady = false;
	private serviceActive = false;
	private restorePending = false;
	private supervisorQuiesceRequested = false;
	private userReadAddressWord = 0;
	private userWriteAddressWord = 0;
	private userTransferCountWord = 0;
	private userControlWord = 0;
	private userStatusWord = 0;
	private userTimingCarry = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.memory.mapIoWrite(IO_DMA_CONTROL, this, DmaController.controlWriteThunk);
		this.memory.mapIoWrite(IO_DMA_READ_ADDR, this, DmaController.portAddressWriteThunk);
		this.memory.mapIoWrite(IO_DMA_WRITE_ADDR, this, DmaController.portAddressWriteThunk);
		this.memory.mapIoWrite(IO_DMA_TRIGGER, this, DmaController.triggerWriteThunk);
		this.memory.mapIoWriteReady(IO_DMA_TRIGGER, DmaController.triggerWriteReadyThunk);
	}

	private static triggerWriteReadyThunk(context: DmaController): boolean {
		return !context.supervisorQuiesceRequested;
	}

	private static controlWriteThunk(context: DmaController): void {
		context.requestInputChanged();
	}

	private static portAddressWriteThunk(context: DmaController): void {
		context.resumeCpuPortWrites();
	}

	private static triggerWriteThunk(context: DmaController, _addr: number, value: Value): void {
		context.memory.writeIoValue(IO_DMA_TRIGGER, 0);
		if (((value as number) & DMA_TRIGGER_START) === 0 || context.busy()) {
			return;
		}
		context.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		context.scheduledBlockWords = 0;
		context.serviceDeadline = 0;
		context.timingCarry = 0;
		context.memory.writeIoValue(IO_DMA_STATUS, DMA_STATUS_BUSY);
		if (context.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			context.finishTransfer();
			return;
		}
		if (context.requestAsserted()) {
			context.admitBlock(context.scheduler.currentNowCycles());
		}
	}

	public setTiming(cpuHz: number, ramWordsPerSec: number, ramRowReopenCycles: number, romWaitCyclesPerWord: number, nowCycles: number): void {
		if (this.cpuHz === cpuHz
			&& this.ramWordsPerSec === ramWordsPerSec
			&& this.ramRowReopenCycles === ramRowReopenCycles
			&& this.romWaitCyclesPerWord === romWaitCyclesPerWord) {
			return;
		}
		this.cpuHz = cpuHz;
		this.ramWordsPerSec = ramWordsPerSec;
		this.ramRowReopenCycles = ramRowReopenCycles;
		this.romWaitCyclesPerWord = romWaitCyclesPerWord;
		this.timingCarry = 0;
		// Admission latches the current block's completion edge. New timing starts
		// with the next block rather than replaying elapsed bus time.
		if (this.scheduledBlockWords !== 0) {
			return;
		}
		if (this.busy() && this.requestAsserted()) {
			if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
				this.finishTransfer();
			} else {
				this.admitBlock(nowCycles);
			}
		}
	}

	public setGxGpuReadReady(ready: boolean): void {
		if (this.gxGpuReadReady === ready) {
			return;
		}
		this.gxGpuReadReady = ready;
		this.requestInputChanged();
	}

	public setGxGpuDmaWriteReady(ready: boolean): void {
		if (this.gxGpuDmaWriteReady === ready) {
			return;
		}
		this.gxGpuDmaWriteReady = ready;
		this.requestInputChanged();
	}

	public setGxGpuCpuWriteReady(ready: boolean): void {
		if (this.gxGpuCpuWriteReady === ready) {
			return;
		}
		this.gxGpuCpuWriteReady = ready;
		this.resumeCpuPortWrites();
	}

	public setGxGpuDmaDirection(direction: number): void {
		if (this.gxGpuDmaDirection === direction) {
			return;
		}
		this.gxGpuDmaDirection = direction;
		this.requestInputChanged();
	}

	public setApuDmaReadReady(ready: boolean): void {
		if (this.apuDmaReadReady === ready) {
			return;
		}
		this.apuDmaReadReady = ready;
		this.requestInputChanged();
	}

	public setApuDmaWriteReady(ready: boolean): void {
		if (this.apuDmaWriteReady === ready) {
			return;
		}
		this.apuDmaWriteReady = ready;
		this.requestInputChanged();
	}

	public isGxGpuCpuPortWriteReady(): boolean {
		return this.gxGpuCpuWriteReady && !this.ownsGxGpuWritePort();
	}

	public ownsApuDataPort(): boolean {
		return this.busy()
			&& (this.memory.readIoU32(IO_DMA_READ_ADDR) === IO_APU_TRANSFER_DATA
				|| this.memory.readIoU32(IO_DMA_WRITE_ADDR) === IO_APU_TRANSFER_DATA);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.timingCarry = 0;
		this.scheduledBlockWords = 0;
		this.serviceDeadline = 0;
		this.gxGpuReadReady = false;
		this.gxGpuDmaWriteReady = false;
		this.gxGpuCpuWriteReady = false;
		this.gxGpuDmaDirection = 0;
		this.apuDmaReadReady = false;
		this.apuDmaWriteReady = false;
		this.serviceActive = false;
		this.restorePending = false;
		this.supervisorQuiesceRequested = false;
		this.userReadAddressWord = 0;
		this.userWriteAddressWord = 0;
		this.userTransferCountWord = 0;
		this.userControlWord = 0;
		this.userStatusWord = 0;
		this.userTimingCarry = 0;
		this.lastRamRowRead = DMA_RAM_ROW_NONE;
		this.lastRamRowWrite = DMA_RAM_ROW_NONE;
		this.memory.writeIoValue(IO_DMA_READ_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, 0);
		this.memory.writeIoValue(IO_DMA_CONTROL, 0);
		this.memory.writeIoValue(IO_DMA_STATUS, 0);
		this.memory.writeIoValue(IO_DMA_TRIGGER, 0);
	}

	public onService(_nowCycles: number): void {
		const admittedBlockWords = this.scheduledBlockWords;
		const blockDeadline = this.serviceDeadline;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.scheduledBlockWords = 0;
		this.serviceDeadline = 0;
		this.serviceActive = true;
		const remainingAtService = this.memory.readIoU32(IO_DMA_TRANSFER_COUNT);
		const blockWords = admittedBlockWords < remainingAtService ? admittedBlockWords : remainingAtService;
		let slot = 0;
		while (slot < blockWords
			&& this.busy()
			&& this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) !== 0) {
			const transferCount = this.memory.readIoU32(IO_DMA_TRANSFER_COUNT);
			const busSignals: MappedBusSignals = MAPPED_BUS_MASTER_DMA
				| (slot + 1 === blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0);
			this.transferWord(transferCount, busSignals);
			slot += 1;
		}
		this.serviceActive = false;
		if (!this.busy()) {
			this.notifySupervisorBoundary();
			return;
		}
		if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			this.finishTransfer();
			return;
		}
		if (!this.requestAsserted()) {
			if (!this.supervisorQuiesceRequested) {
				this.timingCarry = 0;
			}
			this.notifySupervisorBoundary();
			return;
		}
		this.admitBlock(blockDeadline);
	}

	private transferWord(transferCount: number, busSignals: MappedBusSignals): void {
		const readAddress = this.memory.readIoU32(IO_DMA_READ_ADDR);
		const writeAddress = this.memory.readIoU32(IO_DMA_WRITE_ADDR);
		const control = this.memory.readIoU32(IO_DMA_CONTROL);
		const word = this.memory.readMappedDmaU32LE(readAddress, busSignals);
		this.memory.writeMappedDmaU32LE(writeAddress, word, busSignals);
		this.memory.writeIoValue(
			IO_DMA_READ_ADDR,
			(control & DMA_CONTROL_READ_INCREMENT) !== 0 ? (readAddress + IO_WORD_SIZE) >>> 0 : readAddress,
		);
		this.memory.writeIoValue(
			IO_DMA_WRITE_ADDR,
			(control & DMA_CONTROL_WRITE_INCREMENT) !== 0 ? (writeAddress + IO_WORD_SIZE) >>> 0 : writeAddress,
		);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, (transferCount - 1) >>> 0);
		if (((writeAddress === IO_GX_GPU_GP0 || writeAddress === IO_APU_TRANSFER_DATA)
				&& (control & DMA_CONTROL_WRITE_INCREMENT) !== 0)
			|| (readAddress === IO_APU_TRANSFER_DATA && (control & DMA_CONTROL_READ_INCREMENT) !== 0)) {
			this.resumeCpuPortWrites();
		}
	}

	private finishTransfer(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.scheduledBlockWords = 0;
		this.serviceDeadline = 0;
		this.timingCarry = 0;
		this.memory.writeIoValue(IO_DMA_STATUS, DMA_STATUS_DONE);
		this.irq.raise(IRQ_DMA_DONE);
		this.resumeCpuPortWrites();
		this.notifySupervisorBoundary();
	}

	public captureState(): DmaControllerState {
		return {
			readAddressWord: this.memory.readIoU32(IO_DMA_READ_ADDR),
			writeAddressWord: this.memory.readIoU32(IO_DMA_WRITE_ADDR),
			transferCountWord: this.memory.readIoU32(IO_DMA_TRANSFER_COUNT),
			controlWord: this.memory.readIoU32(IO_DMA_CONTROL),
			statusWord: this.memory.readIoU32(IO_DMA_STATUS),
			timingCarry: this.timingCarry,
			scheduledBlockWords: this.scheduledBlockWords,
			scheduledBlockCycles: this.scheduledBlockWords === 0
				? 0
				: this.serviceDeadline - this.scheduler.currentNowCycles(),
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			userReadAddressWord: this.userReadAddressWord,
			userWriteAddressWord: this.userWriteAddressWord,
			userTransferCountWord: this.userTransferCountWord,
			userControlWord: this.userControlWord,
			userStatusWord: this.userStatusWord,
			userTimingCarry: this.userTimingCarry,
			lastRamRowRead: this.lastRamRowRead,
			lastRamRowWrite: this.lastRamRowWrite,
		};
	}

	public restoreState(state: DmaControllerState, nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.memory.writeIoValue(IO_DMA_READ_ADDR, state.readAddressWord);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, state.writeAddressWord);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, state.transferCountWord);
		this.memory.writeIoValue(IO_DMA_CONTROL, state.controlWord);
		this.memory.writeIoValue(IO_DMA_STATUS, state.statusWord);
		this.memory.writeIoValue(IO_DMA_TRIGGER, 0);
		this.timingCarry = state.timingCarry;
		this.scheduledBlockWords = state.scheduledBlockWords;
		this.serviceDeadline = nowCycles + state.scheduledBlockCycles;
		this.serviceActive = false;
		this.restorePending = true;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.userReadAddressWord = state.userReadAddressWord >>> 0;
		this.userWriteAddressWord = state.userWriteAddressWord >>> 0;
		this.userTransferCountWord = state.userTransferCountWord >>> 0;
		this.userControlWord = state.userControlWord >>> 0;
		this.userStatusWord = state.userStatusWord >>> 0;
		this.userTimingCarry = state.userTimingCarry;
		this.lastRamRowRead = state.lastRamRowRead >>> 0;
		this.lastRamRowWrite = state.lastRamRowWrite >>> 0;
	}

	public postLoad(): void {
		this.restorePending = false;
		if (this.scheduledBlockWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
		}
		this.resumeCpuPortWrites();
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.requestInputChanged();
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		return this.scheduledBlockWords === 0 && !this.serviceActive;
	}

	public hasAdmittedGxGpuWriteBlock(): boolean {
		return this.scheduledBlockWords !== 0 && this.ownsGxGpuWritePort();
	}

	public enterSupervisorContext(): void {
		this.userReadAddressWord = this.memory.readIoU32(IO_DMA_READ_ADDR);
		this.userWriteAddressWord = this.memory.readIoU32(IO_DMA_WRITE_ADDR);
		this.userTransferCountWord = this.memory.readIoU32(IO_DMA_TRANSFER_COUNT);
		this.userControlWord = this.memory.readIoU32(IO_DMA_CONTROL);
		this.userStatusWord = this.memory.readIoU32(IO_DMA_STATUS);
		this.userTimingCarry = this.timingCarry;
		this.clearLiveTransfer();
		this.supervisorQuiesceRequested = false;
	}

	public enterSupervisorFaultContext(): void {
		this.clearLiveTransfer();
		this.userReadAddressWord = 0;
		this.userWriteAddressWord = 0;
		this.userTransferCountWord = 0;
		this.userControlWord = 0;
		this.userStatusWord = 0;
		this.userTimingCarry = 0;
		this.supervisorQuiesceRequested = false;
	}

	public leaveSupervisorContext(): void {
		this.clearLiveTransfer();
		this.memory.writeIoValue(IO_DMA_READ_ADDR, this.userReadAddressWord);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, this.userWriteAddressWord);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, this.userTransferCountWord);
		this.memory.writeIoValue(IO_DMA_CONTROL, this.userControlWord);
		this.memory.writeIoValue(IO_DMA_STATUS, this.userStatusWord);
		this.timingCarry = this.userTimingCarry;
		this.supervisorQuiesceRequested = false;
		this.userReadAddressWord = 0;
		this.userWriteAddressWord = 0;
		this.userTransferCountWord = 0;
		this.userControlWord = 0;
		this.userStatusWord = 0;
		this.userTimingCarry = 0;
		this.requestInputChanged();
	}

	private clearLiveTransfer(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.timingCarry = 0;
		this.scheduledBlockWords = 0;
		this.serviceDeadline = 0;
		this.serviceActive = false;
		this.restorePending = false;
		this.memory.writeIoValue(IO_DMA_READ_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, 0);
		this.memory.writeIoValue(IO_DMA_CONTROL, 0);
		this.memory.writeIoValue(IO_DMA_STATUS, 0);
		this.memory.writeIoValue(IO_DMA_TRIGGER, 0);
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiesceRequested && this.supervisorQuiescent()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	private admitBlock(anchorCycle: number): void {
		const remaining = this.memory.readIoU32(IO_DMA_TRANSFER_COUNT);
		const control = this.memory.readIoU32(IO_DMA_CONTROL);
		const programmedBlockWords = ((control & DMA_CONTROL_BLOCK_WORDS_MASK) >>> DMA_CONTROL_BLOCK_WORDS_SHIFT) + 1;
		this.scheduleAdmittedBlock(anchorCycle, remaining < programmedBlockWords ? remaining : programmedBlockWords);
	}

	private scheduleAdmittedBlock(anchorCycle: number, blockWords: number): void {
		const control = this.memory.readIoU32(IO_DMA_CONTROL);
		const readStep = (control & DMA_CONTROL_READ_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;

		// The RAM rate accrual below must land on the exact same total as one
		// bulk cyclesUntilBudgetUnits(..., N) call would for a side's whole RAM
		// word count -- calling it once per word with targetUnits=1 would pay its
		// "at least one cycle" scheduling floor on every single word instead of
		// once per batch, inflating fast-relative-to-cpuHz rates. carryAtBlockStart
		// and ramUnitsSoFar (shared by both sides, in program order) let each RAM
		// word's cost be recovered as a delta of cumulative cost via
		// cyclesForBudgetUnitsNoFloor, which telescopes back to the bulk total.
		const carryAtBlockStart = this.timingCarry;
		const ramUnitsSoFar = { count: 0 };

		let blockCycles = 0;
		let readAddr = this.memory.readIoU32(IO_DMA_READ_ADDR);
		let writeAddr = this.memory.readIoU32(IO_DMA_WRITE_ADDR);
		for (let word = 0; word < blockWords; word += 1) {
			const readKind = classifyMemoryRegion(readAddr);
			const writeKind = classifyMemoryRegion(writeAddr);
			// Fly-by transfer: read and write share one bus slot, so the slower side
			// gates the word. The one exception is RAM<->RAM: a single-ported RAM
			// chip cannot serve two different addresses in the same cycle, so that
			// combination is the sum of two real bus cycles, not one shared slot.
			const readCost = this.sideWordCycles(readAddr, readKind, true, carryAtBlockStart, ramUnitsSoFar);
			const writeCost = this.sideWordCycles(writeAddr, writeKind, false, carryAtBlockStart, ramUnitsSoFar);
			blockCycles += (readKind === MEMORY_REGION_RAM && writeKind === MEMORY_REGION_RAM)
				? (readCost + writeCost)
				: Math.max(readCost, writeCost);
			readAddr = (readAddr + readStep) >>> 0;
			writeAddr = (writeAddr + writeStep) >>> 0;
		}
		blockCycles = blockCycles <= 0 ? 1 : blockCycles;
		this.timingCarry = (this.ramWordsPerSec * cyclesForBudgetUnitsNoFloor(this.cpuHz, this.ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar.count) + carryAtBlockStart) % this.cpuHz;

		this.scheduledBlockWords = blockWords;
		this.serviceDeadline = anchorCycle + blockCycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
	}

	private ramBaseWordCycles(carryAtBlockStart: number, ramUnitsSoFar: { count: number }): number {
		const prevCumulative = cyclesForBudgetUnitsNoFloor(this.cpuHz, this.ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar.count);
		ramUnitsSoFar.count += 1;
		const cumulative = cyclesForBudgetUnitsNoFloor(this.cpuHz, this.ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar.count);
		return cumulative - prevCumulative;
	}

	private sideWordCycles(address: number, kind: MemoryRegionKind, isReadSide: boolean, carryAtBlockStart: number, ramUnitsSoFar: { count: number }): number {
		if (kind !== MEMORY_REGION_RAM) {
			return kind === MEMORY_REGION_OTHER ? 0 : this.romWaitCyclesPerWord;
		}
		let cycles = this.ramBaseWordCycles(carryAtBlockStart, ramUnitsSoFar);
		const row = Math.floor((address - RAM_BASE) / (PSX_DMA_RAM_ROW_WORDS * IO_WORD_SIZE));
		const lastRow = isReadSide ? this.lastRamRowRead : this.lastRamRowWrite;
		if (row !== lastRow) {
			cycles += this.ramRowReopenCycles;
			if (isReadSide) {
				this.lastRamRowRead = row;
			} else {
				this.lastRamRowWrite = row;
			}
		}
		return cycles;
	}

	private requestInputChanged(): void {
		if (this.restorePending || this.serviceActive || !this.busy()) {
			return;
		}
		if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			this.finishTransfer();
			return;
		}
		if (this.scheduledBlockWords !== 0) {
			return;
		}
		if (!this.requestAsserted()) {
			if (!this.supervisorQuiesceRequested) {
				this.timingCarry = 0;
			}
			this.notifySupervisorBoundary();
			return;
		}
		this.admitBlock(this.scheduler.currentNowCycles());
	}

	private requestAsserted(): boolean {
		const request = this.memory.readIoU32(IO_DMA_CONTROL) & DMA_CONTROL_REQUEST_MASK;
		if (this.supervisorQuiesceRequested
			&& request !== DMA_CONTROL_REQUEST_GX_WRITE
			&& request !== DMA_CONTROL_REQUEST_GX_READ) {
			return false;
		}
		switch (request) {
			case DMA_CONTROL_REQUEST_FORCE:
				return true;
			case DMA_CONTROL_REQUEST_GX_WRITE:
				return (this.gxGpuDmaDirection === GX_GPU_DMA_DIRECTION_CPU_TO_GP0
					|| this.gxGpuDmaDirection === GX_GPU_DMA_DIRECTION_FIFO)
					&& this.gxGpuDmaWriteReady;
			case DMA_CONTROL_REQUEST_GX_READ:
				return this.gxGpuDmaDirection === GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU && this.gxGpuReadReady;
			case DMA_CONTROL_REQUEST_APU_WRITE:
				return this.apuDmaWriteReady;
			case DMA_CONTROL_REQUEST_APU_READ:
				return this.apuDmaReadReady;
			default:
				return false;
		}
	}

	private busy(): boolean {
		return (this.memory.readIoU32(IO_DMA_STATUS) & DMA_STATUS_BUSY) !== 0;
	}

	private ownsGxGpuWritePort(): boolean {
		return this.busy() && this.memory.readIoU32(IO_DMA_WRITE_ADDR) === IO_GX_GPU_GP0;
	}

	private resumeCpuPortWrites(): void {
		if (this.gxGpuCpuWriteReady && !this.ownsGxGpuWritePort()) {
			this.cpu.resumeMemoryWrite(IO_GX_GPU_GP0);
		}
		if (!this.ownsApuDataPort()) {
			this.cpu.resumeMemoryWrite(IO_APU_TRANSFER_DATA);
		}
	}
}
