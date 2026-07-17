import { IO_APU_SELECTED_SLOT_REG0, IO_APU_SLOT, IO_ARG_STRIDE } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import type { Memory } from '../../memory/memory';
import type { DeviceScheduler } from '../../scheduler/device';
import type { DeviceStatusLatch } from '../device_status';
import type { ApuActiveSlots } from './active_slots';
import type { ApuCommandFifo } from './command_fifo';
import type { ApuOutputMixer } from './output';
import { ApuSelectedSlotLatch } from './selected_slot_latch';
import type { ApuServiceClock } from './service_clock';
import {
	ApuSourceDma,
	apuParameterProgramsSourceBuffer,
	resolveApuAudioSource,
} from './source';
import type { ApuOutputVoiceState } from './save_state';
import type { ApuSlotBank } from './slot_bank';
import {
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_FAULT_BAD_CMD,
	APU_PARAMETER_FADE_SAMPLES_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SLOT_INDEX,
	APU_SLOT_INDEX_MASK,
	APU_SLOT_PHASE_FADING,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
} from './contracts';

export class ApuCommandExecutor {
	private readonly commandDispatchRegisterWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
	private readonly slotRegisterDispatchWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);

	public constructor(
		private readonly memory: Memory,
		private readonly audioOutput: ApuOutputMixer,
		private readonly scheduler: DeviceScheduler,
		private readonly commandFifo: ApuCommandFifo,
		private readonly sourceDma: ApuSourceDma,
		private readonly activeSlots: ApuActiveSlots,
		private readonly slots: ApuSlotBank,
		private readonly selectedSlotLatch: ApuSelectedSlotLatch,
		private readonly fault: DeviceStatusLatch,
		private readonly serviceClock: ApuServiceClock,
	) {}

	public drainCommandFifo(): void {
		while (!this.commandFifo.empty) {
			const command = this.commandFifo.popInto(this.commandDispatchRegisterWords);
			this.executeCommand(command, this.commandDispatchRegisterWords);
		}
	}

	public restoreOutputVoice(state: ApuOutputVoiceState): void {
		const slot = state.slot;
		const registerWords = this.slotRegisterDispatchWords;
		this.slots.loadRegisterWords(slot, registerWords);
		this.audioOutput.restoreVoice(
			slot,
			resolveApuAudioSource(registerWords),
			this.sourceDma.bytesForSlot(slot),
			registerWords,
			state,
		);
	}

	public static selectedSlotRegisterReadThunk(context: ApuCommandExecutor, addr: number): number {
		const nowCycles = context.scheduler.currentNowCycles();
		context.serviceClock.synchronize(nowCycles);
		const slot = context.memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
		const parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE;
		return context.slots.registerWord(slot, parameterIndex);
	}

	public static selectedSlotRegisterWriteThunk(context: ApuCommandExecutor, addr: number, value: Value): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.serviceClock.synchronize(nowCycles);
		const slot = context.memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
		context.writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE, (value as number) >>> 0);
		context.serviceClock.scheduleNext(nowCycles);
	}

	private executeCommand(command: number, registerWords: ApuParameterRegisterWords): void {
		switch (command) {
			case APU_CMD_PLAY:
				this.play(registerWords);
				return;
			case APU_CMD_STOP_SLOT:
				this.stopSlot(registerWords);
				return;
			case APU_CMD_SET_SLOT_GAIN:
				this.setSlotGain(registerWords);
				return;
			default:
				this.fault.raise(APU_FAULT_BAD_CMD, command);
				return;
		}
	}

	private play(registerWords: ApuParameterRegisterWords): void {
		const source = resolveApuAudioSource(registerWords);
		const slot = registerWords[APU_PARAMETER_SLOT_INDEX]! & APU_SLOT_INDEX_MASK;
		this.startPlay(source, slot, registerWords);
	}

	private startPlay(source: ApuAudioSource, slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): void {
		this.sourceDma.loadSlot(slot, source);
		this.activeSlots.setActive(slot, registerWords);
		this.audioOutput.playVoice(slot, source, this.sourceDma.bytesForSlot(slot), registerWords);
	}

	private stopSlot(registerWords: ApuParameterRegisterWords): void {
		const slot = registerWords[APU_PARAMETER_SLOT_INDEX]! & APU_SLOT_INDEX_MASK;
		const fadeSamples = registerWords[APU_PARAMETER_FADE_SAMPLES_INDEX]!;
		if ((this.slots.activeMask & (1 << slot)) === 0) {
			this.audioOutput.stopSlot(slot);
			this.activeSlots.stop(slot);
			return;
		}
		if (fadeSamples > 0) {
			this.activeSlots.setPhase(slot, APU_SLOT_PHASE_FADING);
			this.audioOutput.stopSlot(slot, fadeSamples);
			return;
		}
		this.audioOutput.stopSlot(slot);
		this.activeSlots.stop(slot);
	}

	private setSlotGain(registerWords: ApuParameterRegisterWords): void {
		const slot = registerWords[APU_PARAMETER_SLOT_INDEX]! & APU_SLOT_INDEX_MASK;
		this.writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
	}

	private writeSlotRegisterWord(slot: ApuAudioSlot, parameterIndex: number, word: number): void {
		this.slots.writeRegisterWord(slot, parameterIndex, word);
		if ((this.slots.activeMask & (1 << slot)) !== 0) {
			this.slots.loadRegisterWords(slot, this.slotRegisterDispatchWords);
			const source = resolveApuAudioSource(this.slotRegisterDispatchWords);
			if (apuParameterProgramsSourceBuffer(parameterIndex)) {
				this.sourceDma.loadSlot(slot, source);
				this.audioOutput.replaceVoiceSource(slot, source, this.sourceDma.bytesForSlot(slot), this.slotRegisterDispatchWords);
			} else {
				this.audioOutput.writeSlotRegisterWord(
					slot,
					source,
					this.slotRegisterDispatchWords,
					parameterIndex,
				);
			}
		}
		ApuSelectedSlotLatch.refreshThunk(this.selectedSlotLatch);
	}

}
