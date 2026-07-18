#pragma once

#include "common/endian.h"
#include "common/types.h"
#include "machine/common/numeric.h"

namespace bmsx {

inline i16 readApuPcmSample(const u8* bytes, size_t dataOffset, bool is16Bit, size_t sampleIndex) {
	if (is16Bit) {
		return readI16LE(bytes + dataOffset + sampleIndex * 2u);
	}
	return static_cast<i16>((static_cast<int>(bytes[dataOffset + sampleIndex]) - 128) * 0x100);
}

inline auto interpolateApuPcmSample(i32 first, i32 second, u32 fractionQ16) -> i32 {
	return first + static_cast<i32>(shiftRightSigned(
		static_cast<i64>(second - first) * static_cast<i64>(fractionQ16),
		16u
	));
}

} // namespace bmsx
