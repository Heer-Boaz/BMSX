import { IO_IRQ_ACK, IO_IRQ_FLAGS } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';

export type IrqControllerState = {
	pendingFlags: number;
};

export class IrqController {
	private pendingFlags = 0;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoRead(IO_IRQ_FLAGS, this.onFlagsRead.bind(this));
		this.memory.mapIoWrite(IO_IRQ_ACK, this.onAckWrite.bind(this));
	}

	public reset(): void {
		this.pendingFlags = 0;
		this.clearAckLatch();
	}

	public postLoad(): void {
		this.clearAckLatch();
	}

	public captureState(): IrqControllerState {
		return {
			pendingFlags: this.pendingFlags,
		};
	}

	public restoreState(state: IrqControllerState): void {
		this.pendingFlags = state.pendingFlags >>> 0;
		this.clearAckLatch();
	}

	public hasAssertedMaskableInterruptLine(): boolean {
		return this.pendingFlags !== 0;
	}

	public raise(mask: number): void {
		const next = (this.pendingFlags | (mask >>> 0)) >>> 0;
		if (next !== this.pendingFlags) {
			this.pendingFlags = next;
		}
	}

	private onFlagsRead(): Value {
		return this.pendingFlags;
	}

	private onAckWrite(_addr: number, value: Value): void {
		const ack = (value as number) >>> 0;
		if (ack !== 0) {
			const next = (this.pendingFlags & ~ack) >>> 0;
			if (next !== this.pendingFlags) {
				this.pendingFlags = next;
			}
		}
		this.clearAckLatch();
	}

	private clearAckLatch(): void {
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}
}
