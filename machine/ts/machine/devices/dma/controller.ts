import {
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GX_GPU_GP0,
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
} from '../../bus/io';
import {
	IO_WORD_SIZE,
	RAM_BASE,
	RAM_END,
} from '../../memory/map';
import { readLE32 } from '../../../common/endian';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_DMA, type DeviceScheduler } from '../../scheduler/device';

const DMA_SERVICE_BATCH_BYTES = 64;
export const DMA_JOB_QUEUE_CAPACITY = 16;

export type DmaJobState = {
	src: number;
	dst: number;
	remaining: number;
	written: number;
	clipped: boolean;
};

export type DmaControllerState = {
	queue: DmaJobState[];
	budget: number;
	carry: number;
	writtenValue: number;
	writtenDirty: boolean;
	sourceRegisterWord: number;
	destinationRegisterWord: number;
	lengthRegisterWord: number;
	controlRegisterWord: number;
	statusRegisterWord: number;
	writtenRegisterWord: number;
};

export class DmaController {
	private readonly queueSrc = new Uint32Array(DMA_JOB_QUEUE_CAPACITY);
	private readonly queueDst = new Uint32Array(DMA_JOB_QUEUE_CAPACITY);
	private readonly queueRemaining = new Uint32Array(DMA_JOB_QUEUE_CAPACITY);
	private readonly queueWritten = new Uint32Array(DMA_JOB_QUEUE_CAPACITY);
	private readonly queueClipped = new Uint8Array(DMA_JOB_QUEUE_CAPACITY);
	private queueCount = 0;
	private queueHead = 0;
	private budget = 0;
	private cpuHz = 1;
	private bytesPerSec = 1;
	private carry = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private ioWrittenValue = 0;
	private ioWrittenDirty = false;
	private readonly buffer = new Uint8Array(DMA_SERVICE_BATCH_BYTES);

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.memory.mapIoWrite(IO_DMA_CTRL, this, DmaController.startIoThunk);
	}

	private static startIoThunk(context: DmaController): void {
		const ctrlValue = context.memory.readIoU32(IO_DMA_CTRL);
		if ((ctrlValue & DMA_CTRL_START) === 0) {
			return;
		}
		const ctrl = ctrlValue >>> 0;
		const src = context.memory.readIoU32(IO_DMA_SRC);
		const dst = context.memory.readIoU32(IO_DMA_DST);
		const len = context.memory.readIoU32(IO_DMA_LEN);
		const strict = (ctrl & DMA_CTRL_STRICT) !== 0;
		context.memory.writeIoValue(IO_DMA_CTRL, ctrl & ~DMA_CTRL_START);
		context.memory.writeValue(IO_DMA_WRITTEN, 0);
		const maxWritable = context.resolveMaxWritable(dst);
		if (maxWritable <= 0) {
			context.finishIoError(false);
			return;
		}
		let transferLen = len;
		let clipped = false;
		if (transferLen > maxWritable) {
			clipped = true;
			if (strict) {
				context.finishIoError(true);
				return;
			}
			transferLen = maxWritable;
		}
		if (dst === IO_GX_GPU_GP0 && (transferLen & (IO_WORD_SIZE - 1)) !== 0) {
			clipped = true;
			if (strict) {
				context.finishIoError(true);
				return;
			}
			transferLen &= ~(IO_WORD_SIZE - 1);
		}
		context.memory.writeValue(IO_DMA_STATUS, DMA_STATUS_BUSY | (clipped ? DMA_STATUS_CLIPPED : 0));
		if (transferLen === 0) {
			context.finishIoSuccess(clipped);
			return;
		}
		if (context.queueCount === DMA_JOB_QUEUE_CAPACITY) {
			context.finishIoError(false);
			return;
		}
		context.ioWrittenValue = 0;
		context.ioWrittenDirty = true;
		const jobIndex = (context.queueHead + context.queueCount) % DMA_JOB_QUEUE_CAPACITY;
		context.queueSrc[jobIndex] = src;
		context.queueDst[jobIndex] = dst;
		context.queueRemaining[jobIndex] = transferLen;
		context.queueWritten[jobIndex] = 0;
		context.queueClipped[jobIndex] = clipped ? 1 : 0;
		context.queueCount += 1;
		context.scheduleNextService(context.scheduler.currentNowCycles());
	}

	public setTiming(cpuHz: number, bytesPerSec: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		this.bytesPerSec = bytesPerSec;
		this.carry = 0;
		this.budget = 0;
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (cycles <= 0) {
			return;
		}
		const pendingBytes = this.getPendingBytes();
		if (pendingBytes <= 0) {
			this.carry = 0;
			this.budget = 0;
			this.scheduleNextService(nowCycles);
			return;
		}
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, this.bytesPerSec, this.carry, cycles);
		this.carry = this.budgetAccrual.carry;
		const wholeBytes = this.budgetAccrual.wholeUnits;
		if (wholeBytes > 0) {
			const maxGrant = pendingBytes - this.budget;
			this.budget += wholeBytes > maxGrant ? maxGrant : wholeBytes;
		}
		this.scheduleNextService(nowCycles);
	}

	private hasPendingTransfer(): boolean {
		return this.queueCount !== 0;
	}

	private getPendingBytes(): number {
		let pendingBytes = 0;
		for (let offset = 0; offset < this.queueCount; offset += 1) {
			pendingBytes += this.queueRemaining[(this.queueHead + offset) % DMA_JOB_QUEUE_CAPACITY]!;
		}
		return pendingBytes;
	}

	public reset(): void {
		this.carry = 0;
		this.queueCount = 0;
		this.queueHead = 0;
		this.budget = 0;
		this.ioWrittenValue = 0;
		this.ioWrittenDirty = false;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		this.memory.writeValue(IO_DMA_SRC, 0);
		this.memory.writeValue(IO_DMA_DST, 0);
		this.memory.writeValue(IO_DMA_LEN, 0);
		this.memory.writeIoValue(IO_DMA_CTRL, 0);
		this.memory.writeValue(IO_DMA_STATUS, 0);
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
	}

	public onService(nowCycles: number): void {
		if (!this.hasPendingTransfer()) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
			return;
		}
		let budget = this.budget;
		while (budget > 0) {
			if (!this.hasPendingTransfer()) {
				break;
			}
			const jobIndex = this.queueHead;
			const written = this.processJob(jobIndex, budget);
			budget -= written;
			this.ioWrittenValue = this.queueWritten[jobIndex]!;
			this.ioWrittenDirty = true;
			if (this.queueRemaining[jobIndex] === 0) {
				this.finishIoSuccess(this.queueClipped[jobIndex] !== 0);
				this.queueHead = (this.queueHead + 1) % DMA_JOB_QUEUE_CAPACITY;
				this.queueCount -= 1;
				if (!this.hasPendingTransfer()) {
					this.queueHead = 0;
					this.carry = 0;
					budget = 0;
					break;
				}
				continue;
			}
			if (written === 0) {
				break;
			}
		}
		this.budget = budget;
		if (this.ioWrittenDirty) {
			this.memory.writeValue(IO_DMA_WRITTEN, this.ioWrittenValue);
			this.ioWrittenDirty = false;
		}
		this.scheduleNextService(nowCycles);
	}

	private processJob(jobIndex: number, budget: number): number {
		const remaining = this.queueRemaining[jobIndex]!;
		let chunk = remaining > budget ? budget : remaining;
		const dst = this.queueDst[jobIndex]!;
		if (dst === IO_GX_GPU_GP0) {
			chunk &= ~(IO_WORD_SIZE - 1);
			if (chunk === 0) {
				return 0;
			}
		}
		if (chunk > this.buffer.byteLength) {
			chunk = this.buffer.byteLength;
		}
		this.memory.readBytesInto(this.queueSrc[jobIndex]!, this.buffer, chunk);
		if (dst === IO_GX_GPU_GP0) {
			for (let offset = 0; offset < chunk; offset += IO_WORD_SIZE) {
				this.memory.writeMappedU32LE(IO_GX_GPU_GP0, readLE32(this.buffer, offset));
			}
		} else {
			this.memory.writeBytesFrom(this.buffer, 0, dst, chunk);
			this.queueDst[jobIndex] = dst + chunk;
		}
		this.queueSrc[jobIndex] = this.queueSrc[jobIndex]! + chunk;
		this.queueRemaining[jobIndex] = remaining - chunk;
		this.queueWritten[jobIndex] = this.queueWritten[jobIndex]! + chunk;
		return chunk;
	}

	private resolveMaxWritable(dst: number): number {
		if (dst === IO_GX_GPU_GP0) {
			return 0xffff_ffff;
		}
		if (dst >= RAM_BASE && dst < RAM_END) {
			return RAM_END - dst;
		}
		return 0;
	}

	private finishIoSuccess(clipped: boolean): void {
		this.memory.writeValue(IO_DMA_STATUS, DMA_STATUS_DONE | (clipped ? DMA_STATUS_CLIPPED : 0));
		this.irq.raise(IRQ_DMA_DONE);
	}

	private finishIoError(clipped: boolean): void {
		this.memory.writeValue(IO_DMA_STATUS, DMA_STATUS_DONE | DMA_STATUS_ERROR | (clipped ? DMA_STATUS_CLIPPED : 0));
		this.irq.raise(IRQ_DMA_ERROR);
	}

	public captureState(): DmaControllerState {
		const queue = new Array<DmaJobState>(this.queueCount);
		for (let offset = 0; offset < this.queueCount; offset += 1) {
			const index = (this.queueHead + offset) % DMA_JOB_QUEUE_CAPACITY;
			queue[offset] = {
				src: this.queueSrc[index]!,
				dst: this.queueDst[index]!,
				remaining: this.queueRemaining[index]!,
				written: this.queueWritten[index]!,
				clipped: this.queueClipped[index] !== 0,
			};
		}
		return {
			queue,
			budget: this.budget,
			carry: this.carry,
			writtenValue: this.ioWrittenValue,
			writtenDirty: this.ioWrittenDirty,
			sourceRegisterWord: this.memory.readIoU32(IO_DMA_SRC),
			destinationRegisterWord: this.memory.readIoU32(IO_DMA_DST),
			lengthRegisterWord: this.memory.readIoU32(IO_DMA_LEN),
			controlRegisterWord: this.memory.readIoU32(IO_DMA_CTRL),
			statusRegisterWord: this.memory.readIoU32(IO_DMA_STATUS),
			writtenRegisterWord: this.memory.readIoU32(IO_DMA_WRITTEN),
		};
	}

	public restoreState(state: DmaControllerState, nowCycles: number): void {
		for (let index = 0; index < state.queue.length; index += 1) {
			const source = state.queue[index]!;
			this.queueSrc[index] = source.src;
			this.queueDst[index] = source.dst;
			this.queueRemaining[index] = source.remaining;
			this.queueWritten[index] = source.written;
			this.queueClipped[index] = source.clipped ? 1 : 0;
		}
		this.queueCount = state.queue.length;
		this.queueHead = 0;
		this.budget = state.budget;
		this.carry = state.carry;
		this.ioWrittenValue = state.writtenValue;
		this.ioWrittenDirty = state.writtenDirty;
		this.memory.writeValue(IO_DMA_SRC, state.sourceRegisterWord);
		this.memory.writeValue(IO_DMA_DST, state.destinationRegisterWord);
		this.memory.writeValue(IO_DMA_LEN, state.lengthRegisterWord);
		this.memory.writeIoValue(IO_DMA_CTRL, state.controlRegisterWord);
		this.memory.writeValue(IO_DMA_STATUS, state.statusRegisterWord);
		this.memory.writeValue(IO_DMA_WRITTEN, state.writtenRegisterWord);
		this.scheduleNextService(nowCycles);
	}

	private scheduleNextService(nowCycles: number): void {
		if (!this.hasPendingTransfer()) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
			return;
		}
		const pendingBytes = this.getPendingBytes();
		const targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
		if (this.budget >= targetBytes) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, nowCycles);
			return;
		}
		this.scheduler.scheduleDeviceService(
			DEVICE_SERVICE_DMA,
			nowCycles + cyclesUntilBudgetUnits(this.cpuHz, this.bytesPerSec, this.carry, targetBytes - this.budget),
		);
	}
}
