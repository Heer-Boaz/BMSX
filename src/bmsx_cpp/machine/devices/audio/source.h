#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/save_state.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

struct ApuSourceDmaResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0u;
};

struct ApuSourceMetadataResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0u;
};

ApuAudioSource resolveApuAudioSource(const ApuParameterRegisterWords& registerWords);
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
ApuSourceMetadataResult validateApuAudioSourceMetadata(const ApuAudioSource& source);

class ApuSourceDma final {
public:
	void reset();
	void clearSlot(ApuAudioSlot slot);
	ApuSourceDmaResult loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source);
	const std::vector<u8>& bytesForSlot(ApuAudioSlot slot) const { return m_slotSourceBytes[slot]; }
	const ApuSlotSourceBytes& captureState() const;
	void restoreState(const ApuSlotSourceBytes& slotSourceBytes);

private:
	ApuSourceDmaResult validateSource(const Memory& memory, const ApuAudioSource& source) const;

	ApuSlotSourceBytes m_slotSourceBytes{};
};

} // namespace bmsx
