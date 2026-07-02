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

	[[nodiscard]] auto registryId() const -> const Identifier& override;
	[[nodiscard]] auto isRegistryPersistent() const -> bool override { return true; }


	[[nodiscard]] auto masterVolume() const -> f32 { return m_masterVolume; }
	void setMasterVolume(f32 value);


	void setMixerUfpsScaled(i64 ufpsScaled);
	void setLatencyProfile(MixLatencyProfile profile);
	[[nodiscard]] auto mixFrameTimeSec() const -> f64 { return m_mixFrameTimeSec; }
	[[nodiscard]] auto mixTargetAheadSec() const -> f64 { return m_mixTargetAheadSec; }

private:
	[[nodiscard]] auto clampVolume(f32 value) const -> f32;
	[[nodiscard]] auto profileOverheadSec() const -> f64;
	void recomputeMixTarget();

	f32 m_masterVolume = 1.0F;
	i64 m_mixUfpsScaled;
	f64 m_mixFrameTimeSec;
	f64 m_mixTargetAheadSec;
	MixLatencyProfile m_mixLatencyProfile = MixLatencyProfile::Low;
};

} // namespace bmsx
