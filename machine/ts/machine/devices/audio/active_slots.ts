import { IO_APU_ACTIVE_MASK } from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';
import type { ApuEventLatch } from './event_latch';
import type { ApuOutputMixer } from './output';
import type { ApuSelectedSlotLatch } from './selected_slot_latch';
import type { ApuSlotBank } from './slot_bank';
import {
	APU_EVENT_SLOT_ENDED,
	APU_SLOT_COUNT,
} from '../../../spec/audio/apu';
import {
	APU_SLOT_PHASE_IDLE,
	type ApuAudioSlot,
	type ApuParameterRegisterWords,
	type ApuSlotPhase,
} from './contracts';

export class ApuActiveSlots {
	public constructor(
		private readonly memory: Memory,
		private readonly audioOutput: ApuOutputMixer,
		private readonly eventLatch: ApuEventLatch,
		private readonly slots: ApuSlotBank,
		private readonly selectedSlotLatch: ApuSelectedSlotLatch,
	) {}

	public writeActiveMask(): void {
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.selectedSlotLatch.refresh();
	}

	public setActive(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): void {
		this.slots.setActive(slot, registerWords);
		this.writeActiveMask();
	}

	public stop(slot: ApuAudioSlot): void {
		this.slots.clearSlot(slot);
		this.writeActiveMask();
	}

	public deactivate(slot: ApuAudioSlot): void {
		this.slots.setPhase(slot, APU_SLOT_PHASE_IDLE);
		this.writeActiveMask();
	}

	public setPhase(slot: ApuAudioSlot, phase: ApuSlotPhase): void {
		this.slots.setPhase(slot, phase);
		this.writeActiveMask();
	}

	public advance(samples: number, startSequence: number): void {
		const endedMask = this.audioOutput.renderMachineFrames(samples, startSequence);
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			if ((endedMask & (1 << slot)) !== 0) {
				const sourceAddr = this.slots.sourceAddr(slot);
				this.stop(slot);
				this.eventLatch.emit(APU_EVENT_SLOT_ENDED, slot, sourceAddr);
			}
		}
	}
}
