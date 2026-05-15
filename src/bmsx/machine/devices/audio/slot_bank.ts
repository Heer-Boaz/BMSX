import {
	advanceApuPlaybackCursorQ16,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_SLOT_REGISTER_WORD_COUNT,
	apuSlotRegisterWordIndex,
	type ApuAudioSlot,
	type ApuParameterRegisterWords,
	type ApuSlotPhase,
	type ApuVoiceId,
} from './contracts';
import { toSignedWord } from '../../common/numeric';

export type ApuSlotAdvanceResult = {
	ended: boolean;
	voiceId: ApuVoiceId;
	sourceAddr: number;
};

export class ApuSlotBank {
	private activeMaskWord = 0;
	private readonly slotPhases = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotRegisterWords = new Uint32Array(APU_SLOT_REGISTER_WORD_COUNT);
	private readonly slotPlaybackCursorQ16 = new Array<number>(APU_SLOT_COUNT).fill(0);
	private readonly slotFadeSamplesRemaining = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotFadeSamplesTotal = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotVoiceIds: ApuVoiceId[] = new Array(APU_SLOT_COUNT).fill(0);
	private nextVoiceId: ApuVoiceId = 1;

	public get activeMask(): number {
		return this.activeMaskWord;
	}

	public reset(): void {
		this.activeMaskWord = 0;
		this.slotPhases.fill(APU_SLOT_PHASE_IDLE);
		this.slotRegisterWords.fill(0);
		this.slotPlaybackCursorQ16.fill(0);
		this.slotFadeSamplesRemaining.fill(0);
		this.slotFadeSamplesTotal.fill(0);
		this.resetVoiceIds();
	}

	public resetVoiceIds(): void {
		this.slotVoiceIds.fill(0);
		this.nextVoiceId = 1;
	}

	public allocateVoiceId(): ApuVoiceId {
		const voiceId = this.nextVoiceId;
		this.nextVoiceId += 1;
		return voiceId;
	}

	public assignVoiceId(slot: ApuAudioSlot, voiceId: ApuVoiceId): void {
		this.slotVoiceIds[slot] = voiceId;
	}

	public voiceId(slot: ApuAudioSlot): ApuVoiceId {
		return this.slotVoiceIds[slot]!;
	}

	public phase(slot: ApuAudioSlot): ApuSlotPhase {
		return this.slotPhases[slot]!;
	}

	public setPhase(slot: ApuAudioSlot, phase: ApuSlotPhase): void {
		this.slotPhases[slot] = phase;
		const bit = 1 << slot;
		if (phase === APU_SLOT_PHASE_IDLE) {
			this.activeMaskWord = (this.activeMaskWord & ~bit) >>> 0;
		} else {
			this.activeMaskWord = (this.activeMaskWord | bit) >>> 0;
		}
	}

	public setActive(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords, voiceId: ApuVoiceId): void {
		this.setPhase(slot, APU_SLOT_PHASE_PLAYING);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = registerWords[index] >>> 0;
		}
		this.slotPlaybackCursorQ16[slot] = registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		this.slotFadeSamplesRemaining[slot] = 0;
		this.slotFadeSamplesTotal[slot] = 0;
		this.slotVoiceIds[slot] = voiceId;
	}

	public clearSlot(slot: ApuAudioSlot): void {
		this.setPhase(slot, APU_SLOT_PHASE_IDLE);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = 0;
		}
		this.slotPlaybackCursorQ16[slot] = 0;
		this.slotFadeSamplesRemaining[slot] = 0;
		this.slotFadeSamplesTotal[slot] = 0;
		this.slotVoiceIds[slot] = 0;
	}

	public registerWord(slot: ApuAudioSlot, parameterIndex: number): number {
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)]!;
	}

	public writeRegisterWord(slot: ApuAudioSlot, parameterIndex: number, word: number): void {
		this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)] = word >>> 0;
		if (parameterIndex === APU_PARAMETER_START_SAMPLE_INDEX) {
			this.slotPlaybackCursorQ16[slot] = word * APU_RATE_STEP_Q16_ONE;
		}
	}

	public loadRegisterWords(slot: ApuAudioSlot, out: Uint32Array): void {
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			out[index] = this.slotRegisterWords[base + index]!;
		}
	}

	public playbackCursorQ16(slot: ApuAudioSlot): number {
		return this.slotPlaybackCursorQ16[slot]!;
	}

	public setPlaybackCursorQ16(slot: ApuAudioSlot, cursorQ16: number): void {
		this.slotPlaybackCursorQ16[slot] = cursorQ16;
	}

	public fadeSamplesRemaining(slot: ApuAudioSlot): number {
		return this.slotFadeSamplesRemaining[slot]!;
	}

	public setFadeSamplesRemaining(slot: ApuAudioSlot, samples: number): void {
		this.slotFadeSamplesRemaining[slot] = samples;
	}

	public fadeSamplesTotal(slot: ApuAudioSlot): number {
		return this.slotFadeSamplesTotal[slot]!;
	}

	public setFadeSamples(slot: ApuAudioSlot, samples: number): void {
		this.slotFadeSamplesRemaining[slot] = samples;
		this.slotFadeSamplesTotal[slot] = samples;
	}

	public advanceSlot(slot: ApuAudioSlot, samples: number, out: ApuSlotAdvanceResult): void {
		out.ended = false;
		out.voiceId = 0;
		out.sourceAddr = 0;
		const phase = this.slotPhases[slot]!;
		if (phase === APU_SLOT_PHASE_IDLE) {
			return;
		}
		const base = apuSlotRegisterWordIndex(slot, 0);
		const fadeSamples = this.slotFadeSamplesRemaining[slot]!;
		const voiceId = this.slotVoiceIds[slot]!;
		const sourceAddr = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_ADDR_INDEX]!;
		if (phase === APU_SLOT_PHASE_FADING) {
			const cursorSamples = samples < fadeSamples ? samples : fadeSamples;
			const endedByCursor = this.advanceSlotCursor(base, slot, cursorSamples);
			if (samples < fadeSamples) {
				this.slotFadeSamplesRemaining[slot] = fadeSamples - samples;
				if (endedByCursor) {
					this.slotFadeSamplesRemaining[slot] = 0;
					out.ended = true;
					out.voiceId = voiceId;
					out.sourceAddr = sourceAddr;
				}
				return;
			}
			this.slotFadeSamplesRemaining[slot] = 0;
			out.ended = true;
			out.voiceId = voiceId;
			out.sourceAddr = sourceAddr;
			return;
		}
		if (this.advanceSlotCursor(base, slot, samples)) {
			out.ended = true;
			out.voiceId = voiceId;
			out.sourceAddr = sourceAddr;
		}
	}

	public sourceAddr(slot: ApuAudioSlot): number {
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)]!;
	}

	private advanceSlotCursor(base: number, slot: ApuAudioSlot, samples: number): boolean {
		const rateStepQ16 = toSignedWord(this.slotRegisterWords[base + APU_PARAMETER_RATE_STEP_Q16_INDEX]!);
		const sourceSampleRateHz = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX]!;
		const loopStartQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		const loopEndQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		let cursorQ16 = advanceApuPlaybackCursorQ16(this.slotPlaybackCursorQ16[slot]!, samples, rateStepQ16, sourceSampleRateHz);
		if (loopEndQ16 > loopStartQ16) {
			if (cursorQ16 >= loopEndQ16) {
				const loopLengthQ16 = loopEndQ16 - loopStartQ16;
				cursorQ16 = loopStartQ16 + ((cursorQ16 - loopStartQ16) % loopLengthQ16);
			}
			this.slotPlaybackCursorQ16[slot] = cursorQ16;
			return false;
		}
		this.slotPlaybackCursorQ16[slot] = cursorQ16;
		const frameEndQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]! * APU_RATE_STEP_Q16_ONE;
		return rateStepQ16 > 0 && cursorQ16 >= frameEndQ16;
	}

	public captureSlotPhases(): number[] {
		const savedWords = Array.from(this.slotPhases);
		return savedWords;
	}

	public captureSlotRegisterWords(): number[] {
		const savedWords = Array.from(this.slotRegisterWords);
		return savedWords;
	}

	public captureSlotPlaybackCursorQ16(): number[] {
		const savedWords = this.slotPlaybackCursorQ16.slice();
		return savedWords;
	}

	public captureSlotFadeSamplesRemaining(): number[] {
		const savedWords = Array.from(this.slotFadeSamplesRemaining);
		return savedWords;
	}

	public captureSlotFadeSamplesTotal(): number[] {
		const savedWords = Array.from(this.slotFadeSamplesTotal);
		return savedWords;
	}

	public restore(
		slotPhases: ArrayLike<number>,
		slotRegisterWords: ArrayLike<number>,
		slotPlaybackCursorQ16: ArrayLike<number>,
		slotFadeSamplesRemaining: ArrayLike<number>,
		slotFadeSamplesTotal: ArrayLike<number>,
	): void {
		this.resetVoiceIds();
		this.activeMaskWord = 0;
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const phase = slotPhases[slot]!;
			this.slotPhases[slot] = phase;
			if (phase !== APU_SLOT_PHASE_IDLE) {
				this.activeMaskWord = (this.activeMaskWord | (1 << slot)) >>> 0;
			}
			this.slotPlaybackCursorQ16[slot] = slotPlaybackCursorQ16[slot]!;
			this.slotFadeSamplesRemaining[slot] = slotFadeSamplesRemaining[slot]!;
			this.slotFadeSamplesTotal[slot] = slotFadeSamplesTotal[slot]!;
		}
		for (let index = 0; index < APU_SLOT_REGISTER_WORD_COUNT; index += 1) {
			this.slotRegisterWords[index] = slotRegisterWords[index] >>> 0;
		}
	}
}
