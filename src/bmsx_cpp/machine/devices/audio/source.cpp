#include "machine/devices/audio/source.h"

#include "machine/memory/memory.h"

namespace bmsx {

ApuAudioSource resolveApuAudioSource(const ApuParameterRegisterWords& registerWords) {
	ApuAudioSource source;
	source.sourceAddr = registerWords[APU_PARAMETER_SOURCE_ADDR_INDEX];
	source.sourceBytes = registerWords[APU_PARAMETER_SOURCE_BYTES_INDEX];
	source.sampleRateHz = registerWords[APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX];
	source.channels = registerWords[APU_PARAMETER_SOURCE_CHANNELS_INDEX];
	source.bitsPerSample = registerWords[APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX];
	source.frameCount = registerWords[APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX];
	source.dataOffset = registerWords[APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX];
	source.dataBytes = registerWords[APU_PARAMETER_SOURCE_DATA_BYTES_INDEX];
	source.loopStartSample = registerWords[APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX];
	source.loopEndSample = registerWords[APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX];
	source.generatorKind = registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX];
	source.generatorDutyQ12 = registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX];
	return source;
}

void ApuSourceDma::reset() {
	for (std::vector<u8>& bytes : m_slotSourceBytes) {
		bytes.clear();
	}
}

void ApuSourceDma::clearSlot(ApuAudioSlot slot) {
	std::vector<u8>& bytes = m_slotSourceBytes[slot];
	bytes.clear();
}

void ApuSourceDma::loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source) {
	if (apuAudioSourceUsesGenerator(source)) {
		clearSlot(slot);
		return;
	}
	std::vector<u8>& bytes = m_slotSourceBytes[slot];
	bytes.resize(source.sourceBytes);
	memory.readBytes(source.sourceAddr, bytes.data(), bytes.size());
}

} // namespace bmsx
