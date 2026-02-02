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
	IO_IMG_WRITTEN,
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
} from '../io';
import {
	OVERLAY_ROM_BASE,
	OVERLAY_ROM_SIZE,
	RAM_BASE,
	RAM_USED_END,
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SKYBOX_BASE,
	VRAM_SKYBOX_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
} from '../memory_map';
import type { ImageWritePlan } from '../memory';
import { Memory } from '../memory';

type DmaChannelId = 0 | 1;
const DMA_CH_ISO: DmaChannelId = 0;
const DMA_CH_BULK: DmaChannelId = 1;

type DmaJobBase = {
	kind: 'io' | 'image';
	channel: DmaChannelId;
	written: number;
	clipped: boolean;
	error: boolean;
};

type DmaIoJob = DmaJobBase & {
	kind: 'io';
	src: number;
	dst: number;
	remaining: number;
	strict: boolean;
};

type DmaImageJob = DmaJobBase & {
	kind: 'image';
	plan: ImageWritePlan;
	pixels: Uint8Array;
	row: number;
	rowOffset: number;
	vramTarget: boolean;
	onComplete: (result: { error: boolean; clipped: boolean }) => void;
};

type DmaJob = DmaIoJob | DmaImageJob;

type DmaChannelState = {
	budget: number;
	queue: DmaJob[];
	active: DmaJob | null;
};

export class DmaController {
	private readonly channels: [DmaChannelState, DmaChannelState] = [
		{ budget: 0, queue: [], active: null },
		{ budget: 0, queue: [], active: null },
	];
	private ioJobActive = false;
	private ioWrittenValue = 0;
	private ioWrittenDirty = false;
	private imgWrittenValue = 0;
	private imgWrittenDirty = false;

	public constructor(
		private readonly memory: Memory,
		private readonly raiseIrq: (mask: number) => void,
	) {}

	public setChannelBudgets(params: { iso: number; bulk: number }): void {
		this.channels[DMA_CH_ISO].budget = params.iso;
		this.channels[DMA_CH_BULK].budget = params.bulk;
	}

	public reset(): void {
		this.channels[DMA_CH_ISO].queue.length = 0;
		this.channels[DMA_CH_ISO].active = null;
		this.channels[DMA_CH_BULK].queue.length = 0;
		this.channels[DMA_CH_BULK].active = null;
		this.ioJobActive = false;
		this.ioWrittenValue = 0;
		this.ioWrittenDirty = false;
		this.imgWrittenValue = 0;
		this.imgWrittenDirty = false;
		this.memory.writeValue(IO_DMA_SRC, 0);
		this.memory.writeValue(IO_DMA_DST, 0);
		this.memory.writeValue(IO_DMA_LEN, 0);
		this.memory.writeValue(IO_DMA_CTRL, 0);
		this.memory.writeValue(IO_DMA_STATUS, 0);
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
	}

	public enqueueImageCopy(plan: ImageWritePlan, pixels: Uint8Array, onComplete: (result: { error: boolean; clipped: boolean }) => void): void {
		const vramTarget = this.memory.isVramRange(plan.baseAddr, plan.writeSize > 0 ? plan.writeSize : 1);
		const job: DmaImageJob = {
			kind: 'image',
			channel: DMA_CH_BULK,
			plan,
			pixels,
			row: 0,
			rowOffset: 0,
			vramTarget,
			written: 0,
			clipped: plan.clipped,
			error: false,
			onComplete,
		};
		this.channels[DMA_CH_BULK].queue.push(job);
	}

	public tick(): void {
		this.tryStartIo();
		this.tickChannel(DMA_CH_ISO);
		this.tickChannel(DMA_CH_BULK);
		if (this.ioWrittenDirty) {
			this.memory.writeValue(IO_DMA_WRITTEN, this.ioWrittenValue);
			this.ioWrittenDirty = false;
		}
		if (this.imgWrittenDirty) {
			this.memory.writeValue(IO_IMG_WRITTEN, this.imgWrittenValue);
			this.imgWrittenDirty = false;
		}
	}

	private tickChannel(channel: DmaChannelId): void {
		const state = this.channels[channel];
		let budget = state.budget;
		while (budget > 0) {
			if (!state.active) {
				const next = state.queue.shift();
				if (!next) {
					return;
				}
				state.active = next;
			}
			const job = state.active;
			const written = this.processJob(job, budget);
			budget -= written;
			if (job.kind === 'io') {
				this.ioWrittenValue = job.written;
				this.ioWrittenDirty = true;
			}
			if (job.kind === 'image') {
				this.imgWrittenValue = job.written;
				this.imgWrittenDirty = true;
			}
			if (this.isJobComplete(job)) {
				this.finishJob(job);
				state.active = null;
				continue;
			}
			if (written === 0) {
				return;
			}
		}
	}

	private processJob(job: DmaJob, budget: number): number {
		if (job.error) {
			return 0;
		}
		if (job.kind === 'io') {
			let chunk = job.remaining > budget ? budget : job.remaining;
			if (chunk === 0) {
				return 0;
			}
			if (this.memory.isVramRange(job.dst, 1)) {
				chunk &= ~3;
				if (chunk === 0) {
					return 0;
				}
			}
			try {
				const bytes = this.memory.readBytes(job.src, chunk);
				this.memory.writeBytes(job.dst, bytes);
			} catch {
				job.error = true;
				return 0;
			}
			job.src += chunk;
			job.dst += chunk;
			job.remaining -= chunk;
			job.written += chunk;
			return chunk;
		}
		return this.processImageJob(job, budget);
	}

	private processImageJob(job: DmaImageJob, budget: number): number {
		let remaining = budget;
		while (remaining > 0 && job.row < job.plan.writeHeight) {
			const rowRemaining = job.plan.writeStride - job.rowOffset;
			let toCopy = remaining < rowRemaining ? remaining : rowRemaining;
			if (job.vramTarget) {
				toCopy &= ~3;
				if (toCopy === 0) {
					return budget - remaining;
				}
			}
			const srcOffset = job.row * job.plan.sourceStride + job.rowOffset;
			const dstAddr = job.plan.baseAddr + (job.row * job.plan.writeStride) + job.rowOffset;
			try {
				this.memory.writeBytesFrom(job.pixels, srcOffset, dstAddr, toCopy);
			} catch {
				job.error = true;
				return budget - remaining;
			}
			remaining -= toCopy;
			job.rowOffset += toCopy;
			job.written += toCopy;
			if (job.rowOffset >= job.plan.writeStride) {
				job.row += 1;
				job.rowOffset = 0;
			}
		}
		return budget - remaining;
	}

	private isJobComplete(job: DmaJob): boolean {
		if (job.error) {
			return true;
		}
		if (job.kind === 'io') {
			return job.remaining === 0;
		}
		return job.row >= job.plan.writeHeight;
	}

	private finishJob(job: DmaJob): void {
		if (job.kind === 'io') {
			this.finishIoJob(job);
			return;
		}
		job.onComplete({ error: job.error, clipped: job.clipped });
	}

	private tryStartIo(): void {
		const ctrlValue = this.memory.readValue(IO_DMA_CTRL) as number;
		if ((ctrlValue & DMA_CTRL_START) === 0) {
			return;
		}
		const ctrl = ctrlValue >>> 0;
		if (this.ioJobActive) {
			this.memory.writeValue(IO_DMA_CTRL, ctrl & ~DMA_CTRL_START);
			return;
		}
		const src = (this.memory.readValue(IO_DMA_SRC) as number) >>> 0;
		const dst = (this.memory.readValue(IO_DMA_DST) as number) >>> 0;
		const len = (this.memory.readValue(IO_DMA_LEN) as number) >>> 0;
		const strict = (ctrl & DMA_CTRL_STRICT) !== 0;
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
		this.memory.writeValue(IO_DMA_CTRL, ctrl & ~DMA_CTRL_START);
		const maxWritable = this.resolveMaxWritable(dst);
		if (maxWritable <= 0) {
			this.finishIoError(false);
			return;
		}
		let transferLen = len;
		let clipped = false;
		if (transferLen > maxWritable) {
			clipped = true;
			if (strict) {
				this.finishIoError(true);
				return;
			}
			transferLen = maxWritable;
		}
		const status = DMA_STATUS_BUSY | (clipped ? DMA_STATUS_CLIPPED : 0);
		this.memory.writeValue(IO_DMA_STATUS, status);
		if (transferLen === 0) {
			this.finishIoSuccess(clipped);
			return;
		}
		const job: DmaIoJob = {
			kind: 'io',
			channel: DMA_CH_BULK,
			src,
			dst,
			remaining: transferLen,
			written: 0,
			clipped,
			strict,
			error: false,
		};
		this.ioWrittenValue = 0;
		this.ioWrittenDirty = true;
		this.ioJobActive = true;
		this.channels[DMA_CH_BULK].queue.push(job);
	}

	private resolveMaxWritable(dst: number): number {
		if (dst >= VRAM_SYSTEM_ATLAS_BASE && dst < VRAM_SYSTEM_ATLAS_BASE + VRAM_SYSTEM_ATLAS_SIZE) {
			return (VRAM_SYSTEM_ATLAS_BASE + VRAM_SYSTEM_ATLAS_SIZE) - dst;
		}
		if (dst >= VRAM_PRIMARY_ATLAS_BASE && dst < VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) {
			return (VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) - dst;
		}
		if (dst >= VRAM_SECONDARY_ATLAS_BASE && dst < VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) {
			return (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - dst;
		}
		if (dst >= VRAM_STAGING_BASE && dst < VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			return (VRAM_STAGING_BASE + VRAM_STAGING_SIZE) - dst;
		}
		if (dst >= VRAM_SKYBOX_BASE && dst < VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE) {
			return (VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE) - dst;
		}
		if (dst >= OVERLAY_ROM_BASE && dst < OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) {
			return (OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) - dst;
		}
		if (dst >= RAM_BASE && dst < RAM_USED_END) {
			return RAM_USED_END - dst;
		}
		return 0;
	}

	private finishIoJob(job: DmaIoJob): void {
		this.ioJobActive = false;
		if (job.error) {
			this.finishIoError(job.clipped);
			return;
		}
		this.finishIoSuccess(job.clipped);
	}

	private finishIoSuccess(clipped: boolean): void {
		let status = DMA_STATUS_DONE;
		if (clipped) {
			status |= DMA_STATUS_CLIPPED;
		}
		this.memory.writeValue(IO_DMA_STATUS, status);
		this.raiseIrq(IRQ_DMA_DONE);
	}

	private finishIoError(clipped: boolean): void {
		this.ioJobActive = false;
		let status = DMA_STATUS_DONE | DMA_STATUS_ERROR;
		if (clipped) {
			status |= DMA_STATUS_CLIPPED;
		}
		this.memory.writeValue(IO_DMA_STATUS, status);
		this.raiseIrq(IRQ_DMA_ERROR);
	}
}
