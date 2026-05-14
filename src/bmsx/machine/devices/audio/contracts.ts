export const APU_SAMPLE_RATE_HZ = 44100;
export const APU_RATE_STEP_Q16_ONE = 0x1_0000;
export const APU_GAIN_Q12_ONE = 0x1000;

export const APU_CMD_NONE = 0;
export const APU_CMD_PLAY = 1;
export const APU_CMD_STOP_SLOT = 2;
export const APU_CMD_RAMP_SLOT = 3;

export const APU_SLOT_COUNT = 16;
export const APU_PARAMETER_REGISTER_COUNT = 20;
export const APU_PARAMETER_SOURCE_ADDR_INDEX = 0;
export const APU_PARAMETER_SLOT_INDEX = 10;
export const APU_SLOT_REGISTER_WORD_COUNT = APU_SLOT_COUNT * APU_PARAMETER_REGISTER_COUNT;

export function apuSlotRegisterWordIndex(slot: number, parameterIndex: number): number {
	return slot * APU_PARAMETER_REGISTER_COUNT + parameterIndex;
}

export const APU_STATUS_FAULT = 1 << 0;
export const APU_STATUS_SELECTED_SLOT_ACTIVE = 1 << 1;
export const APU_STATUS_BUSY = 1 << 2;

export const APU_FAULT_NONE = 0;
export const APU_FAULT_BAD_CMD = 0x0001;
export const APU_FAULT_BAD_SLOT = 0x0002;
export const APU_FAULT_SOURCE_BYTES = 0x0101;
export const APU_FAULT_SOURCE_RANGE = 0x0102;
export const APU_FAULT_SOURCE_SAMPLE_RATE = 0x0103;
export const APU_FAULT_SOURCE_CHANNELS = 0x0104;
export const APU_FAULT_SOURCE_FRAME_COUNT = 0x0105;
export const APU_FAULT_SOURCE_DATA_RANGE = 0x0106;
export const APU_FAULT_SOURCE_BIT_DEPTH = 0x0107;
export const APU_FAULT_RUNTIME_UNAVAILABLE = 0x0201;
export const APU_FAULT_PLAYBACK_REJECTED = 0x0202;

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
