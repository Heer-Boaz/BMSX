import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import type { IrqControllerState } from './save_state';

export class IrqController {
	private pendingFlags = 0;
	private mask = 0;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoRead(IO_IRQ_FLAGS, this, IrqController.onFlagsReadThunk);
		this.memory.mapIoWrite(IO_IRQ_ACK, this, IrqController.onAckWriteThunk);
		this.memory.mapIoRead(IO_IRQ_MASK, this, IrqController.onMaskReadThunk);
		this.memory.mapIoWrite(IO_IRQ_MASK, this, IrqController.onMaskWriteThunk);
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

	private static onFlagsReadThunk(context: IrqController, addr: number): Value {
		void addr;
		return context.pendingFlags;
	}

	private static onAckWriteThunk(context: IrqController, addr: number, value: Value): void {
		void addr;
		const ack = (value as number) >>> 0;
		if (ack !== 0) {
			const next = (context.pendingFlags & ~ack) >>> 0;
			if (next !== context.pendingFlags) {
				context.pendingFlags = next;
			}
		}
		context.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	private static onMaskReadThunk(context: IrqController, addr: number): Value {
		void addr;
		return context.mask;
	}

	private static onMaskWriteThunk(context: IrqController, addr: number, value: Value): void {
		void addr;
		context.mask = (value as number) >>> 0;
	}
}
