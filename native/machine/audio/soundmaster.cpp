/*
 * soundmaster.cpp - Host audio output edge.
 */

#include "soundmaster.h"

#include "machine/runtime/timing/constants.h"

namespace bmsx {

static constexpr f64 MIX_MINIMAL_OVERHEAD_SEC = 0.002;
static constexpr f64 MIX_LOW_OVERHEAD_SEC = 0.004;
static constexpr f64 MIX_BALANCED_OVERHEAD_SEC = 0.006;
static constexpr f64 MIX_SAFE_OVERHEAD_SEC = 0.012;

SoundMaster::SoundMaster()
	: m_mixUfpsScaled(DEFAULT_UFPS_SCALED) {
	recomputeMixTarget();
}

const Identifier& SoundMaster::registryId() const {
	static const Identifier id = "sm";
	return id;
}


void SoundMaster::setMasterVolume(f32 value) {
	m_masterVolume = clampVolume(value);
}

void SoundMaster::setMixerUfpsScaled(i64 ufpsScaled) {
	m_mixUfpsScaled = ufpsScaled;
	recomputeMixTarget();
}

void SoundMaster::setLatencyProfile(MixLatencyProfile profile) {
	m_mixLatencyProfile = profile;
	recomputeMixTarget();
}

f64 SoundMaster::profileOverheadSec() const {
	switch (m_mixLatencyProfile) {
		case MixLatencyProfile::Minimal: return MIX_MINIMAL_OVERHEAD_SEC;
		case MixLatencyProfile::Low: return MIX_LOW_OVERHEAD_SEC;
		case MixLatencyProfile::Balanced: return MIX_BALANCED_OVERHEAD_SEC;
		case MixLatencyProfile::Safe: return MIX_SAFE_OVERHEAD_SEC;
	}
	throw BMSX_RUNTIME_ERROR("[SoundMaster] Unsupported mix latency profile.");
}

void SoundMaster::recomputeMixTarget() {
	m_mixFrameTimeSec = static_cast<f64>(HZ_SCALE) / static_cast<f64>(m_mixUfpsScaled);
	m_mixTargetAheadSec = m_mixFrameTimeSec + profileOverheadSec();
}

f32 SoundMaster::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return value;
}

} // namespace bmsx
