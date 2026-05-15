import { toSignedWord } from '../../common/numeric';
import { IO_APU_SELECTED_SLOT_REG0, IO_APU_SLOT, IO_ARG_STRIDE } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import type { Memory } from '../../memory/memory';
import type { DeviceScheduler } from '../../scheduler/device';
import type { DeviceStatusLatch } from '../device_status';
import type { ApuActiveSlots } from './active_slots';
import type { ApuCommandFifo } from './command_fifo';
import type { ApuOutputMixer } from './output';
import type { ApuSelectedSlotLatch } from './selected_slot_latch';
import type { ApuServiceClock } from './service_clock';
import {
	ApuSourceDma,
	apuParameterProgramsSourceBuffer,
	resolveApuAudioSource,
	type ApuSourceDmaResult,
} from './source';
import type { ApuSlotBank } from './slot_bank';
import {
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_NONE,
	APU_PARAMETER_FADE_SAMPLES_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SLOT_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
	type ApuVoiceId,
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

	public replayHostOutput(slot: ApuAudioSlot, voiceId: ApuVoiceId): boolean {
		const registerWords = this.slotRegisterDispatchWords;
		this.slots.loadRegisterWords(slot, registerWords);
		const fadeSamples = this.slots.fadeSamplesRemaining(slot);
		return this.playOutputVoice(slot, voiceId, resolveApuAudioSource(registerWords), registerWords, fadeSamples);
	}

	public onSelectedSlotRegisterRead(addr: number): number {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			return 0;
		}
		const parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE;
		return this.slots.registerWord(slot, parameterIndex);
	}

	public onSelectedSlotRegisterWrite(addr: number, value: Value): void {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			this.fault.raise(APU_FAULT_BAD_SLOT, slot);
			return;
		}
		this.writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE, (value as number) >>> 0);
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

	private readSlot(registerWords: ApuParameterRegisterWords): ApuAudioSlot | undefined {
		const slot = registerWords[APU_PARAMETER_SLOT_INDEX]!;
		if (slot >= APU_SLOT_COUNT) {
			this.fault.raise(APU_FAULT_BAD_SLOT, slot);
			return undefined;
		}
		return slot;
	}

	private play(registerWords: ApuParameterRegisterWords): void {
		const source = resolveApuAudioSource(registerWords);
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		this.startPlay(source, slot, registerWords);
	}

	private startPlay(source: ApuAudioSource, slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): void {
		if (!this.replaceSlotSourceDma(slot, source)) {
			return;
		}
		const voiceId = this.slots.allocateVoiceId();
		this.activeSlots.setActive(slot, registerWords, voiceId);
		if (!this.playOutputVoice(slot, voiceId, source, registerWords, 0)) {
			return;
		}
		this.serviceClock.scheduleNext(this.scheduler.currentNowCycles());
	}

	private stopSlot(registerWords: ApuParameterRegisterWords): void {
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		const fadeSamples = registerWords[APU_PARAMETER_FADE_SAMPLES_INDEX]!;
		if ((this.slots.activeMask & (1 << slot)) === 0) {
			this.audioOutput.stopSlot(slot);
			this.activeSlots.stop(slot);
			return;
		}
		if (fadeSamples > 0) {
			this.slots.setFadeSamples(slot, fadeSamples);
			this.activeSlots.setPhase(slot, APU_SLOT_PHASE_FADING);
			this.audioOutput.stopSlot(slot, fadeSamples);
			this.serviceClock.scheduleNext(this.scheduler.currentNowCycles());
			return;
		}
		this.audioOutput.stopSlot(slot);
		this.activeSlots.stop(slot);
		this.serviceClock.scheduleNext(this.scheduler.currentNowCycles());
	}

	private setSlotGain(registerWords: ApuParameterRegisterWords): void {
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		this.writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
	}

	private replaceSlotSourceDma(slot: ApuAudioSlot, source: ApuAudioSource): boolean {
		this.audioOutput.stopSlot(slot);
		const dma: ApuSourceDmaResult = this.sourceDma.loadSlot(slot, source);
		if (dma.faultCode !== APU_FAULT_NONE) {
			this.activeSlots.stop(slot);
			this.fault.raise(dma.faultCode, dma.faultDetail);
			return false;
		}
		return true;
	}

	private writeSlotRegisterWord(slot: ApuAudioSlot, parameterIndex: number, word: number): void {
		this.slots.writeRegisterWord(slot, parameterIndex, word);
		if ((this.slots.activeMask & (1 << slot)) !== 0) {
			this.slots.loadRegisterWords(slot, this.slotRegisterDispatchWords);
			const source = resolveApuAudioSource(this.slotRegisterDispatchWords);
			const fadeSamples = this.slots.fadeSamplesRemaining(slot);
			if (apuParameterProgramsSourceBuffer(parameterIndex)) {
				if (!this.replaceSlotSourceDma(slot, source)) {
					return;
				}
				const voiceId = this.slots.allocateVoiceId();
				this.slots.assignVoiceId(slot, voiceId);
				if (!this.playOutputVoice(slot, voiceId, source, this.slotRegisterDispatchWords, fadeSamples)) {
					return;
				}
				this.serviceClock.scheduleNext(this.scheduler.currentNowCycles());
			} else {
				const outputRegisterWords = fadeSamples > 0
					? this.fadeOutputRegisterWords(slot, this.slotRegisterDispatchWords)
					: this.slotRegisterDispatchWords;
				const outputWrite = this.audioOutput.writeSlotRegisterWord(
					slot,
					source,
					outputRegisterWords,
					parameterIndex,
					this.slots.playbackCursorQ16(slot),
				);
				if (outputWrite.faultCode !== APU_FAULT_NONE) {
					this.audioOutput.stopSlot(slot);
					this.activeSlots.stop(slot);
					this.fault.raise(outputWrite.faultCode, outputWrite.faultDetail);
				}
			}
		}
		this.selectedSlotLatch.refresh();
	}

	private playOutputVoice(slot: ApuAudioSlot, voiceId: ApuVoiceId, source: ApuAudioSource, registerWords: ApuParameterRegisterWords, fadeSamples: number): boolean {
		const outputRegisterWords = fadeSamples > 0
			? this.fadeOutputRegisterWords(slot, registerWords)
			: registerWords;
		const outputStart = this.audioOutput.playVoice(
			slot,
			voiceId,
			source,
			this.sourceDma.bytesForSlot(slot),
			outputRegisterWords,
			this.slots.playbackCursorQ16(slot),
			fadeSamples,
		);
		if (outputStart.faultCode !== APU_FAULT_NONE) {
			this.audioOutput.stopSlot(slot);
			this.activeSlots.stop(slot);
			this.fault.raise(outputStart.faultCode, outputStart.faultDetail);
			return false;
		}
		return true;
	}

	private fadeOutputRegisterWords(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): ApuParameterRegisterWords {
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterDispatchWords[index] = registerWords[index]!;
		}
		const gainQ12 = toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
		const scaledGain = gainQ12 * this.slots.fadeSamplesRemaining(slot);
		const fadeTotal = this.slots.fadeSamplesTotal(slot);
		this.slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = ((scaledGain - scaledGain % fadeTotal) / fadeTotal) >>> 0;
		return this.slotRegisterDispatchWords;
	}
}
