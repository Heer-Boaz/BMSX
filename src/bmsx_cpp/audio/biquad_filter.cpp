#include "biquad_filter.h"

#include <algorithm>
#include <cmath>

namespace bmsx {

namespace {

constexpr f32 BIQUAD_PI = 3.14159265358979323846f;
constexpr f32 DEFAULT_FILTER_FREQUENCY = 350.0f;
constexpr f32 DEFAULT_FILTER_Q = 1.0f;

}

void BiquadFilterState::reset() {
	enabled = false;
	b0 = 1.0f;
	b1 = 0.0f;
	b2 = 0.0f;
	a1 = 0.0f;
	a2 = 0.0f;
	l1 = 0.0f;
	l2 = 0.0f;
	r1 = 0.0f;
	r2 = 0.0f;
}

void configureBiquadFilter(
	BiquadFilterState& state,
	std::string_view type,
	f32 frequency,
	f32 q,
	f32 gain,
	f32 sampleRate
) {
	if (!std::isfinite(sampleRate) || sampleRate <= 0.0f) {
		throw BMSX_RUNTIME_ERROR("Biquad filter sampleRate must be positive and finite.");
	}

	if (type.empty()) {
		type = "lowpass";
	}
	if (frequency <= 0.0f) {
		frequency = DEFAULT_FILTER_FREQUENCY;
	}
	if (q <= 0.0f) {
		q = DEFAULT_FILTER_Q;
	}
	if (!std::isfinite(frequency) || !std::isfinite(q) || !std::isfinite(gain)) {
		throw BMSX_RUNTIME_ERROR("Biquad filter parameters must be finite.");
	}

	frequency = std::clamp(frequency, 0.001f, sampleRate * 0.499f);

	const f32 omega = 2.0f * BIQUAD_PI * frequency / sampleRate;
	const f32 sinOmega = std::sin(omega);
	const f32 cosOmega = std::cos(omega);
	const f32 alpha = sinOmega / (2.0f * q);
	const f32 A = std::pow(10.0f, gain / 40.0f);
	const f32 sqrtA = std::sqrt(A);
	const f32 twoSqrtAAlpha = 2.0f * sqrtA * alpha;

	f32 b0 = 1.0f;
	f32 b1 = 0.0f;
	f32 b2 = 0.0f;
	f32 a0 = 1.0f;
	f32 a1 = 0.0f;
	f32 a2 = 0.0f;

	if (type == "lowpass") {
		b0 = (1.0f - cosOmega) * 0.5f;
		b1 = 1.0f - cosOmega;
		b2 = (1.0f - cosOmega) * 0.5f;
		a0 = 1.0f + alpha;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha;
	} else if (type == "highpass") {
		b0 = (1.0f + cosOmega) * 0.5f;
		b1 = -(1.0f + cosOmega);
		b2 = (1.0f + cosOmega) * 0.5f;
		a0 = 1.0f + alpha;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha;
	} else if (type == "bandpass") {
		b0 = sinOmega * 0.5f;
		b1 = 0.0f;
		b2 = -sinOmega * 0.5f;
		a0 = 1.0f + alpha;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha;
	} else if (type == "notch") {
		b0 = 1.0f;
		b1 = -2.0f * cosOmega;
		b2 = 1.0f;
		a0 = 1.0f + alpha;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha;
	} else if (type == "allpass") {
		b0 = 1.0f - alpha;
		b1 = -2.0f * cosOmega;
		b2 = 1.0f + alpha;
		a0 = 1.0f + alpha;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha;
	} else if (type == "peaking") {
		b0 = 1.0f + alpha * A;
		b1 = -2.0f * cosOmega;
		b2 = 1.0f - alpha * A;
		a0 = 1.0f + alpha / A;
		a1 = -2.0f * cosOmega;
		a2 = 1.0f - alpha / A;
	} else if (type == "lowshelf") {
		b0 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega + twoSqrtAAlpha);
		b1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cosOmega);
		b2 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega - twoSqrtAAlpha);
		a0 = (A + 1.0f) + (A - 1.0f) * cosOmega + twoSqrtAAlpha;
		a1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cosOmega);
		a2 = (A + 1.0f) + (A - 1.0f) * cosOmega - twoSqrtAAlpha;
	} else if (type == "highshelf") {
		b0 = A * ((A + 1.0f) + (A - 1.0f) * cosOmega + twoSqrtAAlpha);
		b1 = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cosOmega);
		b2 = A * ((A + 1.0f) + (A - 1.0f) * cosOmega - twoSqrtAAlpha);
		a0 = (A + 1.0f) - (A - 1.0f) * cosOmega + twoSqrtAAlpha;
		a1 = 2.0f * ((A - 1.0f) - (A + 1.0f) * cosOmega);
		a2 = (A + 1.0f) - (A - 1.0f) * cosOmega - twoSqrtAAlpha;
	} else {
		throw BMSX_RUNTIME_ERROR("Unsupported biquad filter type.");
	}

	const f32 invA0 = 1.0f / a0;
	state.enabled = true;
	state.b0 = b0 * invA0;
	state.b1 = b1 * invA0;
	state.b2 = b2 * invA0;
	state.a1 = a1 * invA0;
	state.a2 = a2 * invA0;
	state.l1 = 0.0f;
	state.l2 = 0.0f;
	state.r1 = 0.0f;
	state.r2 = 0.0f;
}

} // namespace bmsx
