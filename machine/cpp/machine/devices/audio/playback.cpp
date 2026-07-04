#include "machine/devices/audio/playback.h"

#include "machine/common/numeric.h"

namespace bmsx {

f32 resolveApuGainLinear(u32 gainQ12Word) {
	return static_cast<f32>(toSignedWord(gainQ12Word)) / static_cast<f32>(APU_GAIN_Q12_ONE);
}

f32 resolveApuPlaybackRate(u32 rateStepQ16Word) {
	return static_cast<f32>(toSignedWord(rateStepQ16Word)) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
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
	playback.filterFrequency = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]));
	playback.filterQ = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX])) / 1000.0f;
	playback.filterGain = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX])) / 1000.0f;
}

ApuOutputPlayback resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) {
	ApuOutputPlayback playback;
	playback.playbackRate = resolveApuPlaybackRate(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]);
	playback.gainLinear = resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
	applyApuOutputFilter(playback, registerWords);
	return playback;
}

} // namespace bmsx
