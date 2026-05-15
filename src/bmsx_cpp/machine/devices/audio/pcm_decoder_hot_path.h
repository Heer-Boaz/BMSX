#pragma once

#include "common/endian.h"
#include "common/types.h"

namespace bmsx {

namespace {

inline constexpr f32 APU_PCM_SAMPLE_SCALE = 1.0f / 32768.0f;

inline i16 readApuPcmSample(const u8* data, size_t dataOffset, bool is16Bit, size_t sampleIndex) {
	if (is16Bit) {
		return readI16LE(data + dataOffset + sampleIndex * 2u);
	}
	return static_cast<i16>(static_cast<int>(data[dataOffset + sampleIndex]) - 128) << 8;
}

} // namespace

} // namespace bmsx
