#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

struct ApuPhaseStep {
	i64 wholeQ16 = 0;
	i32 remainder = 0;
};

auto resolveApuGainLinear(u32 gainQ12Word) -> f64;
void resolveApuPhaseStep(ApuPhaseStep& out, u32 rateStepQ16Word, u32 sourceSampleRateHz);

} // namespace bmsx
