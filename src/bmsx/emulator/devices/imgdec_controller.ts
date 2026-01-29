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
	VRAM_ENGINE_ATLAS_BASE,
} from '../memory_map';
import { ATLAS_PRIMARY_SLOT_ID, ATLAS_SECONDARY_SLOT_ID, ENGINE_ATLAS_INDEX, generateAtlasName } from '../../rompack/rompack';
import type { ImageWritePlan, AssetEntry } from '../memory';
import { Memory } from '../memory';
import type { DecodedImage } from '../../utils/image_decode';
import { DmaController } from './dma_controller';

export class ImgDecController {
	private readonly gate = taskGate.group('imgdec');
	private active = false;
	private status = 0;
	private pendingError: unknown = null;
	private pendingResult: DecodedImage | null = null;
	private pendingEntry: AssetEntry | null = null;
	private pendingCap = 0;
	private decodeBudget = 0;
	private decodeActive = false;
	private decodeRemaining = 0;
	private decodePlan: ImageWritePlan | null = null;
	private decodePixels: Uint8Array | null = null;
	private decodeQueued = false;
	private decodeToken = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly dma: DmaController,
		private readonly raiseIrq: (mask: number) => void,
	) {}

	public setDecodeBudget(bytesPerTick: number): void {
		this.decodeBudget = bytesPerTick;
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
		this.decodeQueued = false;
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
			this.pendingError = null;
			this.finishError();
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
		if ((ctrlValue & IMG_CTRL_START) === 0) {
			return;
		}
		const ctrl = ctrlValue >>> 0;
		if (this.active) {
			this.memory.writeValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
			return;
		}
		const src = (this.memory.readValue(IO_IMG_SRC) as number) >>> 0;
		const len = (this.memory.readValue(IO_IMG_LEN) as number) >>> 0;
		const dst = (this.memory.readValue(IO_IMG_DST) as number) >>> 0;
		const cap = (this.memory.readValue(IO_IMG_CAP) as number) >>> 0;
		this.memory.writeValue(IO_IMG_CTRL, ctrl & ~IMG_CTRL_START);
		this.pendingResult = null;
		this.pendingError = null;
		this.pendingEntry = null;
		this.status = IMG_STATUS_BUSY;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);

		let entry: AssetEntry;
		try {
			entry = this.resolveSlotEntry(dst);
		} catch (error) {
			this.finishError();
			return;
		}
		const effectiveCap = Math.min(cap, entry.capacity);
		if (effectiveCap === 0) {
			this.finishError();
			return;
		}
		this.pendingCap = effectiveCap;
		let buffer: Uint8Array;
		try {
			const bytes = this.memory.readBytes(src, len);
			const copy = new Uint8Array(bytes.byteLength);
			copy.set(bytes);
			buffer = copy;
		} catch (error) {
			this.finishError();
			return;
		}
		this.active = true;
		this.decodeActive = false;
		this.decodeRemaining = 0;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeQueued = false;
		const token = this.decodeToken + 1;
		this.decodeToken = token;
		const promise = this.gate.track(decodePngToRgba(buffer), { blocking: false, category: 'texture', tag: 'imgdec' });
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

	private resolveSlotEntry(dst: number): AssetEntry {
		if (dst === VRAM_PRIMARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		}
		if (dst === VRAM_SECONDARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		}
		if (dst === VRAM_ENGINE_ATLAS_BASE) {
			return this.memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
		}
		throw new Error(`[ImgDec] Unsupported destination address ${dst}.`);
	}

	private beginDecode(result: DecodedImage, entry: AssetEntry): void {
		const cap = this.pendingCap;
		this.pendingCap = 0;
		const plan = this.memory.planImageSlotWrite(entry, { pixels: result.pixels, width: result.width, height: result.height, capacity: cap });
		this.decodePlan = plan;
		this.decodePixels = result.pixels;
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
		this.active = false;
		this.decodeActive = false;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | (clipped ? IMG_STATUS_CLIPPED : 0);
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.raiseIrq(IRQ_IMG_DONE);
	}

	private finishError(): void {
		this.active = false;
		this.decodeActive = false;
		this.decodePlan = null;
		this.decodePixels = null;
		this.decodeRemaining = 0;
		this.decodeQueued = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.raiseIrq(IRQ_IMG_ERROR);
	}
}
