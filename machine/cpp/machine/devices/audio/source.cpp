#include "machine/devices/audio/source.h"

namespace bmsx {

void loadApuAudioSource(ApuAudioSource& out, const ApuParameterRegisterWords& registerWords) {
	out.sourceAddr = registerWords[APU_PARAMETER_SOURCE_ADDR_INDEX];
	out.sourceBytes = registerWords[APU_PARAMETER_SOURCE_BYTES_INDEX];
	out.sampleRateHz = registerWords[APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX];
	out.channels = registerWords[APU_PARAMETER_SOURCE_CHANNELS_INDEX];
	out.bitsPerSample = registerWords[APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX];
	out.frameCount = registerWords[APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX];
	out.dataOffset = registerWords[APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX];
	out.dataBytes = registerWords[APU_PARAMETER_SOURCE_DATA_BYTES_INDEX];
	out.loopStartSample = registerWords[APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX];
	out.loopEndSample = registerWords[APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX];
	out.generatorKind = registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX];
	out.generatorDutyQ12 = registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX];
}

} // namespace bmsx
