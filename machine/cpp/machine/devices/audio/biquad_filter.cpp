#include "biquad_filter.h"

#include <algorithm>
#include <cmath>
#include <string_view>

namespace bmsx {

namespace {

constexpr f64 BIQUAD_PI = 3.14159265358979323846;

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
	b0 = 1.0;
	b1 = 0.0;
	b2 = 0.0;
	a1 = 0.0;
	a2 = 0.0;
	l1 = 0.0;
	l2 = 0.0;
	r1 = 0.0;
	r2 = 0.0;
}

void configureBiquadFilter(
	BiquadFilterState& state,
	std::string_view type,
	f64 frequency,
	f64 q,
	f64 gain,
	f64 sampleRate
) {
	frequency = std::clamp(frequency, 0.001, sampleRate * 0.499);

	const f64 omega = 2.0 * BIQUAD_PI * frequency / sampleRate;
	const f64 sinOmega = std::sin(omega);
	const f64 cosOmega = std::cos(omega);
	const f64 alpha = sinOmega / (2.0 * q);
	const f64 A = std::pow(10.0, gain / 40.0);
	const f64 sqrtA = std::sqrt(A);
	const f64 twoSqrtAAlpha = 2.0 * sqrtA * alpha;

	f64 b0 = 1.0;
	f64 b1 = 0.0;
	f64 b2 = 0.0;
	f64 a0 = 1.0;
	f64 a1 = 0.0;
	f64 a2 = 0.0;

	switch (resolveBiquadFilterKind(type)) {
		case BiquadFilterKind::Lowpass:
			b0 = (1.0 - cosOmega) * 0.5;
			b1 = 1.0 - cosOmega;
			b2 = (1.0 - cosOmega) * 0.5;
			a0 = 1.0 + alpha;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha;
			break;
		case BiquadFilterKind::Highpass:
			b0 = (1.0 + cosOmega) * 0.5;
			b1 = -(1.0 + cosOmega);
			b2 = (1.0 + cosOmega) * 0.5;
			a0 = 1.0 + alpha;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha;
			break;
		case BiquadFilterKind::Bandpass:
			b0 = sinOmega * 0.5;
			b1 = 0.0;
			b2 = -sinOmega * 0.5;
			a0 = 1.0 + alpha;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha;
			break;
		case BiquadFilterKind::Notch:
			b0 = 1.0;
			b1 = -2.0 * cosOmega;
			b2 = 1.0;
			a0 = 1.0 + alpha;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha;
			break;
		case BiquadFilterKind::Allpass:
			b0 = 1.0 - alpha;
			b1 = -2.0 * cosOmega;
			b2 = 1.0 + alpha;
			a0 = 1.0 + alpha;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha;
			break;
		case BiquadFilterKind::Peaking:
			b0 = 1.0 + alpha * A;
			b1 = -2.0 * cosOmega;
			b2 = 1.0 - alpha * A;
			a0 = 1.0 + alpha / A;
			a1 = -2.0 * cosOmega;
			a2 = 1.0 - alpha / A;
			break;
		case BiquadFilterKind::Lowshelf:
			b0 = A * ((A + 1.0) - (A - 1.0) * cosOmega + twoSqrtAAlpha);
			b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosOmega);
			b2 = A * ((A + 1.0) - (A - 1.0) * cosOmega - twoSqrtAAlpha);
			a0 = (A + 1.0) + (A - 1.0) * cosOmega + twoSqrtAAlpha;
			a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosOmega);
			a2 = (A + 1.0) + (A - 1.0) * cosOmega - twoSqrtAAlpha;
			break;
		case BiquadFilterKind::Highshelf:
			b0 = A * ((A + 1.0) + (A - 1.0) * cosOmega + twoSqrtAAlpha);
			b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosOmega);
			b2 = A * ((A + 1.0) + (A - 1.0) * cosOmega - twoSqrtAAlpha);
			a0 = (A + 1.0) - (A - 1.0) * cosOmega + twoSqrtAAlpha;
			a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosOmega);
			a2 = (A + 1.0) - (A - 1.0) * cosOmega - twoSqrtAAlpha;
			break;
		case BiquadFilterKind::Unknown:
			throw BMSX_RUNTIME_ERROR("Unsupported biquad filter type.");
	}

	const f64 invA0 = 1.0 / a0;
	state.enabled = true;
	state.b0 = b0 * invA0;
	state.b1 = b1 * invA0;
	state.b2 = b2 * invA0;
	state.a1 = a1 * invA0;
	state.a2 = a2 * invA0;
	state.l1 = 0.0;
	state.l2 = 0.0;
	state.r1 = 0.0;
	state.r2 = 0.0;
}

} // namespace bmsx
