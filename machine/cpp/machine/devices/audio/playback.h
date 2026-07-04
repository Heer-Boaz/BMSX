#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <string_view>

namespace bmsx {

struct ApuOutputPlayback {
	f32 playbackRate = 1.0F;
	f32 gainLinear = 1.0F;
	bool filterEnabled = false;
	std::string_view filterType;
	f32 filterFrequency = 0.0F;
	f32 filterQ = 0.0F;
	f32 filterGain = 0.0F;
};

auto resolveApuGainLinear(u32 gainQ12Word) -> f32;
auto resolveApuPlaybackRate(u32 rateStepQ16Word) -> f32;
auto decodeApuFilterType(u32 kind) -> std::string_view;
void applyApuOutputFilter(ApuOutputPlayback& playback, const ApuParameterRegisterWords& registerWords);
auto resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) -> ApuOutputPlayback;

} // namespace bmsx
