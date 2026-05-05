#pragma once

#include "common/primitives.h"
#include <string_view>

namespace bmsx {

struct BiquadFilterState {
	bool enabled = false;
	f32 b0 = 1.0f;
	f32 b1 = 0.0f;
	f32 b2 = 0.0f;
	f32 a1 = 0.0f;
	f32 a2 = 0.0f;
	f32 l1 = 0.0f;
	f32 l2 = 0.0f;
	f32 r1 = 0.0f;
	f32 r2 = 0.0f;

	void reset();

	inline void processStereo(f32& left, f32& right) {
		const f32 inputL = left;
		const f32 inputR = right;
		const f32 outputL = b0 * inputL + l1;
		const f32 outputR = b0 * inputR + r1;
		l1 = b1 * inputL - a1 * outputL + l2;
		l2 = b2 * inputL - a2 * outputL;
		r1 = b1 * inputR - a1 * outputR + r2;
		r2 = b2 * inputR - a2 * outputR;
		left = outputL;
		right = outputR;
	}
};

void configureBiquadFilter(
	BiquadFilterState& state,
	std::string_view type,
	f32 frequency,
	f32 q,
	f32 gain,
	f32 sampleRate
);

} // namespace bmsx
