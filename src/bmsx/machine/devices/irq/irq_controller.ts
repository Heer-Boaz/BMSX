import { IO_IRQ_ACK, IO_IRQ_FLAGS } from '../../bus/io';
import { Memory } from '../../memory/memory';

export class IrqController {
	private _signalSequence = 0;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoWrite(IO_IRQ_ACK, this.onAckWrite.bind(this));
	}

	public get signalSequence(): number {
		return this._signalSequence;
	}

	public reset(): void {
		this._signalSequence = 0;
		this.memory.writeIoValue(IO_IRQ_FLAGS, 0);
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	public postLoad(): void {
		this._signalSequence = 0;
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	public pendingFlags(): number {
		return this.memory.readIoU32(IO_IRQ_FLAGS);
	}

	public raise(mask: number): void {
		const current = this.memory.readIoU32(IO_IRQ_FLAGS);
		const next = (current | (mask >>> 0)) >>> 0;
		this.memory.writeIoValue(IO_IRQ_FLAGS, next);
		if (next !== current) {
			this._signalSequence += 1;
		}
	}

	public acknowledge(mask: number): void {
		const ack = mask >>> 0;
		if (ack !== 0) {
			this.memory.writeIoValue(IO_IRQ_FLAGS, (this.memory.readIoU32(IO_IRQ_FLAGS) & ~ack) >>> 0);
		}
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	private onAckWrite(): void {
		this.acknowledge(this.memory.readIoU32(IO_IRQ_ACK));
	}
}
