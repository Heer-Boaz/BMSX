import { decodePngToRgba } from '../../../common/image_decode';
import {
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
	IMG_STATUS_CLIPPED,
	IMG_STATUS_DONE,
	IMG_STATUS_ERROR,
	IMG_STATUS_REJECTED,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IRQ_IMG_DONE,
	IRQ_IMG_ERROR,
} from '../../bus/io';
import {
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_SYSTEM_SLOT_SIZE,
} from '../../memory/map';
import { Memory } from '../../memory/memory';
import type { DecodedImage } from '../../../common/image_decode';
import { DmaController } from '../dma/controller';
import type { ImageCopyPlan } from '../dma/image_copy';
import type { IrqController } from '../irq/controller';
import type { VDP } from '../vdp/vdp';
import { cyclesUntilBudgetUnits } from '../../scheduler/budget';
import { DEVICE_SERVICE_IMG, type DeviceScheduler } from '../../scheduler/device';

type ImgDecJob = {
	buffer: Uint8Array;
	dst: number;
	cap: number;
	resolve: (result: { width: number; height: number; clipped: boolean }) => void;
	reject: (error: unknown) => void;
};

const IMGDEC_SERVICE_BATCH_BYTES = 256;

function imageDecoderFault(message: string): Error {
	return new Error(`Image decoder fault: ${message}`);
}

function planImageCopy(targetBaseAddr: number, targetCapacity: number, result: DecodedImage, capacityLimit: number): ImageCopyPlan {
	const capacity = capacityLimit < targetCapacity ? capacityLimit : targetCapacity;
	const sourceWidth = result.width;
	const sourceHeight = result.height;
	const sourceStride = sourceWidth * 4;
	const maxPixels = capacity >>> 2;
	let writeWidth = sourceWidth;
	let writeHeight = sourceHeight;
	if (sourceStride <= 0 || sourceHeight <= 0 || maxPixels <= 0) {
		writeWidth = 0;
		writeHeight = 0;
	} else {
		const maxRowsByPixels = (result.pixels.byteLength - (result.pixels.byteLength % sourceStride)) / sourceStride;
		if (sourceWidth > maxPixels) {
			writeWidth = maxPixels;
			writeHeight = maxRowsByPixels > 0 ? 1 : 0;
		} else {
			const maxRowsByCapacity = (capacity - (capacity % sourceStride)) / sourceStride;
			if (writeHeight > maxRowsByCapacity) {
				writeHeight = maxRowsByCapacity;
			}
			if (writeHeight > maxRowsByPixels) {
				writeHeight = maxRowsByPixels;
			}
		}
	}
	const writeStride = writeWidth * 4;
	const writeSize = writeStride * writeHeight;
	return {
		baseAddr: targetBaseAddr,
		writeWidth,
		writeHeight,
		writeStride,
		targetStride: writeStride,
		sourceStride,
		writeSize,
		clipped: writeWidth !== sourceWidth || writeHeight !== sourceHeight,
	};
}

export class ImgDecController {
	private cpuHz = 1;
	private decodeBytesPerSec = 1;
	private decodeCarry = 0;
	private availableDecodeBytes = 0;
	private active = false;
	private status = 0;
	private pendingError: unknown = null;
	private pendingResult: DecodedImage | null = null;
	private pendingTargetBase = 0;
	private pendingTargetCapacity = 0;
	private activeCapacityLimit = 0;
	private decodeActive = false;
	private decodeRemaining = 0;
	private decodePlan: ImageCopyPlan | null = null;
	private decodePixels: Uint8Array | null = null;
	private decodeWidth = 0;
	private decodeHeight = 0;
	private decodeQueued = false;
	private decodeToken = 0;
	private readonly queuedJobs: Array<ImgDecJob | null> = [];
	private queuedJobHead = 0;
	private activeResolve: ImgDecJob['resolve'] | null = null;
	private activeReject: ImgDecJob['reject'] | null = null;
	private signalIrq = false;

	public constructor(
		private readonly memory: Memory,
		private readonly dma: DmaController,
		private readonly vdp: VDP,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.memory.mapIoWrite(IO_IMG_CTRL, this.onCtrlRegisterWrite.bind(this));
	}

	private onCtrlRegisterWrite(): void {
		this.onCtrlWrite(this.scheduler.currentNowCycles());
	}

	public setTiming(cpuHz: number, decodeBytesPerSec: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		this.decodeBytesPerSec = decodeBytesPerSec;
		this.decodeCarry = 0;
		this.availableDecodeBytes = 0;
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (!this.active || !this.decodeActive || this.decodeQueued || this.decodeRemaining <= 0 || cycles <= 0) {
			return;
		}
		const numerator = this.decodeBytesPerSec * cycles + this.decodeCarry;
		const nextCarry = numerator % this.cpuHz;
		const wholeBytes = (numerator - nextCarry) / this.cpuHz;
		this.decodeCarry = nextCarry;
		if (wholeBytes > 0) {
			const maxGrant = this.decodeRemaining - this.availableDecodeBytes;
			this.availableDecodeBytes += wholeBytes > maxGrant ? maxGrant : wholeBytes;
		}
		this.scheduleNextService(nowCycles);
	}

	public hasPendingDecodeWork(): boolean {
		return this.active && this.decodeActive && !this.decodeQueued && this.decodeRemaining > 0;
	}

	public getPendingDecodeBytes(): number {
		return this.decodeRemaining;
	}

	public decodeToVram(params: { bytes: Uint8Array; dst: number; cap: number }): Promise<{ width: number; height: number; clipped: boolean }> {
		return new Promise((resolve, reject) => {
			this.queuedJobs.push({ buffer: params.bytes, dst: params.dst, cap: params.cap, resolve, reject });
			this.scheduleNextService(this.scheduler.currentNowCycles());
		});
	}

	public reset(): void {
		this.decodeToken += 1;
		this.decodeCarry = 0;
		this.availableDecodeBytes = 0;
		this.active = false;
		this.status = 0;
		this.pendingError = null;
		this.pendingResult = null;
		this.pendingTargetBase = 0;
		this.pendingTargetCapacity = 0;
		this.activeCapacityLimit = 0;
		this.decodeActive = false;
		this.decodeRemaining = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeWidth = 0;
		this.decodeHeight = 0;
		this.decodeQueued = false;
		this.signalIrq = false;
		this.queuedJobs.length = 0;
		this.queuedJobHead = 0;
		this.activeResolve = null;
		this.activeReject = null;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMG);
		this.memory.writeValue(IO_IMG_SRC, 0);
		this.memory.writeValue(IO_IMG_LEN, 0);
		this.memory.writeValue(IO_IMG_DST, 0);
		this.memory.writeValue(IO_IMG_CAP, 0);
		this.memory.writeIoValue(IO_IMG_CTRL, 0);
		this.memory.writeValue(IO_IMG_STATUS, 0);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
	}

	public onCtrlWrite(nowCycles: number): void {
		const ctrlValue = this.memory.readIoU32(IO_IMG_CTRL);
		const ctrl = ctrlValue >>> 0;
		if ((ctrl & IMG_CTRL_START) === 0) {
			return;
		}
		if (this.active) {
			this.memory.writeIoValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
			this.status |= IMG_STATUS_REJECTED;
			this.memory.writeValue(IO_IMG_STATUS, this.status);
			return;
		}
		const src = this.memory.readIoU32(IO_IMG_SRC);
		const len = this.memory.readIoU32(IO_IMG_LEN);
		const dst = this.memory.readIoU32(IO_IMG_DST);
		const cap = this.memory.readIoU32(IO_IMG_CAP);
		this.memory.writeIoValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
		const buffer = new Uint8Array(len);
		if (!this.memory.readBytesInto(src, buffer, len)) {
			this.activeResolve = null;
			this.activeReject = null;
			this.status = IMG_STATUS_DONE | IMG_STATUS_ERROR;
			this.memory.writeValue(IO_IMG_STATUS, this.status);
			this.memory.writeValue(IO_IMG_WRITTEN, 0);
			this.memory.writeValue(IO_IMG_SRC, src);
			this.memory.writeValue(IO_IMG_LEN, len);
			this.memory.writeValue(IO_IMG_DST, dst);
			this.memory.writeValue(IO_IMG_CAP, cap);
			this.irq.raise(IRQ_IMG_ERROR);
			this.scheduleNextService(nowCycles);
			return;
		}
		this.activeResolve = null;
		this.activeReject = null;
		this.startJob(buffer, dst, cap, src, len, true);
		this.scheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (!this.active) {
			if (!this.startNextQueuedJob()) {
				this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMG);
				return;
			}
			if (!this.active) {
				return;
			}
		}
		if (this.pendingError !== null) {
			const error = this.pendingError;
			this.pendingError = null;
			this.finishError(error);
			return;
		}
		if (this.pendingResult !== null) {
			const result = this.pendingResult;
			const targetBase = this.pendingTargetBase;
			const targetCapacity = this.pendingTargetCapacity;
			this.pendingResult = null;
			this.pendingTargetBase = 0;
			this.pendingTargetCapacity = 0;
			this.beginDecode(result, targetBase, targetCapacity);
			if (!this.active) {
				return;
			}
		}
		if (this.decodeActive && this.availableDecodeBytes > 0) {
			this.advanceDecode();
			if (!this.active) {
				return;
			}
		}
		this.scheduleNextService(nowCycles);
	}

	private startNextQueuedJob(): boolean {
		if (this.queuedJobHead === this.queuedJobs.length) {
			return false;
		}
		const job = this.queuedJobs[this.queuedJobHead]!;
		this.queuedJobs[this.queuedJobHead] = null;
		this.queuedJobHead += 1;
		if (this.queuedJobHead === this.queuedJobs.length) {
			this.queuedJobs.length = 0;
			this.queuedJobHead = 0;
		}
		const buffer = job.buffer;
		this.activeResolve = job.resolve;
		this.activeReject = job.reject;
		this.startJob(buffer, job.dst, job.cap, 0, buffer.byteLength, false);
		return true;
	}

	private decodeTargetCapacity(dst: number): number {
		if (dst === VRAM_PRIMARY_SLOT_BASE) {
			return VRAM_PRIMARY_SLOT_SIZE;
		}
		if (dst === VRAM_SECONDARY_SLOT_BASE) {
			return VRAM_SECONDARY_SLOT_SIZE;
		}
		if (dst === VRAM_SYSTEM_SLOT_BASE) {
			return VRAM_SYSTEM_SLOT_SIZE;
		}
		return 0;
	}

	private startJob(buffer: Uint8Array, dst: number, cap: number, src: number, len: number, signalIrq: boolean): void {
		this.pendingResult = null;
		this.pendingError = null;
		this.pendingTargetBase = 0;
		this.pendingTargetCapacity = 0;
		this.activeCapacityLimit = 0;
		this.signalIrq = signalIrq;
		this.status = IMG_STATUS_BUSY;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
		this.memory.writeValue(IO_IMG_SRC, src);
		this.memory.writeValue(IO_IMG_LEN, len);
		this.memory.writeValue(IO_IMG_DST, dst);
		this.memory.writeValue(IO_IMG_CAP, cap);

		const targetCapacity = this.decodeTargetCapacity(dst);
		if (targetCapacity === 0) {
			this.finishError(null);
			return;
		}
		const effectiveCap = cap < targetCapacity ? cap : targetCapacity;
		if (effectiveCap === 0) {
			this.finishError(null);
			return;
		}
		this.activeCapacityLimit = effectiveCap;
		this.active = true;
		this.decodeActive = false;
		this.decodeRemaining = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeWidth = 0;
		this.decodeHeight = 0;
		this.decodeQueued = false;
		const token = this.decodeToken + 1;
		this.decodeToken = token;
		void decodePngToRgba(buffer).then((result) => {
			if (token !== this.decodeToken) {
				return;
			}
			this.pendingResult = result;
			this.pendingTargetBase = dst;
			this.pendingTargetCapacity = targetCapacity;
			this.scheduleNextService(this.scheduler.currentNowCycles());
		}, (error: unknown) => {
			if (token !== this.decodeToken) {
				return;
			}
			this.pendingError = error;
			this.scheduleNextService(this.scheduler.currentNowCycles());
		});
	}

	private beginDecode(result: DecodedImage, targetBase: number, targetCapacity: number): void {
		const plan = planImageCopy(targetBase, targetCapacity, result, this.activeCapacityLimit);
		this.activeCapacityLimit = 0;
		this.decodePlan = plan;
		this.decodePixels = result.pixels;
		this.decodeWidth = result.width;
		this.decodeHeight = result.height;
		this.decodeRemaining = plan.writeSize;
		if (plan.writeWidth > 0 && plan.writeHeight > 0) {
			this.vdp.setDecodedVramSurfaceDimensions(targetBase, plan.writeWidth, plan.writeHeight);
		}
		this.decodeCarry = 0;
		this.availableDecodeBytes = 0;
		this.decodeActive = true;
		this.decodeQueued = false;
		if (plan.writeSize === 0) {
			this.finishSuccess(plan.clipped);
		}
	}

	private advanceDecode(): void {
		const budget = this.availableDecodeBytes;
		if (this.decodeRemaining > 0 && budget > 0) {
			const consume = this.decodeRemaining > budget ? budget : this.decodeRemaining;
			this.decodeRemaining -= consume;
			this.availableDecodeBytes -= consume;
		}
		if (this.decodeRemaining > 0 || this.decodeQueued) {
			return;
		}
		this.decodeQueued = true;
		const plan = this.decodePlan!;
		const pixels = this.decodePixels!;
		this.decodePlan = null;
		this.decodePixels = null;
		this.dma.enqueueImageCopy(plan, pixels, (error, clipped) => {
			if (error) {
				this.finishError(null);
				return;
			}
			this.finishSuccess(clipped);
		});
	}

	private finishSuccess(clipped: boolean): void {
		const resolve = this.activeResolve;
		const width = this.decodeWidth;
		const height = this.decodeHeight;
		this.activeResolve = null;
		this.activeReject = null;
		this.active = false;
		this.pendingError = null;
		this.pendingResult = null;
		this.pendingTargetBase = 0;
		this.pendingTargetCapacity = 0;
		this.activeCapacityLimit = 0;
		this.decodeActive = false;
		this.availableDecodeBytes = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeWidth = 0;
		this.decodeHeight = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | (clipped ? IMG_STATUS_CLIPPED : 0);
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		if (this.signalIrq) {
			this.irq.raise(IRQ_IMG_DONE);
		}
		this.signalIrq = false;
		if (resolve) {
			resolve({ width, height, clipped });
		}
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	private finishError(jobError: unknown | null): void {
		const reject = this.activeReject;
		this.activeResolve = null;
		this.activeReject = null;
		this.active = false;
		this.pendingError = null;
		this.pendingResult = null;
		this.pendingTargetBase = 0;
		this.pendingTargetCapacity = 0;
		this.activeCapacityLimit = 0;
		this.decodeActive = false;
		this.availableDecodeBytes = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeWidth = 0;
		this.decodeHeight = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		if (this.signalIrq) {
			this.irq.raise(IRQ_IMG_ERROR);
		}
		this.signalIrq = false;
		if (reject) {
			reject(jobError === null || jobError === undefined ? imageDecoderFault('decode failed.') : jobError);
		}
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	private scheduleNextService(nowCycles: number): void {
		if (!this.active) {
			if (this.queuedJobHead !== this.queuedJobs.length) {
				this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMG, nowCycles);
				return;
			}
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMG);
			return;
		}
		if (this.pendingError !== null || this.pendingResult !== null) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMG, nowCycles);
			return;
		}
		if (this.decodeActive && !this.decodeQueued && this.decodeRemaining > 0) {
			const targetBytes = this.decodeRemaining < IMGDEC_SERVICE_BATCH_BYTES ? this.decodeRemaining : IMGDEC_SERVICE_BATCH_BYTES;
			if (this.availableDecodeBytes >= targetBytes) {
				this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMG, nowCycles);
				return;
			}
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMG, nowCycles + cyclesUntilBudgetUnits(this.cpuHz, this.decodeBytesPerSec, this.decodeCarry, targetBytes - this.availableDecodeBytes));
			return;
		}
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMG);
	}
}
