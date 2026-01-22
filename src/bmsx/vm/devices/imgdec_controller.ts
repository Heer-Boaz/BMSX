import { taskGate } from '../../core/taskgate';
import { decodePngToRgba } from '../../utils/image_decode';
import {
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
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
} from '../vm_io';
import {
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_BASE,
} from '../memory_map';
import { ATLAS_PRIMARY_SLOT_ID, ATLAS_SECONDARY_SLOT_ID } from '../../rompack/rompack';
import type { VmAssetEntry } from '../vm_memory';
import { VmMemory } from '../vm_memory';
import type { DecodedImage } from '../../utils/image_decode';

export class ImgDecController {
	private readonly gate = taskGate.group('imgdec');
	private active = false;
	private status = 0;
	private pendingError: unknown = null;
	private pendingResult: DecodedImage | null = null;
	private pendingEntry: VmAssetEntry | null = null;
	private pendingCap = 0;

	public constructor(
		private readonly memory: VmMemory,
		private readonly raiseIrq: (mask: number) => void,
	) {}

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
			this.finishSuccess(result, entry, this.pendingCap);
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
		this.pendingCap = cap;
		this.status = IMG_STATUS_BUSY;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);

		let entry: VmAssetEntry;
		try {
			entry = this.resolveSlotEntry(dst);
		} catch (error) {
			this.finishError();
			return;
		}
		if (cap === 0 || cap > entry.capacity) {
			this.finishError();
			return;
		}
		let buffer: ArrayBuffer;
		try {
			const bytes = this.memory.readBytes(src, len);
			const copy = new Uint8Array(bytes.byteLength);
			copy.set(bytes);
			buffer = copy.buffer;
		} catch (error) {
			this.finishError();
			return;
		}
		this.active = true;
		const promise = this.gate.track(decodePngToRgba(buffer), { blocking: false, category: 'texture', tag: 'imgdec' });
		promise.then((result) => {
			this.pendingResult = result;
			this.pendingEntry = entry;
		}).catch((error) => {
			this.pendingError = error;
		});
	}

	private resolveSlotEntry(dst: number): VmAssetEntry {
		if (dst === VRAM_PRIMARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		}
		if (dst === VRAM_SECONDARY_ATLAS_BASE) {
			return this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		}
		throw new Error(`[ImgDec] Unsupported destination address ${dst}.`);
	}

	private finishSuccess(result: DecodedImage, entry: VmAssetEntry, cap: number): void {
		const bytes = result.pixels.byteLength;
		if (bytes > cap) {
			this.finishError();
			return;
		}
		this.memory.writeImageSlot(entry, { pixels: result.pixels, width: result.width, height: result.height });
		this.memory.writeValue(IO_IMG_WRITTEN, bytes);
		this.active = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.raiseIrq(IRQ_IMG_DONE);
	}

	private finishError(): void {
		this.active = false;
		this.status = (this.status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
		this.memory.writeValue(IO_IMG_STATUS, this.status);
		this.raiseIrq(IRQ_IMG_ERROR);
	}
}
