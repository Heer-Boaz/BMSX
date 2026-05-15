export const APU_SAMPLE_RATE_HZ = 44100;
export const APU_RATE_STEP_Q16_ONE = 0x1_0000;
export const APU_GAIN_Q12_ONE = 0x1000;
export const APU_OUTPUT_QUEUE_CAPACITY_FRAMES = 16384;
export const APU_OUTPUT_QUEUE_CAPACITY_SAMPLES = APU_OUTPUT_QUEUE_CAPACITY_FRAMES * 2;
export const APU_COMMAND_FIFO_CAPACITY = 16;

export const APU_CMD_NONE = 0;
export const APU_CMD_PLAY = 1;
export const APU_CMD_STOP_SLOT = 2;
export const APU_CMD_SET_SLOT_GAIN = 3;

export const APU_SLOT_COUNT = 16;
export const APU_SLOT_PHASE_IDLE = 0;
export const APU_SLOT_PHASE_PLAYING = 1;
export const APU_SLOT_PHASE_FADING = 2;
export const APU_GENERATOR_NONE = 0;
export const APU_GENERATOR_SQUARE = 1;
export const APU_PARAMETER_REGISTER_COUNT = 21;
export const APU_PARAMETER_SOURCE_ADDR_INDEX = 0;
export const APU_PARAMETER_SOURCE_BYTES_INDEX = 1;
export const APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX = 2;
export const APU_PARAMETER_SOURCE_CHANNELS_INDEX = 3;
export const APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX = 4;
export const APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX = 5;
export const APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX = 6;
export const APU_PARAMETER_SOURCE_DATA_BYTES_INDEX = 7;
export const APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX = 8;
export const APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX = 9;
export const APU_PARAMETER_SLOT_INDEX = 10;
export const APU_PARAMETER_RATE_STEP_Q16_INDEX = 11;
export const APU_PARAMETER_GAIN_Q12_INDEX = 12;
export const APU_PARAMETER_START_SAMPLE_INDEX = 13;
export const APU_PARAMETER_FILTER_KIND_INDEX = 14;
export const APU_PARAMETER_FILTER_FREQ_HZ_INDEX = 15;
export const APU_PARAMETER_FILTER_Q_MILLI_INDEX = 16;
export const APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX = 17;
export const APU_PARAMETER_FADE_SAMPLES_INDEX = 18;
export const APU_PARAMETER_GENERATOR_KIND_INDEX = 19;
export const APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX = 20;
export const APU_SLOT_REGISTER_WORD_COUNT = APU_SLOT_COUNT * APU_PARAMETER_REGISTER_COUNT;
export const APU_COMMAND_FIFO_REGISTER_WORD_COUNT = APU_COMMAND_FIFO_CAPACITY * APU_PARAMETER_REGISTER_COUNT;

export function apuSlotRegisterWordIndex(slot: number, parameterIndex: number): number {
	return slot * APU_PARAMETER_REGISTER_COUNT + parameterIndex;
}

export const APU_STATUS_FAULT = 1 << 0;
export const APU_STATUS_SELECTED_SLOT_ACTIVE = 1 << 1;
export const APU_STATUS_BUSY = 1 << 2;
export const APU_STATUS_OUTPUT_EMPTY = 1 << 3;
export const APU_STATUS_OUTPUT_FULL = 1 << 4;
export const APU_STATUS_CMD_FIFO_EMPTY = 1 << 5;
export const APU_STATUS_CMD_FIFO_FULL = 1 << 6;

export const APU_FAULT_NONE = 0;
export const APU_FAULT_BAD_CMD = 0x0001;
export const APU_FAULT_BAD_SLOT = 0x0002;
export const APU_FAULT_CMD_FIFO_FULL = 0x0003;
export const APU_FAULT_SOURCE_BYTES = 0x0101;
export const APU_FAULT_SOURCE_RANGE = 0x0102;
export const APU_FAULT_SOURCE_SAMPLE_RATE = 0x0103;
export const APU_FAULT_SOURCE_CHANNELS = 0x0104;
export const APU_FAULT_SOURCE_FRAME_COUNT = 0x0105;
export const APU_FAULT_SOURCE_DATA_RANGE = 0x0106;
export const APU_FAULT_SOURCE_BIT_DEPTH = 0x0107;
export const APU_FAULT_UNSUPPORTED_FORMAT = 0x0201;
export const APU_FAULT_OUTPUT_METADATA = 0x0202;
export const APU_FAULT_OUTPUT_DATA_RANGE = 0x0203;
export const APU_FAULT_OUTPUT_PLAYBACK_RATE = 0x0204;
export const APU_FAULT_OUTPUT_BLOCK = 0x0205;

export const APU_FILTER_NONE = 0;
export const APU_FILTER_LOWPASS = 1;
export const APU_FILTER_HIGHPASS = 2;
export const APU_FILTER_BANDPASS = 3;
export const APU_FILTER_NOTCH = 4;
export const APU_FILTER_ALLPASS = 5;
export const APU_FILTER_PEAKING = 6;
export const APU_FILTER_LOWSHELF = 7;
export const APU_FILTER_HIGHSHELF = 8;

export const APU_EVENT_NONE = 0;
export const APU_EVENT_SLOT_ENDED = 1;

export type ApuAudioSlot = number;
export type ApuVoiceId = number;
export type ApuSlotPhase = number;
export type ApuParameterRegisterWords = ArrayLike<number>;

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

export function apuParameterProgramsSourceBuffer(parameterIndex: number): boolean {
	switch (parameterIndex) {
		case APU_PARAMETER_SOURCE_ADDR_INDEX:
		case APU_PARAMETER_SOURCE_BYTES_INDEX:
		case APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX:
		case APU_PARAMETER_SOURCE_CHANNELS_INDEX:
		case APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX:
		case APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX:
		case APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX:
		case APU_PARAMETER_SOURCE_DATA_BYTES_INDEX:
		case APU_PARAMETER_GENERATOR_KIND_INDEX:
			return true;
		default:
			return false;
	}
}

export function advanceApuPlaybackCursorQ16(cursorQ16: number, samples: number, rateStepQ16: number, sourceSampleRateHz: number): number {
	const deltaNumerator = samples * rateStepQ16 * sourceSampleRateHz;
	return cursorQ16 + (deltaNumerator - (deltaNumerator % APU_SAMPLE_RATE_HZ)) / APU_SAMPLE_RATE_HZ;
}
