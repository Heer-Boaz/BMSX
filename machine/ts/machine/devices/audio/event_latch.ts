import { APU_EVENT_NONE } from '../../../spec/audio/apu';
import { type ApuAudioSlot } from './contracts';
import {
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IRQ_APU,
} from '../../../spec/bmsx/io';
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
	private eventKind = APU_EVENT_NONE;
	private eventSlot = 0;
	private eventSourceAddr = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
	) {}

	public reset(): void {
		this.eventSequence = 0;
		this.eventKind = APU_EVENT_NONE;
		this.eventSlot = 0;
		this.eventSourceAddr = 0;
		this.mirrorRegisters();
	}

	public captureState(): ApuEventLatchState {
		return {
			eventSequence: this.eventSequence,
			eventKind: this.eventKind,
			eventSlot: this.eventSlot,
			eventSourceAddr: this.eventSourceAddr,
		};
	}

	public restoreState(state: ApuEventLatchState): void {
		this.eventSequence = state.eventSequence >>> 0;
		this.eventKind = state.eventKind;
		this.eventSlot = state.eventSlot;
		this.eventSourceAddr = state.eventSourceAddr;
		this.mirrorRegisters();
	}

	public emit(kind: number, slot: ApuAudioSlot, sourceAddr: number): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.eventKind = kind;
		this.eventSlot = slot;
		this.eventSourceAddr = sourceAddr;
		this.mirrorRegisters();
		this.irq.raiseUser(IRQ_APU);
	}

	private mirrorRegisters(): void {
		this.memory.writeIoU32(IO_APU_EVENT_KIND, this.eventKind);
		this.memory.writeIoU32(IO_APU_EVENT_SLOT, this.eventSlot);
		this.memory.writeIoU32(IO_APU_EVENT_SOURCE_ADDR, this.eventSourceAddr);
		this.memory.writeIoU32(IO_APU_EVENT_SEQ, this.eventSequence);
	}
}
