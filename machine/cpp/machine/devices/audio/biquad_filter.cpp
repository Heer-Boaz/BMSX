#include "machine/devices/audio/biquad_filter.h"

namespace bmsx {

void BiquadFilterState::reset() {
	enabled = false;
	b0 = static_cast<i32>(APU_FILTER_COEFFICIENT_ONE);
	b1 = 0;
	b2 = 0;
	a1 = 0;
	a2 = 0;
	l1 = 0;
	l2 = 0;
	r1 = 0;
	r2 = 0;
	outputLeft = 0;
	outputRight = 0;
}

void BiquadFilterState::configure(u32 controlWord, u32 b0B1Word, u32 b2A1Word, u32 a2Word) {
	enabled = (controlWord & APU_FILTER_CONTROL_ENABLE) != 0u;
	b0 = lowSignedHalfword(b0B1Word);
	b1 = highSignedHalfword(b0B1Word);
	b2 = lowSignedHalfword(b2A1Word);
	a1 = highSignedHalfword(b2A1Word);
	a2 = lowSignedHalfword(a2Word);
}

} // namespace bmsx
