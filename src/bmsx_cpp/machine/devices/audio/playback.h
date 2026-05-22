#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <optional>
#include <string_view>

namespace bmsx {

struct ApuOutputFilter {
	std::string_view type;
	f32 frequency = 0.0F;
	f32 q = 0.0F;
	f32 gain = 0.0F;
};

struct ApuOutputPlayback {
	f32 playbackRate = 1.0F;
	f32 gainLinear = 1.0F;
	std::optional<ApuOutputFilter> filter;
};

auto resolveApuGainLinear(u32 gainQ12Word) -> f32;
auto resolveApuPlaybackRate(u32 rateStepQ16Word) -> f32;
auto resolveApuOutputFilter(const ApuParameterRegisterWords& registerWords) -> std::optional<ApuOutputFilter>;
auto resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) -> ApuOutputPlayback;

} // namespace bmsx
