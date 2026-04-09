import { taskGate } from '../../core/taskgate';
import { decodePngToRgba } from '../../utils/image_decode';
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
} from '../io';
import {
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_BASE,
} from '../memory_map';
import { ATLAS_PRIMARY_SLOT_ID, ATLAS_SECONDARY_SLOT_ID, ENGINE_ATLAS_INDEX, generateAtlasName } from '../../rompack/rompack';
import type { AssetEntry, ImageWritePlan } from '../memory';
import { Memory } from '../memory';
import type { DecodedImage } from '../../utils/image_decode';
import { DmaController } from './dma_controller';

type ImgDecJob = {
	buffer: Uint8Array;
	dst: number;
	cap: number;
	resolve: (result: { pixels: Uint8Array; width: number; height: number; clipped: boolean }) => void;
	reject: (error: unknown) => void;
};

const IMGDEC_SERVICE_BATCH_BYTES = 256;

function imageDecoderFault(message: string): Error {
	return new Error(`Image decoder fault: ${message}`);
}

export class ImgDecController {
	private readonly gate = taskGate.group('imgdec');
	private cpuHz: bigint = 1n;
	private decodeBytesPerSec: bigint = 1n;
	private decodeCarry: bigint = 0n;
	private availableDecodeBytes = 0;
	private active = false;
	private status = 0;
	private pendingError: unknown = null;
	private pendingResult: DecodedImage | null = null;
	private pendingEntry: AssetEntry | null = null;
	private pendingCap = 0;
	private decodeActive = false;
	private decodeRemaining = 0;
	private decodePlan: ImageWritePlan | null = null;
	private decodePixels: Uint8Array | null = null;
	private decodeResult: DecodedImage | null = null;
	private decodeQueued = false;
	private decodeToken = 0;
	private readonly queuedJobs: ImgDecJob[] = [];
	private activeJob: ImgDecJob | null = null;
	private signalIrq = false;

	public constructor(
		private readonly memory: Memory,
		private readonly dma: DmaController,
		private readonly raiseIrq: (mask: number) => void,
		private readonly getNowCycles: () => number,
		private readonly scheduleService: (deadlineCycles: number) => void,
		private readonly cancelService: () => void,
	) {}

	public setTiming(cpuHz: number, decodeBytesPerSec: number, nowCycles: number): void {
		this.cpuHz = BigInt(cpuHz);
		this.decodeBytesPerSec = BigInt(decodeBytesPerSec);
		this.decodeCarry = 0n;
		this.availableDecodeBytes = 0;
		this.maybeScheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (!this.active || !this.decodeActive || this.decodeQueued || this.decodeRemaining <= 0 || cycles <= 0) {
			return;
		}
		const numerator = this.decodeBytesPerSec * BigInt(cycles) + this.decodeCarry;
		const wholeBytes = numerator / this.cpuHz;
		this.decodeCarry = numerator % this.cpuHz;
		if (wholeBytes > 0n) {
			const maxGrant = BigInt(this.decodeRemaining - this.availableDecodeBytes);
			const granted = wholeBytes > maxGrant ? maxGrant : wholeBytes;
			this.availableDecodeBytes += Number(granted);
		}
		this.maybeScheduleNextService(nowCycles);
	}

	public hasPendingDecodeWork(): boolean {
		return this.active && this.decodeActive && !this.decodeQueued && this.decodeRemaining > 0;
	}

	public getPendingDecodeBytes(): number {
		return this.decodeRemaining;
	}

	public decodeToVram(params: { bytes: Uint8Array; dst: number; cap: number }): Promise<{ pixels: Uint8Array; width: number; height: number; clipped: boolean }> {
		return new Promise((resolve, reject) => {
			this.queuedJobs.push({ buffer: params.bytes, dst: params.dst, cap: params.cap, resolve, reject });
			this.maybeScheduleNextService(this.getNowCycles());
		});
	}

	public reset(): void {
		this.decodeToken += 1;
		this.decodeCarry = 0n;
		this.availableDecodeBytes = 0;
		this.active = false;
		this.status = 0;
		this.pendingError = null;
		this.pendingResult = null;
		this.pendingEntry = null;
		this.pendingCap = 0;
		this.decodeActive = false;
		this.decodeRemaining = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeResult = null;
		this.decodeQueued = false;
		this.signalIrq = false;
		this.queuedJobs.length = 0;
		this.activeJob = null;
		this.cancelService();
		this.memory.writeValue(IO_IMG_SRC, 0);
		this.memory.writeValue(IO_IMG_LEN, 0);
		this.memory.writeValue(IO_IMG_DST, 0);
		this.memory.writeValue(IO_IMG_CAP, 0);
		this.memory.writeValue(IO_IMG_CTRL, 0);
		this.memory.writeValue(IO_IMG_STATUS, 0);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
	}

	public onCtrlWrite(nowCycles: number): void {
		const ctrlValue = this.memory.readValue(IO_IMG_CTRL) as number;
		const ctrl = ctrlValue >>> 0;
		if ((ctrl & IMG_CTRL_START) === 0) {
			return;
		}
		if (this.active) {
			this.memory.writeValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
			this.status |= IMG_STATUS_REJECTED;
			this.memory.writeValue(IO_IMG_STATUS, this.status);
			return;
		}
		const src = (this.memory.readValue(IO_IMG_SRC) as number) >>> 0;
		const len = (this.memory.readValue(IO_IMG_LEN) as number) >>> 0;
		const dst = (this.memory.readValue(IO_IMG_DST) as number) >>> 0;
		const cap = (this.memory.readValue(IO_IMG_CAP) as number) >>> 0;
		this.memory.writeValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
		let buffer: Uint8Array;
		try {
			const bytes = this.memory.readBytes(src, len);
			const copy = new Uint8Array(bytes.byteLength);
			copy.set(bytes);
			buffer = copy;
		} catch (error) {
			this.finishError(error);
			return;
		}
		this.startJob({ buffer, dst, cap, src, len, job: null, signalIrq: true });
		this.maybeScheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		this.tryStartQueued();
		if (!this.active) {
			this.cancelService();
			return;
		}
		if (this.pendingError !== null) {
			const error = this.pendingError;
			this.pendingError = null;
			this.finishError(error);
			this.maybeScheduleNextService(nowCycles);
			return;
		}
		if (this.pendingResult !== null && this.pendingEntry !== null) {
			const result = this.pendingResult;
			const entry = this.pendingEntry;
			this.pendingResult = null;
			this.pendingEntry = null;
			this.beginDecode(result, entry);
		}
		if (this.decodeActive && this.availableDecodeBytes > 0) {
			this.advanceDecode();
		}
		this.maybeScheduleNextService(nowCycles);
	}

	private tryStartQueued(): void {
		if (this.active) {
			return;
		}
		if (this.queuedJobs.length === 0) {
			return;
		}
		const job = this.queuedJobs.shift()!;
		this.startJob({ buffer: job.buffer, dst: job.dst, cap: job.cap, src: 0, len: job.buffer.byteLength, job, signalIrq: false });
	}

	private resolveSlotEntry(dst: number): AssetEntry {
		if (dst === VRAM_PRIMARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		}
		if (dst === VRAM_SECONDARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		}
		if (dst === VRAM_SYSTEM_ATLAS_BASE) {
			return this.memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
		}
		throw imageDecoderFault(`unsupported destination address ${dst}.`);
	}

	private startJob(params: { buffer: Uint8Array; dst: number; cap: number; src: number; len: number; job: ImgDecJob | null; signalIrq: boolean }): void {
		this.pendingResult = null;
		this.pendingError = null;
		this.pendingEntry = null;
		this.signalIrq = params.signalIrq;
		this.status = IMG_STATUS_BUSY;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
		this.memory.writeValue(IO_IMG_SRC, params.src);
		this.memory.writeValue(IO_IMG_LEN, params.len);
		this.memory.writeValue(IO_IMG_DST, params.dst);
		this.memory.writeValue(IO_IMG_CAP, params.cap);

		let entry: AssetEntry;
		try {
			entry = this.resolveSlotEntry(params.dst);
		} catch (error) {
			this.finishError(error);
			return;
		}
		const effectiveCap = Math.min(params.cap, entry.capacity);
		if (effectiveCap === 0) {
			this.finishError(imageDecoderFault(`invalid destination capacity ${params.cap}.`));
			return;
		}
		this.pendingCap = effectiveCap;
		this.active = true;
		this.decodeActive = false;
		this.decodeRemaining = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeResult = null;
		this.decodeQueued = false;
		this.activeJob = params.job;
		const token = this.decodeToken + 1;
		this.decodeToken = token;
		const promise = this.gate.track(decodePngToRgba(params.buffer), { blocking: false, category: 'texture', tag: 'imgdec' });
		promise.then((result) => {
			if (token !== this.decodeToken) {
				return;
			}
			this.pendingResult = result;
			this.pendingEntry = entry;
			this.maybeScheduleNextService(this.getNowCycles());
		}).catch((error) => {
			if (token !== this.decodeToken) {
				return;
			}
			this.pendingError = error;
			this.maybeScheduleNextService(this.getNowCycles());
		});
	}

	private beginDecode(result: DecodedImage, entry: AssetEntry): void {
		const cap = this.pendingCap;
		this.pendingCap = 0;
		const plan = this.memory.planImageSlotWrite(entry, { pixels: result.pixels, width: result.width, height: result.height, capacity: cap });
		this.decodePlan = plan;
		this.decodePixels = result.pixels;
		this.decodeResult = result;
		this.decodeRemaining = plan.writeSize;
		this.decodeCarry = 0n;
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
		this.dma.enqueueImageCopy(plan, pixels, (result) => {
			if (result.error) {
				this.finishError(result.fault);
				return;
			}
			this.finishSuccess(result.clipped);
		});
	}

	private finishSuccess(clipped: boolean): void {
		const job = this.activeJob;
		const decoded = this.decodeResult;
		this.activeJob = null;
		this.decodeResult = null;
		this.active = false;
		this.decodeActive = false;
		this.availableDecodeBytes = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | (clipped ? IMG_STATUS_CLIPPED : 0);
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		if (this.signalIrq) {
			this.raiseIrq(IRQ_IMG_DONE);
		}
		this.signalIrq = false;
		if (job && decoded) {
			job.resolve({ pixels: decoded.pixels, width: decoded.width, height: decoded.height, clipped });
		}
		this.maybeScheduleNextService(this.getNowCycles());
	}

	private finishError(error?: unknown): void {
		const job = this.activeJob;
		this.activeJob = null;
		this.decodeResult = null;
		this.active = false;
		this.decodeActive = false;
		this.availableDecodeBytes = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		if (this.signalIrq) {
			this.raiseIrq(IRQ_IMG_ERROR);
		}
		this.signalIrq = false;
		if (job) {
			job.reject(error ?? imageDecoderFault('decode failed.'));
		}
		this.maybeScheduleNextService(this.getNowCycles());
	}

	private maybeScheduleNextService(nowCycles: number): void {
		if (!this.active) {
			if (this.queuedJobs.length !== 0) {
				this.scheduleService(nowCycles);
				return;
			}
			this.cancelService();
			return;
		}
		if (this.pendingError !== null || (this.pendingResult !== null && this.pendingEntry !== null)) {
			this.scheduleService(nowCycles);
			return;
		}
		if (this.decodeActive && !this.decodeQueued && this.decodeRemaining > 0) {
			const targetBytes = this.decodeRemaining < IMGDEC_SERVICE_BATCH_BYTES ? this.decodeRemaining : IMGDEC_SERVICE_BATCH_BYTES;
			if (this.availableDecodeBytes >= targetBytes) {
				this.scheduleService(nowCycles);
				return;
			}
			this.scheduleService(nowCycles + this.cyclesUntilDecodeBytes(targetBytes - this.availableDecodeBytes));
			return;
		}
		this.cancelService();
	}

	private cyclesUntilDecodeBytes(targetBytes: number): number {
		const needed = BigInt(targetBytes) * this.cpuHz - this.decodeCarry;
		if (needed <= 0n) {
			return 1;
		}
		const cycles = (needed + this.decodeBytesPerSec - 1n) / this.decodeBytesPerSec;
		const max = BigInt(Number.MAX_SAFE_INTEGER);
		const clamped = cycles > max ? max : cycles;
		const out = Number(clamped);
		return out <= 0 ? 1 : out;
	}
}
