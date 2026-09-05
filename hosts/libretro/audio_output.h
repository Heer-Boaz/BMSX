#pragma once

#include "audio/output_resampler.h"

#include <cstddef>
#include <vector>

namespace bmsx {

constexpr f64 DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE = 48000.0;

class AudioController;

class LibretroAudioOutput final {
public:
	LibretroAudioOutput();

	void setSampleRate(f64 sampleRate);
	void setEmulationFrameTimeSec(f64 seconds);
	void resetPlayback();
	bool setMuted(AudioController& audioController, bool muted);
	void collectFrame(AudioController& audioController);

	[[nodiscard]] auto data() const -> const i16* { return m_samples.data(); }
	[[nodiscard]] auto frameCount() const -> size_t { return m_frameCount; }

private:
	void resizeFrameBuffer();

	std::vector<i16> m_samples;
	size_t m_frameCount = 0u;
	f64 m_sampleRate = DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE;
	f64 m_sampleAccumulator = 0.0;
	f64 m_frameTimeSec;
	bool m_muted = false;
	AudioOutputResampler m_resampler;
};

} // namespace bmsx
