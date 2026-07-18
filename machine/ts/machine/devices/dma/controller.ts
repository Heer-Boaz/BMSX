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
import { IO_WORD_SIZE } from '../../memory/map';
import { Memory } from '../../memory/memory';
import {
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_BLOCK_END,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { CPU, Value } from '../../cpu/cpu';
import type { IrqController } from '../irq/controller';
import { cyclesUntilBudgetUnits } from '../../scheduler/budget';
import { DEVICE_SERVICE_DMA, type DeviceScheduler } from '../../scheduler/device';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
} from '../gx/gpu';

export type DmaControllerState = {
	readAddressWord: number;
	writeAddressWord: number;
	transferCountWord: number;
	controlWord: number;
	statusWord: number;
	timingCarry: number;
	scheduledBlockWords: number;
	scheduledBlockCycles: number;
};

export class DmaController {
	private cpuHz = 1;
	private wordsPerSec = 1;
	private timingCarry = 0;
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

	public setTiming(cpuHz: number, wordsPerSec: number, nowCycles: number): void {
		if (this.cpuHz === cpuHz && this.wordsPerSec === wordsPerSec) {
			return;
		}
		this.cpuHz = cpuHz;
		this.wordsPerSec = wordsPerSec;
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
			return;
		}
		if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			this.finishTransfer();
			return;
		}
		if (!this.requestAsserted()) {
			this.timingCarry = 0;
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
	}

	public postLoad(): void {
		this.restorePending = false;
		if (this.scheduledBlockWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
		}
		this.resumeCpuPortWrites();
	}

	private admitBlock(anchorCycle: number): void {
		const remaining = this.memory.readIoU32(IO_DMA_TRANSFER_COUNT);
		const control = this.memory.readIoU32(IO_DMA_CONTROL);
		const programmedBlockWords = ((control & DMA_CONTROL_BLOCK_WORDS_MASK) >>> DMA_CONTROL_BLOCK_WORDS_SHIFT) + 1;
		this.scheduleAdmittedBlock(anchorCycle, remaining < programmedBlockWords ? remaining : programmedBlockWords);
	}

	private scheduleAdmittedBlock(anchorCycle: number, blockWords: number): void {
		const blockCycles = cyclesUntilBudgetUnits(this.cpuHz, this.wordsPerSec, this.timingCarry, blockWords);
		this.timingCarry = (this.wordsPerSec * blockCycles + this.timingCarry) % this.cpuHz;
		this.scheduledBlockWords = blockWords;
		this.serviceDeadline = anchorCycle + blockCycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
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
			this.timingCarry = 0;
			return;
		}
		this.admitBlock(this.scheduler.currentNowCycles());
	}

	private requestAsserted(): boolean {
		switch (this.memory.readIoU32(IO_DMA_CONTROL) & DMA_CONTROL_REQUEST_MASK) {
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
