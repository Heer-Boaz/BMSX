import {
	APU_GENERATOR_NONE,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_BYTES_INDEX,
	APU_PARAMETER_SOURCE_CHANNELS_INDEX,
	APU_PARAMETER_SOURCE_DATA_BYTES_INDEX,
	APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX,
	APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
} from './contracts';

export type ApuSourceByteView = {
	bytes: Uint8Array;
	byteOffset: number;
	byteLength: number;
};

export function loadApuAudioSource(out: ApuAudioSource, registerWords: ApuParameterRegisterWords): void {
	out.sourceAddr = registerWords[APU_PARAMETER_SOURCE_ADDR_INDEX]!;
	out.sourceBytes = registerWords[APU_PARAMETER_SOURCE_BYTES_INDEX]!;
	out.sampleRateHz = registerWords[APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX]!;
	out.channels = registerWords[APU_PARAMETER_SOURCE_CHANNELS_INDEX]!;
	out.bitsPerSample = registerWords[APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX]!;
	out.frameCount = registerWords[APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]!;
	out.dataOffset = registerWords[APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX]!;
	out.dataBytes = registerWords[APU_PARAMETER_SOURCE_DATA_BYTES_INDEX]!;
	out.loopStartSample = registerWords[APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]!;
	out.loopEndSample = registerWords[APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]!;
	out.generatorKind = registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX]!;
	out.generatorDutyQ12 = registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX]!;
}

export function apuAudioSourceUsesGenerator(source: ApuAudioSource): boolean {
	return source.generatorKind !== APU_GENERATOR_NONE;
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
