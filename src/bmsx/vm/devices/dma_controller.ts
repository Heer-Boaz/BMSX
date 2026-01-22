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
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
} from '../vm_io';
import {
	OVERLAY_ROM_BASE,
	OVERLAY_ROM_SIZE,
	RAM_BASE,
	RAM_USED_END,
	VRAM_ENGINE_ATLAS_BASE,
	VRAM_ENGINE_ATLAS_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
} from '../memory_map';
import { VmMemory } from '../vm_memory';

const DMA_BYTES_PER_TICK = 0x80000;

export class DmaController {
	private active = false;
	private src = 0;
	private dst = 0;
	private remaining = 0;
	private written = 0;
	private status = 0;
	private clipped = false;
	private strict = false;

	public constructor(
		private readonly memory: VmMemory,
		private readonly raiseIrq: (mask: number) => void,
	) {}

	public tick(): void {
		this.tryStart();
		if (!this.active) {
			return;
		}
		const chunk = this.remaining > DMA_BYTES_PER_TICK ? DMA_BYTES_PER_TICK : this.remaining;
		if (chunk > 0) {
			try {
				const bytes = this.memory.readBytes(this.src, chunk);
				this.memory.writeBytes(this.dst, bytes);
			} catch {
				this.finishError();
				return;
			}
			this.src += chunk;
			this.dst += chunk;
			this.remaining -= chunk;
			this.written += chunk;
			this.memory.writeValue(IO_DMA_WRITTEN, this.written);
		}
		if (this.remaining === 0) {
			this.finishSuccess();
		}
	}

	private tryStart(): void {
		const ctrlValue = this.memory.readValue(IO_DMA_CTRL) as number;
		if ((ctrlValue & DMA_CTRL_START) === 0) {
			return;
		}
		const ctrl = ctrlValue >>> 0;
		if (this.active) {
			this.memory.writeValue(IO_DMA_CTRL, ctrl & ~DMA_CTRL_START);
			return;
		}
		const src = (this.memory.readValue(IO_DMA_SRC) as number) >>> 0;
		const dst = (this.memory.readValue(IO_DMA_DST) as number) >>> 0;
		const len = (this.memory.readValue(IO_DMA_LEN) as number) >>> 0;
		this.strict = (ctrl & DMA_CTRL_STRICT) !== 0;
		this.clipped = false;
		this.src = src;
		this.dst = dst;
		this.written = 0;
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
		this.memory.writeValue(IO_DMA_CTRL, ctrl & ~DMA_CTRL_START);

		const maxWritable = this.resolveMaxWritable(dst);
		if (maxWritable <= 0) {
			this.finishError();
			return;
		}
		let transferLen = len;
		if (transferLen > maxWritable) {
			this.clipped = true;
			if (this.strict) {
				this.finishError();
				return;
			}
			transferLen = maxWritable;
		}
		this.remaining = transferLen;
		this.status = DMA_STATUS_BUSY | (this.clipped ? DMA_STATUS_CLIPPED : 0);
		this.memory.writeValue(IO_DMA_STATUS, this.status);
		this.active = true;
		if (this.remaining === 0) {
			this.finishSuccess();
		}
	}

	private resolveMaxWritable(dst: number): number {
		if (dst >= VRAM_ENGINE_ATLAS_BASE && dst < VRAM_ENGINE_ATLAS_BASE + VRAM_ENGINE_ATLAS_SIZE) {
			return (VRAM_ENGINE_ATLAS_BASE + VRAM_ENGINE_ATLAS_SIZE) - dst;
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
		if (dst >= OVERLAY_ROM_BASE && dst < OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) {
			return (OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) - dst;
		}
		if (dst >= RAM_BASE && dst < RAM_USED_END) {
			return RAM_USED_END - dst;
		}
		return 0;
	}

	private finishSuccess(): void {
		this.active = false;
		this.status = (this.status & ~DMA_STATUS_BUSY) | DMA_STATUS_DONE;
		if (this.clipped) {
			this.status |= DMA_STATUS_ERROR | DMA_STATUS_CLIPPED;
			this.memory.writeValue(IO_DMA_STATUS, this.status);
			this.raiseIrq(IRQ_DMA_ERROR);
			return;
		}
		this.memory.writeValue(IO_DMA_STATUS, this.status);
		this.raiseIrq(IRQ_DMA_DONE);
	}

	private finishError(): void {
		this.active = false;
		this.status = (this.status & ~DMA_STATUS_BUSY) | DMA_STATUS_DONE | DMA_STATUS_ERROR;
		this.memory.writeValue(IO_DMA_STATUS, this.status);
		this.raiseIrq(IRQ_DMA_ERROR);
	}
}
