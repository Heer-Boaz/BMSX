#include "machine/devices/audio/playback.h"

#include "machine/common/numeric.h"

namespace bmsx {

void resolveApuPhaseStep(ApuPhaseStep& out, u32 rateStepQ16Word, u32 sourceSampleRateHz) {
	const i64 product = static_cast<i64>(toSignedWord(rateStepQ16Word)) * static_cast<i64>(sourceSampleRateHz);
	out.wholeQ16 = product / static_cast<i64>(APU_SAMPLE_RATE_HZ);
	out.remainder = static_cast<i32>(product % static_cast<i64>(APU_SAMPLE_RATE_HZ));
}

} // namespace bmsx
