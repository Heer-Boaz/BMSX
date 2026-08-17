export type ApuAudioSlot = number;
export type ApuSlotPhase = number;
export type ApuParameterRegisterWords = ArrayLike<number>;

export const APU_SLOT_PHASE_IDLE = 0;
export const APU_SLOT_PHASE_PLAYING = 1;
export const APU_SLOT_PHASE_FADING = 2;
export const APU_SLOT_PHASE_PAUSED = 1 << 2;

export interface ApuAudioSource {
	sourceAddr: number;
	sourceBytes: number;
	sampleRateHz: number;
	channels: number;
	bitsPerSample: number;
	frameCount: number;
	dataOffset: number;
	dataBytes: number;
	loopStartSample: number;
	loopEndSample: number;
	generatorKind: number;
	generatorDutyQ12: number;
}
