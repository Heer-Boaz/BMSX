#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <optional>
#include <string_view>

namespace bmsx {

struct ApuOutputFilter {
	std::string_view type;
	f32 frequency = 0.0f;
	f32 q = 0.0f;
	f32 gain = 0.0f;
};

struct ApuOutputPlayback {
	f32 playbackRate = 1.0f;
	f32 gainLinear = 1.0f;
	std::optional<ApuOutputFilter> filter;
};

f32 resolveApuGainLinear(u32 gainQ12Word);
f32 resolveApuPlaybackRate(u32 rateStepQ16Word);
std::optional<ApuOutputFilter> resolveApuOutputFilter(const ApuParameterRegisterWords& registerWords);
ApuOutputPlayback resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords);

} // namespace bmsx
