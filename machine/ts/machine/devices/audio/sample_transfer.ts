import {
	IO_APU_TRANSFER_ADDRESS,
	IO_APU_TRANSFER_CONTROL,
	IO_APU_TRANSFER_DATA,
} from '../../bus/io';
import type { Memory } from '../../memory/memory';
import { cyclesUntilBudgetUnits } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU_TRANSFER, type DeviceScheduler } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import {
	APU_STATUS_DMA_READ_REQUEST,
	APU_STATUS_DMA_REQUEST,
	APU_STATUS_DMA_WRITE_REQUEST,
	APU_STATUS_TRANSFER_BUSY,
	APU_SAMPLE_RAM_ADDRESS_MASK,
	APU_TRANSFER_FIFO_WORD_CAPACITY,
	APU_TRANSFER_MODE_DMA_READ,
	APU_TRANSFER_MODE_DMA_WRITE,
	APU_TRANSFER_MODE_MANUAL_WRITE,
	APU_TRANSFER_MODE_MASK,
	APU_TRANSFER_MODE_STOP,
	APU_TRANSFER_WORDS_PER_SECOND,
} from './contracts';
import type { ApuSampleMemory } from './sample_memory';
import type { ApuSampleTransferState } from './save_state';

// This datapath is owned exclusively by ApuServiceClock. It has no MMIO or
// scheduler entry point of its own, so every state transition shares the APU
// clock domain's transfer-before-DAC ordering.
export class ApuSampleTransfer {
	private readonly fifoWords = new Uint32Array(APU_TRANSFER_FIFO_WORD_CAPACITY);
	private fifoReadIndex = 0;
	private fifoWriteIndex = 0;
	private fifoCount = 0;
	private currentAddress = 0;
	private dataLatch = 0;
	private mode = APU_TRANSFER_MODE_STOP;
	private cpuHz = 1;
	private timingCarry = 0;
	scheduledWords = 0;
	scheduledDeadline = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly sampleMemory: ApuSampleMemory,
		private readonly dma: DmaController,
		private readonly scheduler: DeviceScheduler,
	) {}

	public reset(): void {
		this.cancelBatch();
		this.fifoWords.fill(0);
		this.clearFifo();
		this.currentAddress = 0;
		this.dataLatch = 0;
		this.mode = APU_TRANSFER_MODE_STOP;
		this.timingCarry = 0;
		this.memory.writeIoValue(IO_APU_TRANSFER_ADDRESS, 0);
		this.memory.writeIoValue(IO_APU_TRANSFER_DATA, 0);
		this.memory.writeIoValue(IO_APU_TRANSFER_CONTROL, 0);
		this.updateDmaRequests();
	}

	public dispose(): void {
		this.cancelBatch();
		this.dma.setApuDmaWriteReady(false);
		this.dma.setApuDmaReadReady(false);
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		if (this.cpuHz === cpuHz) {
			return;
		}
		this.cancelBatch();
		this.cpuHz = cpuHz;
		this.timingCarry = 0;
		this.scheduleBatch(nowCycles);
	}

	public statusBits(): number {
		const dmaWriteRequest = this.mode === APU_TRANSFER_MODE_DMA_WRITE && this.fifoCount === 0;
		const dmaReadRequest = this.mode === APU_TRANSFER_MODE_DMA_READ && this.fifoCount === APU_TRANSFER_FIFO_WORD_CAPACITY;
		return ((dmaWriteRequest || dmaReadRequest ? APU_STATUS_DMA_REQUEST : 0)
			| (dmaReadRequest ? APU_STATUS_DMA_READ_REQUEST : 0)
			| (dmaWriteRequest ? APU_STATUS_DMA_WRITE_REQUEST : 0)
			| (this.scheduledWords !== 0 ? APU_STATUS_TRANSFER_BUSY : 0)) >>> 0;
	}

	public captureState(nowCycles: number): ApuSampleTransferState {
		return {
			fifoWords: Array.from(this.fifoWords),
			fifoReadIndex: this.fifoReadIndex,
			fifoWriteIndex: this.fifoWriteIndex,
			fifoCount: this.fifoCount,
			transferAddressWord: this.memory.readIoU32(IO_APU_TRANSFER_ADDRESS),
			transferDataWord: this.dataLatch,
			transferControlWord: this.memory.readIoU32(IO_APU_TRANSFER_CONTROL),
			currentAddress: this.currentAddress,
			timingCarry: this.timingCarry,
			scheduledWords: this.scheduledWords,
			scheduledCycles: this.scheduledWords === 0 ? 0 : this.scheduledDeadline - nowCycles,
		};
	}

	public restoreState(state: ApuSampleTransferState, nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
		for (let index = 0; index < APU_TRANSFER_FIFO_WORD_CAPACITY; index += 1) {
			this.fifoWords[index] = state.fifoWords[index]!;
		}
		this.fifoReadIndex = state.fifoReadIndex;
		this.fifoWriteIndex = state.fifoWriteIndex;
		this.fifoCount = state.fifoCount;
		this.currentAddress = state.currentAddress;
		this.dataLatch = state.transferDataWord;
		this.mode = state.transferControlWord & APU_TRANSFER_MODE_MASK;
		this.timingCarry = state.timingCarry;
		this.scheduledWords = state.scheduledWords;
		this.scheduledDeadline = nowCycles + state.scheduledCycles;
		this.memory.writeIoValue(IO_APU_TRANSFER_ADDRESS, state.transferAddressWord);
		this.memory.writeIoValue(IO_APU_TRANSFER_DATA, state.transferDataWord);
		this.memory.writeIoValue(IO_APU_TRANSFER_CONTROL, state.transferControlWord);
		this.updateDmaRequests();
		if (this.scheduledWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU_TRANSFER, this.scheduledDeadline);
		}
	}

	public completeService(): void {
		const completedDeadline = this.scheduledDeadline;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
		this.completeBatch();
		this.scheduleBatch(completedDeadline);
	}

	public writeAddress(word: number): void {
		this.currentAddress = word & (APU_SAMPLE_RAM_ADDRESS_MASK & ~3);
	}

	public readCpuData(): number {
		return this.dataLatch;
	}

	public writeCpuData(word: number): void {
		this.dataLatch = word >>> 0;
		if (this.mode === APU_TRANSFER_MODE_MANUAL_WRITE) {
			this.sampleMemory.writeWord(this.currentAddress, this.dataLatch);
			this.currentAddress = (this.currentAddress + 4) & APU_SAMPLE_RAM_ADDRESS_MASK;
		}
	}

	public readDmaData(grantEnd: boolean): number {
		if (this.mode === APU_TRANSFER_MODE_DMA_READ && this.fifoCount !== 0) {
			this.dataLatch = this.popFifo();
			this.memory.writeIoValue(IO_APU_TRANSFER_DATA, this.dataLatch);
			this.updateDmaRequests();
			if (grantEnd) {
				this.scheduleBatch(this.scheduler.currentNowCycles());
			}
		}
		return this.dataLatch;
	}

	public writeDmaData(word: number, grantEnd: boolean): void {
		this.dataLatch = word >>> 0;
		if (this.mode === APU_TRANSFER_MODE_DMA_WRITE) {
			this.pushFifo(this.dataLatch);
			this.updateDmaRequests();
			if (grantEnd) {
				this.scheduleBatch(this.scheduler.currentNowCycles());
			}
		}
	}

	public writeControl(word: number): void {
		const mode = word & APU_TRANSFER_MODE_MASK;
		if (mode !== this.mode) {
			this.cancelBatch();
			this.clearFifo();
			this.timingCarry = 0;
			this.mode = mode;
		}
		this.updateDmaRequests();
		this.scheduleBatch(this.scheduler.currentNowCycles());
	}

	private clearFifo(): void {
		this.fifoReadIndex = 0;
		this.fifoWriteIndex = 0;
		this.fifoCount = 0;
	}

	private completeBatch(): void {
		const transferWords = this.scheduledWords;
		this.scheduledWords = 0;
		if (this.mode === APU_TRANSFER_MODE_DMA_READ) {
			for (let index = 0; index < transferWords; index += 1) {
				this.pushFifo(this.sampleMemory.readWord(this.currentAddress));
				this.currentAddress = (this.currentAddress + 4) & APU_SAMPLE_RAM_ADDRESS_MASK;
			}
		} else {
			for (let index = 0; index < transferWords; index += 1) {
				this.sampleMemory.writeWord(this.currentAddress, this.popFifo());
				this.currentAddress = (this.currentAddress + 4) & APU_SAMPLE_RAM_ADDRESS_MASK;
			}
		}
		this.updateDmaRequests();
	}

	private scheduleBatch(anchorCycle: number): void {
		if (this.scheduledWords !== 0) {
			return;
		}
		let words = 0;
		if (this.mode === APU_TRANSFER_MODE_DMA_WRITE) {
			words = this.fifoCount;
		} else if (this.mode === APU_TRANSFER_MODE_DMA_READ) {
			words = APU_TRANSFER_FIFO_WORD_CAPACITY - this.fifoCount;
		}
		if (words === 0) {
			this.scheduledDeadline = 0;
			return;
		}
		const cycles = cyclesUntilBudgetUnits(this.cpuHz, APU_TRANSFER_WORDS_PER_SECOND, this.timingCarry, words);
		this.timingCarry = (APU_TRANSFER_WORDS_PER_SECOND * cycles + this.timingCarry) % this.cpuHz;
		this.scheduledWords = words;
		this.scheduledDeadline = anchorCycle + cycles;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU_TRANSFER, this.scheduledDeadline);
	}

	private cancelBatch(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
		this.scheduledWords = 0;
		this.scheduledDeadline = 0;
	}

	private pushFifo(word: number): void {
		if (this.fifoCount === APU_TRANSFER_FIFO_WORD_CAPACITY) {
			return;
		}
		this.fifoWords[this.fifoWriteIndex] = word;
		this.fifoWriteIndex = (this.fifoWriteIndex + 1) & (APU_TRANSFER_FIFO_WORD_CAPACITY - 1);
		this.fifoCount += 1;
	}

	private popFifo(): number {
		const word = this.fifoWords[this.fifoReadIndex]!;
		this.fifoReadIndex = (this.fifoReadIndex + 1) & (APU_TRANSFER_FIFO_WORD_CAPACITY - 1);
		this.fifoCount -= 1;
		return word;
	}

	private updateDmaRequests(): void {
		this.dma.setApuDmaWriteReady(this.mode === APU_TRANSFER_MODE_DMA_WRITE && this.fifoCount === 0);
		this.dma.setApuDmaReadReady(this.mode === APU_TRANSFER_MODE_DMA_READ && this.fifoCount === APU_TRANSFER_FIFO_WORD_CAPACITY);
	}
}
