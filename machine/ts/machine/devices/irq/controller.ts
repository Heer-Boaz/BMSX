import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import type { IrqControllerState } from './save_state';

export class IrqController {
	private pendingFlags = 0;
	private mask = 0;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoRead(IO_IRQ_FLAGS, this.onFlagsRead.bind(this));
		this.memory.mapIoWrite(IO_IRQ_ACK, this.onAckWrite.bind(this));
		this.memory.mapIoRead(IO_IRQ_MASK, this.onMaskRead.bind(this));
		this.memory.mapIoWrite(IO_IRQ_MASK, this.onMaskWrite.bind(this));
	}

	public reset(): void {
		this.pendingFlags = 0;
		this.mask = 0;
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
		this.memory.writeIoValue(IO_IRQ_MASK, 0);
	}

	public postLoad(): void {
		const clearAck = 0;
		this.memory.writeIoValue(IO_IRQ_ACK, clearAck);
		this.memory.writeIoValue(IO_IRQ_MASK, this.mask);
	}

	public captureState(): IrqControllerState {
		return {
			mask: this.mask,
			pendingFlags: this.pendingFlags,
		};
	}

	public restoreState(state: IrqControllerState): void {
		this.mask = state.mask >>> 0;
		this.pendingFlags = state.pendingFlags >>> 0;
		this.postLoad();
	}

	public hasAssertedMaskableInterruptLine(): boolean {
		return (this.pendingFlags & this.mask) !== 0;
	}

	public raise(mask: number): void {
		const next = (this.pendingFlags | (mask >>> 0)) >>> 0;
		if (next !== this.pendingFlags) {
			this.pendingFlags = next;
		}
	}

	public acknowledge(mask: number): void {
		const ack = mask >>> 0;
		if (ack !== 0) {
			const next = (this.pendingFlags & ~ack) >>> 0;
			if (next !== this.pendingFlags) {
				this.pendingFlags = next;
			}
		}
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	private onFlagsRead(): Value {
		return this.pendingFlags;
	}

	private onAckWrite(_addr: number, value: Value): void {
		this.acknowledge(value as number);
	}

	private onMaskRead(): Value {
		return this.mask;
	}

	private onMaskWrite(_addr: number, value: Value): void {
		this.mask = (value as number) >>> 0;
	}
}
