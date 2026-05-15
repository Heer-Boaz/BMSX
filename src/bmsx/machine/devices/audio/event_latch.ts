import {
	APU_EVENT_NONE,
	type ApuAudioSlot,
} from './contracts';
import {
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IRQ_APU,
} from '../../bus/io';
import type { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';

export type ApuEventLatchState = {
	eventSequence: number;
	eventKind: number;
	eventSlot: number;
	eventSourceAddr: number;
};

export class ApuEventLatch {
	private eventSequence = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
	) {}

	public reset(): void {
		this.eventSequence = 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	public captureState(): ApuEventLatchState {
		return {
			eventSequence: this.eventSequence,
			eventKind: this.memory.readIoU32(IO_APU_EVENT_KIND),
			eventSlot: this.memory.readIoU32(IO_APU_EVENT_SLOT),
			eventSourceAddr: this.memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR),
		};
	}

	public restoreState(state: ApuEventLatchState): void {
		this.eventSequence = state.eventSequence >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, state.eventKind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, state.eventSlot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, state.eventSourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
	}

	public emit(kind: number, slot: ApuAudioSlot, sourceAddr: number): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}
}
