#include "machine/devices/audio/playback.h"

#include "machine/common/numeric.h"

namespace bmsx {

f32 resolveApuGainLinear(u32 gainQ12Word) {
	return static_cast<f32>(toSignedWord(gainQ12Word)) / static_cast<f32>(APU_GAIN_Q12_ONE);
}

f32 resolveApuPlaybackRate(u32 rateStepQ16Word) {
	return static_cast<f32>(toSignedWord(rateStepQ16Word)) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
}

std::optional<ApuOutputFilter> resolveApuOutputFilter(const ApuParameterRegisterWords& registerWords) {
	const u32 filterKind = registerWords[APU_PARAMETER_FILTER_KIND_INDEX];
	if (filterKind == APU_FILTER_NONE) {
		return std::nullopt;
	}
	ApuOutputFilter filter;
	switch (filterKind) {
		case APU_FILTER_HIGHPASS:
			filter.type = "highpass";
			break;
		case APU_FILTER_BANDPASS:
			filter.type = "bandpass";
			break;
		case APU_FILTER_NOTCH:
			filter.type = "notch";
			break;
		case APU_FILTER_ALLPASS:
			filter.type = "allpass";
			break;
		case APU_FILTER_PEAKING:
			filter.type = "peaking";
			break;
		case APU_FILTER_LOWSHELF:
			filter.type = "lowshelf";
			break;
		case APU_FILTER_HIGHSHELF:
			filter.type = "highshelf";
			break;
		default:
			filter.type = "lowpass";
			break;
	}
	filter.frequency = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]));
	filter.q = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX])) / 1000.0f;
	filter.gain = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX])) / 1000.0f;
	return filter;
}

ApuOutputPlayback resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) {
	ApuOutputPlayback playback;
	playback.playbackRate = resolveApuPlaybackRate(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]);
	playback.gainLinear = resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
	playback.filter = resolveApuOutputFilter(registerWords);
	return playback;
}

} // namespace bmsx
