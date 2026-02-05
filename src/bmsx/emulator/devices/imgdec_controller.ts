import { taskGate } from '../../core/taskgate';
import { decodePngToRgba } from '../../utils/image_decode';
import {
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
	IMG_STATUS_CLIPPED,
	IMG_STATUS_DONE,
	IMG_STATUS_ERROR,
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
import type { AssetEntry, ImageWriteEntry, ImageWritePlan } from '../memory';
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

type ImgDecEntry = AssetEntry | ImageWriteEntry;

const isAssetEntry = (entry: ImgDecEntry): entry is AssetEntry => (entry as AssetEntry).id !== undefined;

export class ImgDecController {
	private readonly gate = taskGate.group('imgdec');
	private active = false;
	private status = 0;
	private pendingError: unknown = null;
	private pendingResult: DecodedImage | null = null;
	private pendingEntry: ImgDecEntry | null = null;
	private pendingCap = 0;
	private decodeBudget = 0;
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
	private readonly externalSlots = new Map<number, ImageWriteEntry>();

	public constructor(
		private readonly memory: Memory,
		private readonly dma: DmaController,
		private readonly raiseIrq: (mask: number) => void,
	) {}

	public setDecodeBudget(bytesPerTick: number): void {
		this.decodeBudget = bytesPerTick;
	}

	public registerExternalSlot(baseAddr: number, entry: ImageWriteEntry): void {
		this.externalSlots.set(baseAddr, entry);
	}

	public clearExternalSlots(): void {
		this.externalSlots.clear();
	}

	public decodeToVram(params: { bytes: Uint8Array; dst: number; cap: number }): Promise<{ pixels: Uint8Array; width: number; height: number; clipped: boolean }> {
		return new Promise((resolve, reject) => {
			this.queuedJobs.push({ buffer: params.bytes, dst: params.dst, cap: params.cap, resolve, reject });
			this.tryStart();
		});
	}

	public reset(): void {
		this.decodeToken += 1;
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
		this.memory.writeValue(IO_IMG_SRC, 0);
		this.memory.writeValue(IO_IMG_LEN, 0);
		this.memory.writeValue(IO_IMG_DST, 0);
		this.memory.writeValue(IO_IMG_CAP, 0);
		this.memory.writeValue(IO_IMG_CTRL, 0);
		this.memory.writeValue(IO_IMG_STATUS, 0);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
	}

	public tick(): void {
		this.tryStart();
		if (!this.active) {
			return;
		}
		if (this.pendingError !== null) {
			const error = this.pendingError;
			this.pendingError = null;
			this.finishError(error);
			return;
		}
		if (this.pendingResult !== null && this.pendingEntry !== null) {
			const result = this.pendingResult;
			const entry = this.pendingEntry;
			this.pendingResult = null;
			this.pendingEntry = null;
			this.beginDecode(result, entry);
		}
		if (this.decodeActive) {
			this.advanceDecode();
		}
	}

	private tryStart(): void {
		const ctrlValue = this.memory.readValue(IO_IMG_CTRL) as number;
		const ctrl = ctrlValue >>> 0;
		if ((ctrl & IMG_CTRL_START) !== 0) {
			if (this.active) {
				this.memory.writeValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
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
			return;
		}
		if (this.active) {
			return;
		}
		if (this.queuedJobs.length === 0) {
			return;
		}
		const job = this.queuedJobs.shift()!;
		this.startJob({ buffer: job.buffer, dst: job.dst, cap: job.cap, src: 0, len: job.buffer.byteLength, job, signalIrq: false });
	}

	private resolveSlotEntry(dst: number): ImgDecEntry {
		const external = this.externalSlots.get(dst);
		if (external) {
			return external;
		}
		if (dst === VRAM_PRIMARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		}
		if (dst === VRAM_SECONDARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		}
		if (dst === VRAM_SYSTEM_ATLAS_BASE) {
			return this.memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
		}
		throw new Error(`[ImgDec] Unsupported destination address ${dst}.`);
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

		let entry: ImgDecEntry;
		try {
			entry = this.resolveSlotEntry(params.dst);
		} catch (error) {
			this.finishError(error);
			return;
		}
		const effectiveCap = Math.min(params.cap, entry.capacity);
		if (effectiveCap === 0) {
			this.finishError(new Error(`[ImgDec] Invalid destination capacity ${params.cap}.`));
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
		}).catch((error) => {
			if (token !== this.decodeToken) {
				return;
			}
			this.pendingError = error;
		});
	}

	private beginDecode(result: DecodedImage, entry: ImgDecEntry): void {
		const cap = this.pendingCap;
		this.pendingCap = 0;
		const plan = isAssetEntry(entry)
			? this.memory.planImageSlotWrite(entry, { pixels: result.pixels, width: result.width, height: result.height, capacity: cap })
			: this.memory.planImageWrite(entry, { pixels: result.pixels, width: result.width, height: result.height, capacity: cap });
		this.decodePlan = plan;
		this.decodePixels = result.pixels;
		this.decodeResult = result;
		this.decodeRemaining = plan.writeSize;
		this.decodeActive = true;
		this.decodeQueued = false;
		if (plan.writeSize === 0) {
			this.finishSuccess(plan.clipped);
		}
	}

	private advanceDecode(): void {
		const budget = this.decodeBudget;
		if (this.decodeRemaining > 0 && budget > 0) {
			const consume = this.decodeRemaining > budget ? budget : this.decodeRemaining;
			this.decodeRemaining -= consume;
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
				this.finishError();
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
	}

	private finishError(error?: unknown): void {
		const job = this.activeJob;
		this.activeJob = null;
		this.decodeResult = null;
		this.active = false;
		this.decodeActive = false;
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
			job.reject(error ?? new Error('[ImgDec] Decode failed.'));
		}
	}
}
