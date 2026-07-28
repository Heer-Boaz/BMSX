/*
 * soundmaster.cpp - Host audio output edge.
 */

#include "soundmaster.h"

#include "machine/devices/audio/controller.h"
#include "machine/runtime/timing/constants.h"
#include "machine/model_registry.h"

namespace bmsx {

SoundMaster::SoundMaster()
	: m_mixFrameTimeSec(static_cast<f64>(HZ_SCALE) / static_cast<f64>(PAL_REFRESH_UFPS_SCALED)) {
}

void SoundMaster::setMasterVolume(f32 value) {
	m_masterVolume = clampVolume(value);
}

void SoundMaster::resetPlaybackState() {
	m_outputResampler.reset();
}

auto SoundMaster::pullOutputFrames(AudioController& audioController, i16* output, size_t frameCount, i32 outputSampleRate) -> size_t {
	ApuOutputRing& outputRing = audioController.synchronizeOutput();
	return m_outputResampler.pull(outputRing, output, frameCount, outputSampleRate, m_masterVolume);
}

void SoundMaster::setMixerUfpsScaled(i64 ufpsScaled) {
	m_mixFrameTimeSec = static_cast<f64>(HZ_SCALE) / static_cast<f64>(ufpsScaled);
}

f32 SoundMaster::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return value;
}

} // namespace bmsx
