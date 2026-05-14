/*
 * soundmaster.h - Host audio output edge.
 *
 * APU/AOUT owns voice state and sample generation. SoundMaster owns host output
 * gain, latency profile, and native platform audio pacing.
 */

#pragma once

#include "common/registry.h"

namespace bmsx {

enum class MixLatencyProfile {
	Minimal,
	Low,
	Balanced,
	Safe,
};

class SoundMaster final : public Registerable {
public:
	SoundMaster();
	~SoundMaster() override = default;

	const Identifier& registryId() const override;
	bool isRegistryPersistent() const override { return true; }


	f32 masterVolume() const { return m_masterVolume; }
	void setMasterVolume(f32 value);


	void setMixerUfpsScaled(i64 ufpsScaled);
	void setLatencyProfile(MixLatencyProfile profile);
	f64 mixFrameTimeSec() const { return m_mixFrameTimeSec; }
	f64 mixTargetAheadSec() const { return m_mixTargetAheadSec; }

private:
	f32 clampVolume(f32 value) const;
	f64 profileOverheadSec() const;
	void recomputeMixTarget();

	f32 m_masterVolume = 1.0f;
	i64 m_mixUfpsScaled;
	f64 m_mixFrameTimeSec;
	f64 m_mixTargetAheadSec;
	MixLatencyProfile m_mixLatencyProfile = MixLatencyProfile::Low;
};

} // namespace bmsx
