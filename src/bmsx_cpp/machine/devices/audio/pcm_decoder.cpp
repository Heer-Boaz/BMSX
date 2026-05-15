#include "machine/devices/audio/pcm_decoder.h"

namespace bmsx {

namespace {
constexpr ApuPcmValidationResult APU_PCM_VALIDATION_OK{};
} // namespace

ApuPcmValidationResult validateApuPcmSourceData(const ApuAudioSource& source) {
	const u64 bytesPerSample = source.bitsPerSample == 16u ? 2u : 1u;
	const u64 requiredDataBytes = static_cast<u64>(source.frameCount) * static_cast<u64>(source.channels) * bytesPerSample;
	if (requiredDataBytes > static_cast<u64>(source.dataBytes)) {
		return {APU_FAULT_OUTPUT_DATA_RANGE, source.dataBytes};
	}
	return APU_PCM_VALIDATION_OK;
}

} // namespace bmsx
