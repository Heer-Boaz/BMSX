import { IO_APU_ACTIVE_MASK } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import type { ApuEventLatch } from './event_latch';
import type { ApuOutputMixer } from './output';
import type { ApuSelectedSlotLatch } from './selected_slot_latch';
import type { ApuSourceDma } from './source';
import type { ApuSlotAdvanceResult, ApuSlotBank } from './slot_bank';
import {
	APU_EVENT_SLOT_ENDED,
	APU_SLOT_COUNT,
	type ApuAudioSlot,
	type ApuParameterRegisterWords,
	type ApuSlotPhase,
	type ApuVoiceId,
} from './contracts';

export class ApuActiveSlots {
	private readonly advanceResult: ApuSlotAdvanceResult = { ended: false, voiceId: 0, sourceAddr: 0 };
	public constructor(
		private readonly memory: Memory,
		private readonly audioOutput: ApuOutputMixer,
		private readonly sourceDma: ApuSourceDma,
		private readonly eventLatch: ApuEventLatch,
		private readonly slots: ApuSlotBank,
		private readonly selectedSlotLatch: ApuSelectedSlotLatch,
	) {}

	public writeActiveMask(): void {
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.selectedSlotLatch.refresh();
	}

	public setActive(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords, voiceId: ApuVoiceId): void {
		this.slots.setActive(slot, registerWords, voiceId);
		this.writeActiveMask();
	}

	public stop(slot: ApuAudioSlot): void {
		this.slots.clearSlot(slot);
		this.sourceDma.clearSlot(slot);
		this.writeActiveMask();
	}

	public setPhase(slot: ApuAudioSlot, phase: ApuSlotPhase): void {
		this.slots.setPhase(slot, phase);
		this.writeActiveMask();
	}

	public advance(samples: number): void {
		const result = this.advanceResult;
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slots.advanceSlot(slot, samples, result);
			if (result.ended) {
				this.audioOutput.stopSlot(slot);
				this.emitSlotEvent(slot, result.voiceId, result.sourceAddr);
			}
		}
	}

	private emitSlotEvent(slot: ApuAudioSlot, voiceId: ApuVoiceId, sourceAddr: number): void {
		if (this.slots.voiceId(slot) !== voiceId) {
			return;
		}
		this.stop(slot);
		this.eventLatch.emit(APU_EVENT_SLOT_ENDED, slot, sourceAddr);
	}

}
