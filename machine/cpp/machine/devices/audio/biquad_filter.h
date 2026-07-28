#pragma once

#include "machine/common/numeric.h"
#include "spec/audio/apu.h"

namespace bmsx {

struct BiquadFilterState {
	bool enabled = false;
	i32 b0 = static_cast<i32>(APU_FILTER_COEFFICIENT_ONE);
	i32 b1 = 0;
	i32 b2 = 0;
	i32 a1 = 0;
	i32 a2 = 0;
	i32 l1 = 0;
	i32 l2 = 0;
	i32 r1 = 0;
	i32 r2 = 0;
	i32 outputLeft = 0;
	i32 outputRight = 0;

	void reset();

	void processStereo(i32 left, i32 right) {
		const i32 outputL = static_cast<i32>(shiftRightSigned(
			static_cast<i64>(b0) * left + l1,
			APU_FILTER_COEFFICIENT_FRACTION_BITS
		));
		const i32 outputR = static_cast<i32>(shiftRightSigned(
			static_cast<i64>(b0) * right + r1,
			APU_FILTER_COEFFICIENT_FRACTION_BITS
		));
		l1 = wrapI32(static_cast<i64>(b1) * left - static_cast<i64>(a1) * outputL + l2);
		l2 = wrapI32(static_cast<i64>(b2) * left - static_cast<i64>(a2) * outputL);
		r1 = wrapI32(static_cast<i64>(b1) * right - static_cast<i64>(a1) * outputR + r2);
		r2 = wrapI32(static_cast<i64>(b2) * right - static_cast<i64>(a2) * outputR);
		outputLeft = saturateSample(outputL);
		outputRight = saturateSample(outputR);
	}

private:
	static constexpr auto saturateSample(i32 value) -> i32 {
		if (value < -0x8000) {
			return -0x8000;
		}
		if (value > 0x7fff) {
			return 0x7fff;
		}
		return value;
	}
};

void configureBiquadFilter(
	BiquadFilterState& state,
	u32 controlWord,
	u32 b0B1Word,
	u32 b2A1Word,
	u32 a2Word
);

} // namespace bmsx
