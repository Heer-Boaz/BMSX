#include "biquad_filter.h"

#include <algorithm>
#include <cmath>
#include <string_view>

namespace bmsx {

namespace {

constexpr f32 BIQUAD_PI = 3.14159265358979323846f;

enum class BiquadFilterKind {
	Lowpass,
	Highpass,
	Bandpass,
	Notch,
	Allpass,
	Peaking,
	Lowshelf,
	Highshelf,
	Unknown,
};

BiquadFilterKind resolveBiquadFilterKind(std::string_view type) {
	switch (type[0]) {
		case 'l':
			if (type == "lowpass") {
				return BiquadFilterKind::Lowpass;
			}
			if (type == "lowshelf") {
				return BiquadFilterKind::Lowshelf;
			}
			break;
		case 'h':
			if (type == "highpass") {
				return BiquadFilterKind::Highpass;
			}
			if (type == "highshelf") {
				return BiquadFilterKind::Highshelf;
			}
			break;
		case 'b':
			if (type == "bandpass") {
				return BiquadFilterKind::Bandpass;
			}
			break;
		case 'n':
			if (type == "notch") {
				return BiquadFilterKind::Notch;
			}
			break;
		case 'a':
			if (type == "allpass") {
				return BiquadFilterKind::Allpass;
			}
			break;
		case 'p':
			if (type == "peaking") {
				return BiquadFilterKind::Peaking;
			}
			break;
	}
	return BiquadFilterKind::Unknown;
}

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

	switch (resolveBiquadFilterKind(type)) {
		case BiquadFilterKind::Lowpass:
			b0 = (1.0f - cosOmega) * 0.5f;
			b1 = 1.0f - cosOmega;
			b2 = (1.0f - cosOmega) * 0.5f;
			a0 = 1.0f + alpha;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha;
			break;
		case BiquadFilterKind::Highpass:
			b0 = (1.0f + cosOmega) * 0.5f;
			b1 = -(1.0f + cosOmega);
			b2 = (1.0f + cosOmega) * 0.5f;
			a0 = 1.0f + alpha;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha;
			break;
		case BiquadFilterKind::Bandpass:
			b0 = sinOmega * 0.5f;
			b1 = 0.0f;
			b2 = -sinOmega * 0.5f;
			a0 = 1.0f + alpha;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha;
			break;
		case BiquadFilterKind::Notch:
			b0 = 1.0f;
			b1 = -2.0f * cosOmega;
			b2 = 1.0f;
			a0 = 1.0f + alpha;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha;
			break;
		case BiquadFilterKind::Allpass:
			b0 = 1.0f - alpha;
			b1 = -2.0f * cosOmega;
			b2 = 1.0f + alpha;
			a0 = 1.0f + alpha;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha;
			break;
		case BiquadFilterKind::Peaking:
			b0 = 1.0f + alpha * A;
			b1 = -2.0f * cosOmega;
			b2 = 1.0f - alpha * A;
			a0 = 1.0f + alpha / A;
			a1 = -2.0f * cosOmega;
			a2 = 1.0f - alpha / A;
			break;
		case BiquadFilterKind::Lowshelf:
			b0 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega + twoSqrtAAlpha);
			b1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cosOmega);
			b2 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega - twoSqrtAAlpha);
			a0 = (A + 1.0f) + (A - 1.0f) * cosOmega + twoSqrtAAlpha;
			a1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cosOmega);
			a2 = (A + 1.0f) + (A - 1.0f) * cosOmega - twoSqrtAAlpha;
			break;
		case BiquadFilterKind::Highshelf:
			b0 = A * ((A + 1.0f) + (A - 1.0f) * cosOmega + twoSqrtAAlpha);
			b1 = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cosOmega);
			b2 = A * ((A + 1.0f) + (A - 1.0f) * cosOmega - twoSqrtAAlpha);
			a0 = (A + 1.0f) - (A - 1.0f) * cosOmega + twoSqrtAAlpha;
			a1 = 2.0f * ((A - 1.0f) - (A + 1.0f) * cosOmega);
			a2 = (A + 1.0f) - (A - 1.0f) * cosOmega - twoSqrtAAlpha;
			break;
		case BiquadFilterKind::Unknown:
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
