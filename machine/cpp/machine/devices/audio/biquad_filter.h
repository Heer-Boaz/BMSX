#pragma once

#include "common/primitives.h"
#include <string_view>

namespace bmsx {

struct BiquadFilterState {
	bool enabled = false;
	f64 b0 = 1.0;
	f64 b1 = 0.0;
	f64 b2 = 0.0;
	f64 a1 = 0.0;
	f64 a2 = 0.0;
	f64 l1 = 0.0;
	f64 l2 = 0.0;
	f64 r1 = 0.0;
	f64 r2 = 0.0;

	void reset();

	void processStereo(f64& left, f64& right) {
		const f64 inputL = left;
		const f64 inputR = right;
		const f64 outputL = (b0 * inputL) + l1;
		const f64 outputR = (b0 * inputR) + r1;
		l1 = (b1 * inputL) - (a1 * outputL) + l2;
		l2 = (b2 * inputL) - (a2 * outputL);
		r1 = (b1 * inputR) - (a1 * outputR) + r2;
		r2 = (b2 * inputR) - (a2 * outputR);
		left = outputL;
		right = outputR;
	}
};

void configureBiquadFilter(
	BiquadFilterState& state,
	std::string_view type,
	f64 frequency,
	f64 q,
	f64 gain,
	f64 sampleRate
);

} // namespace bmsx
