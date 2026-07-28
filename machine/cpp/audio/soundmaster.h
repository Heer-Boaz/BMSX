/*
 * soundmaster.h - Host audio output edge.
 *
 * APU/AOUT owns voice state and sample generation. SoundMaster owns host output
 * gain and retained rate conversion.
 */

#pragma once

#include "audio/output_resampler.h"

#include <cstddef>

namespace bmsx {

class AudioController;

class SoundMaster final {
public:
	SoundMaster();
	~SoundMaster() = default;

	[[nodiscard]] auto masterVolume() const -> f32 { return m_masterVolume; }
	void setMasterVolume(f32 value);
	void resetPlaybackState();
	[[nodiscard]] auto pullOutputFrames(AudioController& audioController, i16* output, size_t frameCount, i32 outputSampleRate) -> size_t;

	void setMixerUfpsScaled(i64 ufpsScaled);
	[[nodiscard]] auto mixFrameTimeSec() const -> f64 { return m_mixFrameTimeSec; }

private:
	[[nodiscard]] auto clampVolume(f32 value) const -> f32;

	f32 m_masterVolume = 1.0F;
	f64 m_mixFrameTimeSec;
	AudioOutputResampler m_outputResampler;
};

} // namespace bmsx
