#include "machine/devices/audio/playback.h"

#include "machine/common/numeric.h"

namespace bmsx {

f64 resolveApuGainLinear(u32 gainQ12Word) {
	return static_cast<f64>(toSignedWord(gainQ12Word)) / static_cast<f64>(APU_GAIN_Q12_ONE);
}

void resolveApuPhaseStep(ApuPhaseStep& out, u32 rateStepQ16Word, u32 sourceSampleRateHz) {
	const i64 product = static_cast<i64>(toSignedWord(rateStepQ16Word)) * static_cast<i64>(sourceSampleRateHz);
	out.wholeQ16 = product / static_cast<i64>(APU_SAMPLE_RATE_HZ);
	out.remainder = static_cast<i32>(product % static_cast<i64>(APU_SAMPLE_RATE_HZ));
}

std::string_view decodeApuFilterType(u32 kind) {
	switch (kind) {
		case APU_FILTER_HIGHPASS:
			return "highpass";
		case APU_FILTER_BANDPASS:
			return "bandpass";
		case APU_FILTER_NOTCH:
			return "notch";
		case APU_FILTER_ALLPASS:
			return "allpass";
		case APU_FILTER_PEAKING:
			return "peaking";
		case APU_FILTER_LOWSHELF:
			return "lowshelf";
		case APU_FILTER_HIGHSHELF:
			return "highshelf";
		default:
			return "lowpass";
	}
}

void applyApuOutputFilter(ApuOutputPlayback& playback, const ApuParameterRegisterWords& registerWords) {
	const u32 filterKind = registerWords[APU_PARAMETER_FILTER_KIND_INDEX];
	playback.filterEnabled = filterKind != APU_FILTER_NONE;
	playback.filterType = decodeApuFilterType(filterKind);
	playback.filterFrequency = static_cast<f64>(toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]));
	playback.filterQ = static_cast<f64>(toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX])) / 1000.0;
	playback.filterGain = static_cast<f64>(toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX])) / 1000.0;
}

void loadApuOutputPlayback(ApuOutputPlayback& playback, const ApuParameterRegisterWords& registerWords) {
	playback.gainLinear = resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
	applyApuOutputFilter(playback, registerWords);
}

} // namespace bmsx
