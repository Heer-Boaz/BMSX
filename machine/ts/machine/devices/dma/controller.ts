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
import { Memory, MemoryRegionKind } from '../../memory/memory';
import {
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_BLOCK_END,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { CPU, Value } from '../../cpu/cpu';
import type { IrqController } from '../irq/controller';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
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
	scheduledBlockWords: number;
	scheduledBlockCycles: number;
	scheduledReadAddressWord: number;
	scheduledWriteAddressWord: number;
	scheduledTransferCountWord: number;
	scheduledControlWord: number;
	supervisorQuiesceRequested: boolean;
	userReadAddressWord: number;
	userWriteAddressWord: number;
	userTransferCountWord: number;
	userControlWord: number;
	userStatusWord: number;
};

export class DmaController {
	private ramCyclesPerWord = 1;
	private ramBurstSetupCycles = 0;
	private systemRomCyclesPerWord = 1;
	private cartRomCyclesPerWord = 0;
	private scheduledBlockWords = 0;
	private scheduledReadAddressWord = 0;
	private scheduledWriteAddressWord = 0;
	private scheduledTransferCountWord = 0;
	private scheduledControlWord = 0;
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
		context.clearAdmittedBlock();
		context.memory.writeIoValue(IO_DMA_STATUS, DMA_STATUS_BUSY);
		if (context.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			context.finishTransfer();
			return;
		}
		if (context.requestAsserted()) {
			context.admitBlock(context.scheduler.currentNowCycles());
		}
	}

	public setTiming(ramCyclesPerWord: number, ramBurstSetupCycles: number, systemRomCyclesPerWord: number, cartRomCyclesPerWord: number, nowCycles: number): void {
		if (this.ramCyclesPerWord === ramCyclesPerWord
			&& this.ramBurstSetupCycles === ramBurstSetupCycles
			&& this.systemRomCyclesPerWord === systemRomCyclesPerWord
			&& this.cartRomCyclesPerWord === cartRomCyclesPerWord) {
			return;
		}
		this.ramCyclesPerWord = ramCyclesPerWord;
		this.ramBurstSetupCycles = ramBurstSetupCycles;
		this.systemRomCyclesPerWord = systemRomCyclesPerWord;
		this.cartRomCyclesPerWord = cartRomCyclesPerWord;
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
		if (this.scheduledBlockWords !== 0) {
			return this.scheduledReadAddressWord === IO_APU_TRANSFER_DATA
				|| this.scheduledWriteAddressWord === IO_APU_TRANSFER_DATA;
		}
		return this.busy()
			&& (this.memory.readIoU32(IO_DMA_READ_ADDR) === IO_APU_TRANSFER_DATA
				|| this.memory.readIoU32(IO_DMA_WRITE_ADDR) === IO_APU_TRANSFER_DATA);
	}

	public reset(): void {
		this.clearLiveTransfer();
		this.gxGpuReadReady = false;
		this.gxGpuDmaWriteReady = false;
		this.gxGpuCpuWriteReady = false;
		this.gxGpuDmaDirection = 0;
		this.apuDmaReadReady = false;
		this.apuDmaWriteReady = false;
		this.supervisorQuiesceRequested = false;
		this.userReadAddressWord = 0;
		this.userWriteAddressWord = 0;
		this.userTransferCountWord = 0;
		this.userControlWord = 0;
		this.userStatusWord = 0;
	}

	public onService(_nowCycles: number): void {
		const blockWords = this.scheduledBlockWords;
		let readAddress = this.scheduledReadAddressWord;
		let writeAddress = this.scheduledWriteAddressWord;
		let transferCount = this.scheduledTransferCountWord;
		const control = this.scheduledControlWord;
		const readStep = (control & DMA_CONTROL_READ_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) !== 0 ? IO_WORD_SIZE : 0;
		const blockDeadline = this.serviceDeadline;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.serviceActive = true;
		for (let slot = 0; slot < blockWords; slot += 1) {
			const busSignals: MappedBusSignals = MAPPED_BUS_MASTER_DMA
				| (slot + 1 === blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0);
			const nextReadAddress = (readAddress + readStep) >>> 0;
			const nextWriteAddress = (writeAddress + writeStep) >>> 0;
			const nextTransferCount = (transferCount - 1) >>> 0;
			const word = this.memory.readMappedDmaU32LE(readAddress, busSignals);
			this.memory.writeMappedDmaU32LE(writeAddress, word, busSignals);
			this.memory.writeIoValue(IO_DMA_READ_ADDR, nextReadAddress);
			this.memory.writeIoValue(IO_DMA_WRITE_ADDR, nextWriteAddress);
			this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, nextTransferCount);
			const writePortAdvanced = writeStep !== 0
				&& (writeAddress === IO_GX_GPU_GP0 || writeAddress === IO_APU_TRANSFER_DATA);
			const readPortAdvanced = readStep !== 0 && readAddress === IO_APU_TRANSFER_DATA;
			if (writePortAdvanced) {
				this.scheduledWriteAddressWord = nextWriteAddress;
			}
			if (readPortAdvanced) {
				this.scheduledReadAddressWord = nextReadAddress;
			}
			if (writePortAdvanced || readPortAdvanced) {
				this.resumeCpuPortWrites();
			}
			readAddress = nextReadAddress;
			writeAddress = nextWriteAddress;
			transferCount = nextTransferCount;
		}
		this.serviceActive = false;
		this.clearAdmittedBlock();
		if (transferCount === 0) {
			this.finishTransfer();
			return;
		}
		if (!this.requestAsserted()) {
			this.notifySupervisorBoundary();
			return;
		}
		this.admitBlock(blockDeadline);
	}

	private finishTransfer(): void {
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
			scheduledBlockWords: this.scheduledBlockWords,
			scheduledBlockCycles: this.scheduledBlockWords === 0
				? 0
				: this.serviceDeadline - this.scheduler.currentNowCycles(),
			scheduledReadAddressWord: this.scheduledReadAddressWord,
			scheduledWriteAddressWord: this.scheduledWriteAddressWord,
			scheduledTransferCountWord: this.scheduledTransferCountWord,
			scheduledControlWord: this.scheduledControlWord,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			userReadAddressWord: this.userReadAddressWord,
			userWriteAddressWord: this.userWriteAddressWord,
			userTransferCountWord: this.userTransferCountWord,
			userControlWord: this.userControlWord,
			userStatusWord: this.userStatusWord,
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
		this.scheduledBlockWords = state.scheduledBlockWords;
		this.scheduledReadAddressWord = state.scheduledReadAddressWord >>> 0;
		this.scheduledWriteAddressWord = state.scheduledWriteAddressWord >>> 0;
		this.scheduledTransferCountWord = state.scheduledTransferCountWord >>> 0;
		this.scheduledControlWord = state.scheduledControlWord >>> 0;
		this.serviceDeadline = nowCycles + state.scheduledBlockCycles;
		this.serviceActive = false;
		this.restorePending = true;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.userReadAddressWord = state.userReadAddressWord >>> 0;
		this.userWriteAddressWord = state.userWriteAddressWord >>> 0;
		this.userTransferCountWord = state.userTransferCountWord >>> 0;
		this.userControlWord = state.userControlWord >>> 0;
		this.userStatusWord = state.userStatusWord >>> 0;
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
		this.supervisorQuiesceRequested = false;
	}

	public leaveSupervisorContext(): void {
		this.clearLiveTransfer();
		this.memory.writeIoValue(IO_DMA_READ_ADDR, this.userReadAddressWord);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, this.userWriteAddressWord);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, this.userTransferCountWord);
		this.memory.writeIoValue(IO_DMA_CONTROL, this.userControlWord);
		this.memory.writeIoValue(IO_DMA_STATUS, this.userStatusWord);
		this.supervisorQuiesceRequested = false;
		this.userReadAddressWord = 0;
		this.userWriteAddressWord = 0;
		this.userTransferCountWord = 0;
		this.userControlWord = 0;
		this.userStatusWord = 0;
		this.requestInputChanged();
	}

	private clearLiveTransfer(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.clearAdmittedBlock();
		this.serviceActive = false;
		this.restorePending = false;
		this.memory.writeIoValue(IO_DMA_READ_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_WRITE_ADDR, 0);
		this.memory.writeIoValue(IO_DMA_TRANSFER_COUNT, 0);
		this.memory.writeIoValue(IO_DMA_CONTROL, 0);
		this.memory.writeIoValue(IO_DMA_STATUS, 0);
		this.memory.writeIoValue(IO_DMA_TRIGGER, 0);
	}

	private clearAdmittedBlock(): void {
		this.scheduledBlockWords = 0;
		this.scheduledReadAddressWord = 0;
		this.scheduledWriteAddressWord = 0;
		this.scheduledTransferCountWord = 0;
		this.scheduledControlWord = 0;
		this.serviceDeadline = 0;
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
		const blockWords = remaining < programmedBlockWords ? remaining : programmedBlockWords;
		const readAddress = this.memory.readIoU32(IO_DMA_READ_ADDR);
		const writeAddress = this.memory.readIoU32(IO_DMA_WRITE_ADDR);
		const readRegion = this.memory.mappedRegion(readAddress);
		const writeRegion = this.memory.mappedRegion(writeAddress);
		let blockCycles: number;
		if (readRegion === MemoryRegionKind.Ram && writeRegion === MemoryRegionKind.Ram) {
			blockCycles = 2 * (blockWords * this.ramCyclesPerWord + this.ramBurstSetupCycles);
		} else {
			const ramBlockCycles = readRegion === MemoryRegionKind.Ram || writeRegion === MemoryRegionKind.Ram
				? blockWords * this.ramCyclesPerWord + this.ramBurstSetupCycles
				: 0;
			const readCycles = readRegion === MemoryRegionKind.Ram
				? ramBlockCycles
				: readRegion === MemoryRegionKind.SystemRom
					? blockWords * this.systemRomCyclesPerWord
					: readRegion === MemoryRegionKind.CartRom ? blockWords * this.cartRomCyclesPerWord : 0;
			const writeCycles = writeRegion === MemoryRegionKind.Ram
				? ramBlockCycles
				: writeRegion === MemoryRegionKind.SystemRom
					? blockWords * this.systemRomCyclesPerWord
					: writeRegion === MemoryRegionKind.CartRom ? blockWords * this.cartRomCyclesPerWord : 0;
			blockCycles = readCycles > writeCycles ? readCycles : writeCycles;
		}
		if (blockCycles === 0) {
			blockCycles = 1;
		}
		this.scheduledBlockWords = blockWords;
		this.scheduledReadAddressWord = readAddress;
		this.scheduledWriteAddressWord = writeAddress;
		this.scheduledTransferCountWord = remaining;
		this.scheduledControlWord = control;
		this.serviceDeadline = anchorCycle + blockCycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, this.serviceDeadline);
	}

	private requestInputChanged(): void {
		if (this.restorePending || this.serviceActive || !this.busy()) {
			return;
		}
		if (this.scheduledBlockWords !== 0) {
			return;
		}
		if (this.memory.readIoU32(IO_DMA_TRANSFER_COUNT) === 0) {
			this.finishTransfer();
			return;
		}
		if (!this.requestAsserted()) {
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
		if (this.scheduledBlockWords !== 0) {
			return this.scheduledWriteAddressWord === IO_GX_GPU_GP0;
		}
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
