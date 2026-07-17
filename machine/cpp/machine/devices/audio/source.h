#pragma once

#include "machine/devices/audio/contracts.h"

namespace bmsx {

void loadApuAudioSource(ApuAudioSource& out, const ApuParameterRegisterWords& registerWords);
constexpr bool apuAudioSourceUsesGenerator(const ApuAudioSource& source) {
	return source.generatorKind != APU_GENERATOR_NONE;
}

constexpr bool apuParameterProgramsSourceBuffer(uint32_t parameterIndex) {
	return parameterIndex == APU_PARAMETER_SOURCE_ADDR_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_BYTES_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_CHANNELS_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX
		|| parameterIndex == APU_PARAMETER_SOURCE_DATA_BYTES_INDEX
		|| parameterIndex == APU_PARAMETER_GENERATOR_KIND_INDEX;
}

} // namespace bmsx
