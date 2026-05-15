#include "machine/devices/audio/source.h"

#include "machine/memory/memory.h"

namespace bmsx {

namespace {
constexpr ApuSourceDmaResult APU_SOURCE_DMA_OK{};
constexpr ApuSourceMetadataResult APU_SOURCE_METADATA_OK{};
} // namespace

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

ApuSourceMetadataResult validateApuAudioSourceMetadata(const ApuAudioSource& source) {
	if (source.sampleRateHz == 0u) {
		return {APU_FAULT_SOURCE_SAMPLE_RATE, source.sampleRateHz};
	}
	if (source.channels < 1u || source.channels > 2u) {
		return {APU_FAULT_SOURCE_CHANNELS, source.channels};
	}
	if (source.frameCount == 0u) {
		return {APU_FAULT_SOURCE_FRAME_COUNT, source.frameCount};
	}
	if (apuAudioSourceUsesGenerator(source)) {
		if (source.generatorKind == APU_GENERATOR_SQUARE) {
			return APU_SOURCE_METADATA_OK;
		}
		return {APU_FAULT_OUTPUT_METADATA, source.generatorKind};
	}
	if (source.dataBytes == 0u || source.dataOffset > source.sourceBytes || source.dataBytes > source.sourceBytes - source.dataOffset) {
		return {APU_FAULT_SOURCE_DATA_RANGE, source.dataOffset};
	}
	if (source.bitsPerSample == 4u || source.bitsPerSample == 8u || source.bitsPerSample == 16u) {
		return APU_SOURCE_METADATA_OK;
	}
	return {APU_FAULT_SOURCE_BIT_DEPTH, source.bitsPerSample};
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

ApuSourceDmaResult ApuSourceDma::loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source) {
	if (apuAudioSourceUsesGenerator(source)) {
		clearSlot(slot);
		return APU_SOURCE_DMA_OK;
	}
	const ApuSourceDmaResult validation = validateSource(memory, source);
	if (validation.faultCode != APU_FAULT_NONE) {
		return validation;
	}
	std::vector<u8>& bytes = m_slotSourceBytes[slot];
	bytes.resize(source.sourceBytes);
	memory.readBytes(source.sourceAddr, bytes.data(), bytes.size());
	return APU_SOURCE_DMA_OK;
}

ApuSourceDmaResult ApuSourceDma::validateSource(const Memory& memory, const ApuAudioSource& source) const {
	if (source.sourceBytes == 0u) {
		return {APU_FAULT_SOURCE_BYTES, source.sourceBytes};
	}
	if (!memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
		return {APU_FAULT_SOURCE_RANGE, source.sourceAddr};
	}
	return APU_SOURCE_DMA_OK;
}

} // namespace bmsx
