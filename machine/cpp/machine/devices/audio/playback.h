#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <string_view>

namespace bmsx {

struct ApuOutputPlayback {
	f64 gainLinear = 1.0;
	bool filterEnabled = false;
	std::string_view filterType;
	f64 filterFrequency = 0.0;
	f64 filterQ = 0.0;
	f64 filterGain = 0.0;
};

struct ApuPhaseStep {
	i64 wholeQ16 = 0;
	i32 remainder = 0;
};

auto resolveApuGainLinear(u32 gainQ12Word) -> f64;
void resolveApuPhaseStep(ApuPhaseStep& out, u32 rateStepQ16Word, u32 sourceSampleRateHz);
auto decodeApuFilterType(u32 kind) -> std::string_view;
void applyApuOutputFilter(ApuOutputPlayback& playback, const ApuParameterRegisterWords& registerWords);
auto resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) -> ApuOutputPlayback;

} // namespace bmsx
